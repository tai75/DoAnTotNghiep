const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const config = require('../config/env');
const ApiError = require('../utils/apiError');
const { sendEmail } = require('./mail.service');

const GENERIC_RESET_RESPONSE = Object.freeze({
  success: true,
  message: 'Nếu email tồn tại, yêu cầu đặt lại mật khẩu đã được tạo'
});
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;
const RESET_RESPONSE_FLOOR_MS = 250;
const RESET_RESPONSE_JITTER_MS = 50;
const RESET_LOCK_ATTEMPTS = 8;
const RESET_LOCK_RETRY_DELAY_MS = 10;
const RESET_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 2_000, timeout: 5_000, isolationLevel: 'ReadCommitted' });

class PasswordResetLockContentionError extends Error {
  constructor(cause) {
    super('Password reset user row is currently locked', { cause });
    this.name = 'PasswordResetLockContentionError';
  }
}

function errorCodes(error) {
  return [error?.code, error?.meta?.code, error?.meta?.driverAdapterError?.cause?.code, error?.cause?.code]
    .filter(Boolean).map(String);
}

function isTransactionContention(error) {
  return errorCodes(error).some((code) => [
    'P2028', 'P2034', '1205', '1213', '3572',
    'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ER_LOCK_NOWAIT'
  ].includes(code));
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForResponseFloor(startedAt, dependencies = {}) {
  const nowImpl = dependencies.nowImpl || Date.now;
  const waitImpl = dependencies.waitImpl || wait;
  const floorMs = dependencies.floorMs ?? RESET_RESPONSE_FLOOR_MS;
  const jitterMs = dependencies.jitterMs ?? RESET_RESPONSE_JITTER_MS;
  const randomIntImpl = dependencies.randomIntImpl || crypto.randomInt;
  const jitter = jitterMs > 0 ? randomIntImpl(0, jitterMs + 1) : 0;
  const remaining = Math.max(0, floorMs + jitter - (nowImpl() - startedAt));
  if (remaining > 0) await waitImpl(remaining);
  return floorMs + jitter;
}

async function issuePasswordResetToken(userId, rawToken, client = prisma, dependencies = {}) {
  const now = dependencies.now || new Date();
  const cooldownMs = dependencies.cooldownMs ?? RESET_COOLDOWN_MS;
  const lockAttempts = dependencies.lockAttempts || RESET_LOCK_ATTEMPTS;
  const waitImpl = dependencies.waitImpl || wait;
  const transactionOptions = dependencies.transactionOptions || RESET_TRANSACTION_OPTIONS;
  const tokenHash = hashResetToken(rawToken);

  for (let attempt = 0; attempt < lockAttempts; attempt += 1) {
    try {
      return await client.$transaction(async (transaction) => {
        let lockedUser;
        try {
          lockedUser = await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE NOWAIT`;
        } catch (error) {
          if (isTransactionContention(error)) throw new PasswordResetLockContentionError(error);
          throw error;
        }
        if (!lockedUser.length) return { issued: false, reason: 'user_missing' };

        const recent = await transaction.passwordResetToken.findFirst({
          where: { userId, createdAt: { gte: new Date(now.getTime() - cooldownMs) } },
          orderBy: { createdAt: 'desc' },
          select: { id: true }
        });
        if (recent) return { issued: false, reason: 'cooldown' };

        await transaction.passwordResetToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: now }
        });
        const token = await transaction.passwordResetToken.create({
          data: { userId, tokenHash, expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS) }
        });
        return { issued: true, tokenId: token.id };
      }, transactionOptions);
    } catch (error) {
      if (error instanceof PasswordResetLockContentionError && attempt + 1 < lockAttempts) {
        await waitImpl(RESET_LOCK_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  return { issued: false, reason: 'contention' };
}

function resetLink(rawToken) {
  return `${config.frontendUrl}/reset-password#token=${encodeURIComponent(rawToken)}`;
}

async function sendResetLink(email, rawToken, mailer = sendEmail) {
  await mailer({
    to: email,
    subject: 'Đặt lại mật khẩu Job Connect',
    text: `Mở liên kết sau để đặt lại mật khẩu: ${resetLink(rawToken)}`
  });
}

function dispatchResetEmail(email, rawToken, dependencies = {}) {
  const sendResetLinkImpl = dependencies.sendResetLinkImpl || sendResetLink;
  const logger = dependencies.logger || console;
  void Promise.resolve()
    .then(() => sendResetLinkImpl(email, rawToken))
    .catch((error) => logger.error('[password-reset-email]', { name: error?.name || 'Error', code: error?.code || null }));
}

async function requestPasswordReset(email, dependencies = {}) {
  const client = dependencies.client || prisma;
  const nowImpl = dependencies.nowImpl || Date.now;
  const startedAt = nowImpl();
  const rawToken = (dependencies.randomBytesImpl || crypto.randomBytes)(32).toString('hex');
  // Perform the same bounded token generation/hash work even when the account does not exist.
  hashResetToken(rawToken);
  try {
    const user = await client.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (user) {
      try {
        const issued = await issuePasswordResetToken(user.id, rawToken, client, dependencies);
        if (issued.issued) dispatchResetEmail(user.email, rawToken, dependencies);
      } catch (error) {
        (dependencies.logger || console).error('[password-reset-issuance]', {
          name: error?.name || 'Error', code: error?.code || null
        });
      }
    }
  } finally {
    await waitForResponseFloor(startedAt, dependencies);
  }
  return { ...GENERIC_RESET_RESPONSE };
}

async function consumePasswordResetToken(rawToken, password, client = prisma, dependencies = {}) {
  const nowImpl = dependencies.nowImpl || (() => new Date());
  const lookupAt = dependencies.now || nowImpl();
  const tokenHash = hashResetToken(rawToken);
  const resetToken = await client.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= lookupAt) {
    throw new ApiError(400, 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
  }
  const passwordHash = await (dependencies.hashPasswordImpl || bcrypt.hash)(password, 12);
  const claimedAt = dependencies.now || nowImpl();
  await client.$transaction(async (transaction) => {
    const claimed = await transaction.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null, expiresAt: { gt: claimedAt } },
      data: { usedAt: claimedAt }
    });
    if (claimed.count !== 1) throw new ApiError(400, 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    await transaction.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } }
    });
    await transaction.refreshToken.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: claimedAt }
    });
    await transaction.authSession.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: claimedAt }
    });
  });
}

module.exports = {
  GENERIC_RESET_RESPONSE,
  RESET_COOLDOWN_MS,
  RESET_RESPONSE_FLOOR_MS,
  RESET_RESPONSE_JITTER_MS,
  consumePasswordResetToken,
  dispatchResetEmail,
  hashResetToken,
  isTransactionContention,
  issuePasswordResetToken,
  requestPasswordReset,
  resetLink,
  sendResetLink,
  waitForResponseFloor
};
