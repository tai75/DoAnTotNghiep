const { AI_POLICY_VERSION, executeWithConsent } = require('../../src/services/aiConsent.service');
const vi = { fn: (implementation = () => {}) => implementation };

function matchesDate(value, condition) {
  if (!condition) return true;
  if (condition.gt && !(value > condition.gt)) return false;
  if (condition.lte && !(value <= condition.lte)) return false;
  return true;
}

function createAiPermitFake(initialConsents = []) {
  const state = {
    consents: initialConsents.map((item, index) => ({
      id: item.id || index + 1, userId: item.userId, scope: item.scope,
      policyVersion: item.policyVersion || AI_POLICY_VERSION, version: item.version || 1,
      grantedAt: item.grantedAt || new Date(), withdrawnAt: item.withdrawnAt || null,
      withdrawalRequestedAt: item.withdrawalRequestedAt || null,
      withdrawalCompletedAt: item.withdrawalCompletedAt || null
    })),
    permits: [], bindings: [], events: [], audits: []
  };
  let inTransaction = false;
  let failNextCommit = false;
  let transactionTail = Promise.resolve();

  const activeFor = (requirements) => requirements.map(({ userId, scope }) => state.consents.find((item) => (
    item.userId === Number(userId) && item.scope === scope && item.policyVersion === AI_POLICY_VERSION
      && !item.withdrawnAt && !item.withdrawalRequestedAt
  ))).filter(Boolean);

  const permitMatches = (permit, where = {}) => {
    if (where.id !== undefined && permit.id !== where.id) return false;
    if (typeof where.status === 'string' && permit.status !== where.status) return false;
    if (where.status?.in && !where.status.in.includes(permit.status)) return false;
    if (where.version !== undefined && permit.version !== where.version) return false;
    if (where.leaseToken !== undefined && permit.leaseToken !== where.leaseToken) return false;
    if (!matchesDate(permit.deadlineAt, where.deadlineAt)) return false;
    if (!matchesDate(permit.leaseExpiresAt, where.leaseExpiresAt)) return false;
    if (where.bindings?.some) {
      const related = state.bindings.filter((item) => item.permitId === permit.id);
      if (!related.some((item) => where.bindings.some.consentId === undefined || item.consentId === where.bindings.some.consentId)) return false;
    }
    return true;
  };

  const applyData = (record, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && value.increment !== undefined) record[key] += value.increment;
      else record[key] = value;
    }
  };

  const aiConsent = {
    findMany: vi.fn(async ({ where = {}, orderBy } = {}) => {
      let records = state.consents.filter((item) => {
        if (where.userId !== undefined && item.userId !== where.userId) return false;
        if (where.policyVersion !== undefined && item.policyVersion !== where.policyVersion) return false;
        if (where.withdrawnAt === null && item.withdrawnAt) return false;
        if (where.withdrawalRequestedAt === null && item.withdrawalRequestedAt) return false;
        if (where.OR && !where.OR.some((condition) => condition.userId === item.userId && condition.scope === item.scope)) return false;
        return true;
      });
      if (orderBy?.scope) records = [...records].sort((a, b) => a.scope.localeCompare(b.scope));
      return records.map((item) => ({ ...item }));
    }),
    findUnique: vi.fn(async ({ where }) => {
      const key = where.userId_scope_policyVersion;
      const found = key
        ? state.consents.find((item) => item.userId === key.userId && item.scope === key.scope && item.policyVersion === key.policyVersion)
        : state.consents.find((item) => item.id === where.id);
      return found ? { ...found } : null;
    }),
    create: vi.fn(async ({ data }) => {
      const record = { id: state.consents.length + 1, version: 1, grantedAt: new Date(), withdrawnAt: null, withdrawalRequestedAt: null, withdrawalCompletedAt: null, ...data };
      state.consents.push(record);
      return { ...record };
    }),
    update: vi.fn(async ({ where, data }) => {
      const record = state.consents.find((item) => item.id === where.id);
      applyData(record, data);
      return { ...record };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const records = state.consents.filter((item) => {
        if (where.id !== undefined && item.id !== where.id) return false;
        if (where.version !== undefined && item.version !== where.version) return false;
        if (where.withdrawnAt === null && item.withdrawnAt) return false;
        if (where.withdrawnAt?.not === null && !item.withdrawnAt) return false;
        if (where.withdrawalRequestedAt?.not === null && !item.withdrawalRequestedAt) return false;
        if (where.withdrawalCompletedAt === null && item.withdrawalCompletedAt) return false;
        if (where.withdrawalCompletedAt?.not === null && !item.withdrawalCompletedAt) return false;
        return true;
      });
      records.forEach((record) => applyData(record, data));
      return { count: records.length };
    })
  };

  const aiTransmissionPermit = {
    create: vi.fn(async ({ data }) => {
      const { bindings, ...permitData } = data;
      const permit = { id: state.permits.length + 1, version: 1, createdAt: new Date(), updatedAt: new Date(), ...permitData };
      state.permits.push(permit);
      for (const binding of bindings.create) state.bindings.push({ id: state.bindings.length + 1, permitId: permit.id, ...binding });
      return { ...permit };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const records = state.permits.filter((item) => permitMatches(item, where));
      records.forEach((record) => applyData(record, data));
      return { count: records.length };
    }),
    findUnique: vi.fn(async ({ where }) => {
      const permit = state.permits.find((item) => item.id === where.id || item.requestId === where.requestId);
      return permit ? { ...permit } : null;
    }),
    findMany: vi.fn(async ({ where = {} } = {}) => state.permits.filter((item) => permitMatches(item, where)).map((item) => ({ ...item }))),
    count: vi.fn(async ({ where = {} } = {}) => state.permits.filter((item) => permitMatches(item, where)).length)
  };

  const aiUsageEvent = {
    create: vi.fn(async ({ data }) => {
      const event = { id: state.events.length + 1, outcome: 'STARTED', ...data };
      state.events.push(event);
      return { ...event };
    }),
    update: vi.fn(async ({ where, data }) => {
      const event = state.events.find((item) => item.id === where.id);
      applyData(event, data);
      return { ...event };
    })
  };
  const auditLog = { create: vi.fn(async ({ data }) => { state.audits.push(data); return data; }) };

  const client = {
    aiConsent, aiTransmissionPermit, aiUsageEvent,
    auditLog,
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn((callback) => {
      const run = async () => {
        const snapshot = structuredClone(state);
        inTransaction = true;
        try {
          const result = await callback(tx);
          if (failNextCommit) {
            failNextCommit = false;
            Object.assign(state, snapshot);
            throw new Error('synthetic commit failure');
          }
          return result;
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        } finally { inTransaction = false; }
      };
      const result = transactionTail.then(run, run);
      transactionTail = result.catch(() => {});
      return result;
    })
  };

  const tx = {
    aiConsent, aiTransmissionPermit, aiUsageEvent, auditLog,
    $queryRawUnsafe: vi.fn(async (query, ...parameters) => {
      if (query.includes('WHERE user_id = ? AND scope = ?')) {
        const [userId, scope, policyVersion] = parameters;
        const record = state.consents.find((item) => item.userId === userId && item.scope === scope && item.policyVersion === policyVersion);
        return record ? [{ ...record }] : [];
      }
      const [, ...pairs] = parameters;
      const requirements = [];
      for (let index = 0; index < pairs.length; index += 2) requirements.push({ userId: pairs[index], scope: pairs[index + 1] });
      return activeFor(requirements).map((item) => ({ id: item.id, userId: item.userId, scope: item.scope, version: item.version }));
    })
  };

  return {
    client, state,
    isInTransaction: () => inTransaction,
    failNextCommit: () => { failNextCommit = true; },
    consent: (userId, scope) => state.consents.find((item) => item.userId === userId && item.scope === scope)
  };
}

async function runWithAiPermit(scope, callback, options = {}) {
  const userId = options.userId || 9001;
  const fake = options.fake || createAiPermitFake([{ id: userId, userId, scope }]);
  const result = await executeWithConsent({ actorUserId: userId, scope, operation: options.operation || 'unit-test' }, callback, fake.client);
  return { result, fake };
}

module.exports = { createAiPermitFake, runWithAiPermit };
