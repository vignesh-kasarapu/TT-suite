require('dotenv').config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  return value;
}

const env = {
  nodeEnv: required('NODE_ENV', 'development'),
  port: parseInt(required('PORT', '4000'), 10),
  appBaseUrl: required('APP_BASE_URL'),
  clientBaseUrl: required('CLIENT_BASE_URL'),

  db: {
    host: required('DB_HOST'),
    port: parseInt(required('DB_PORT', '3306'), 10),
    name: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    ssl: required('DB_SSL', 'false') === 'true',
  },

  entra: {
    tenantId: required('ENTRA_TENANT_ID')?.trim(),
    clientId: required('ENTRA_CLIENT_ID')?.trim(),
    clientSecret: required('ENTRA_CLIENT_SECRET')?.trim(),
    redirectUri: required('ENTRA_REDIRECT_URI')?.trim(),
  },

  session: {
    jwtSecret: required('SESSION_JWT_SECRET'),
    cookieName: required('SESSION_COOKIE_NAME', 'lms_session'),
  },

  // LMS-006: dev/test auth bypass. Must default disabled; refused in production.
  devAuthBypass: {
    enabled: required('DEV_AUTH_BYPASS_ENABLED', 'false') === 'true',
    employeeCode: required('DEV_AUTH_BYPASS_EMPLOYEE_CODE'),
  },

  // Exchange Online OAuth2 client-credentials (kept for when it's wired back up — currently unused).
  smtp: {
    host: required('SMTP_HOST'),
    port: parseInt(required('SMTP_PORT', '587'), 10),
    tenantId: required('SMTP_TENANT_ID'),
    clientId: required('SMTP_CLIENT_ID'),
    clientSecret: required('SMTP_CLIENT_SECRET'),
    fromAddress: required('SMTP_FROM_ADDRESS'),
  },

  // Basic-auth SMTP (e.g. Gmail with an app password) — what mailer.js actually sends through right now.
  mail: {
    host: required('MAIL_HOST'),
    port: parseInt(required('MAIL_PORT', '587'), 10),
    user: required('MAIL_USERNAME'),
    password: required('MAIL_PASSWORD'),
  },

  defaults: {
    timezone: required('DEFAULT_TIMEZONE', 'Asia/Kolkata'),
    leaveYearStart: required('DEFAULT_LEAVE_YEAR_START', '04-01'),
  },
};

// LMS-006 hard guard: dev auth bypass must never run in a production profile.
if (env.nodeEnv === 'production' && env.devAuthBypass.enabled) {
  // eslint-disable-next-line no-console
  console.error('FATAL: DEV_AUTH_BYPASS_ENABLED=true is not permitted when NODE_ENV=production.');
  process.exit(1);
}

module.exports = env;
