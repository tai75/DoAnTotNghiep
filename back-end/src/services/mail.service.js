const nodemailer = require('nodemailer');
const config = require('../config/env');

async function sendEmail({ to, subject, text }) {
  if (process.env.NODE_ENV === 'test' && globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__) {
    return globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__({ to, subject, text });
  }
  if (!to) return;
  if (!config.smtp.host || !config.smtp.user || !config.smtp.password) {
    console.warn('[email] SMTP is not configured; email was not sent.');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password }
  });
  return transporter.sendMail({ from: config.smtp.from, to, subject, text });
}

module.exports = { sendEmail };
