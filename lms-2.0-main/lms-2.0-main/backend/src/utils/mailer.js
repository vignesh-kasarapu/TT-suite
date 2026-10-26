const nodemailer = require('nodemailer');
const env = require('../config/env');
const { Employee } = require('../models');

let transporter;

/**
 * Basic-auth SMTP (e.g. Gmail with an app password), configured via MAIL_HOST/MAIL_PORT/
 * MAIL_USERNAME/MAIL_PASSWORD. Sends to any recipient address regardless of domain
 * (@gmail.com, @tektalis.com, etc.) — the recipient's own work_email, not the sending
 * account, determines who gets the mail.
 *
 * The from address is always the authenticated mailbox (env.mail.user): most SMTP
 * providers (Gmail included) reject or flag mail whose From doesn't match the
 * authenticated account or a verified alias of it.
 */
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465,
      auth: { user: env.mail.user, pass: env.mail.password },
    });
  }
  return transporter;
}

async function send({ recipientId, subject, body }) {
  const recipient = await Employee.findByPk(recipientId);
  if (!recipient) throw new Error(`Cannot email: employee ${recipientId} not found.`);

  await getTransporter().sendMail({
    from: env.mail.user,
    to: recipient.work_email,
    subject,
    html: body,
  });
}

module.exports = { send };
