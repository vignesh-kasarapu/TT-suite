const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const env = require('../config/env');
const { Employee } = require('../models');
const auditService = require('./audit.service');

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${env.entra.tenantId}/discovery/v2.0/keys`,
});

function getSigningKey(kid) {
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

/** LMS-001/002: authorization-code-for-token exchange with Entra's /token endpoint. */
async function exchangeCodeForIdToken(code) {
  const tokenUrl = `https://login.microsoftonline.com/${env.entra.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: env.entra.clientId,
    client_secret: env.entra.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.entra.redirectUri,
    scope: 'openid profile email',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.error_description || 'Failed to exchange authorization code with Entra.');
    err.status = 401;
    err.code = 'ENTRA_TOKEN_EXCHANGE_FAILED';
    throw err;
  }

  if (!data.id_token) {
    const err = new Error('Entra token response did not include an id_token.');
    err.status = 401;
    err.code = 'ENTRA_TOKEN_MISSING_ID_TOKEN';
    throw err;
  }

  return data.id_token;
}

/** LMS-001: authenticate every user through Entra using OIDC. Only identity claims are read (LMS-004). */
async function verifyEntraIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) throw new Error('Malformed identity token.');

  const publicKey = await getSigningKey(decoded.header.kid);
  const claims = jwt.verify(idToken, publicKey, {
    audience: env.entra.clientId,
    issuer: `https://login.microsoftonline.com/${env.entra.tenantId}/v2.0`,
  });

  return { oid: claims.oid, email: claims.preferred_username || claims.email, name: claims.name };
}

/** LMS-003: resolve employee by Entra OID or company work_email, auto-binding OID on first sign-in. */
async function resolveEmployeeFromEntraClaims(claims) {
  let employee = await Employee.findOne({ where: { entra_oid: claims.oid } });

  // Fallback: match by company work_email if OID not bound yet. Exact equality — `Op.like`
  // treats `_`/`%` in the claimed email as SQL wildcards, letting a claimed address that
  // differs by exactly one character (e.g. an underscore for a dot) bind to the wrong
  // employee's account on their very first sign-in.
  if (!employee && claims.email) {
    employee = await Employee.findOne({
      where: { work_email: claims.email },
    });

    if (employee) {
      employee.entra_oid = claims.oid;
      await employee.save();
    }
  }

  if (!employee) {
    await auditService.record({
      isSystemActor: true, action: 'ACCESS_REFUSED_NO_EMPLOYEE_RECORD', entityType: 'auth', entityId: claims.oid,
      newValue: { email: claims.email },
    });
    const err = new Error(`No employee record found for email (${claims.email}). Contact HR.`);
    err.status = 403;
    err.code = 'NO_EMPLOYEE_RECORD';
    throw err;
  }

  if (employee.status !== 'ACTIVE') {
    const err = new Error('This account is deactivated.');
    err.status = 403;
    err.code = 'EMPLOYEE_DEACTIVATED';
    throw err;
  }

  return employee;
}

/** Minutes to add to a UTC instant to get that timezone's local wall-clock time, expressed
 * as UTC-labeled fields — i.e. how far the zone's clock reads ahead of UTC at this moment
 * (handles DST since the offset is computed for this specific instant, not a fixed constant). */
function getTimezoneOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { if (p.type !== 'literal') acc[p.type] = p.value; return acc; }, {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === '24' ? 0 : parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/** LMS-002: application session valid until midnight of the current day in the configured
 * tz (env.defaults.timezone) — NOT the server host's local time, which may differ (e.g. a
 * cloud VM provisioned in UTC while the org's configured tz is Asia/Kolkata). */
function issueSessionToken(employeeId) {
  const now = new Date();
  const offsetMinutes = getTimezoneOffsetMinutes(env.defaults.timezone, now);
  const zonedNow = new Date(now.getTime() + offsetMinutes * 60000);
  const zonedMidnight = new Date(Date.UTC(zonedNow.getUTCFullYear(), zonedNow.getUTCMonth(), zonedNow.getUTCDate(), 23, 59, 59, 999));
  const expiryUtc = new Date(zonedMidnight.getTime() - offsetMinutes * 60000);
  const expiresInSeconds = Math.floor((expiryUtc.getTime() - now.getTime()) / 1000);

  return jwt.sign({ employeeId }, env.session.jwtSecret, { expiresIn: expiresInSeconds });
}

module.exports = {
  exchangeCodeForIdToken,
  verifyEntraIdToken,
  resolveEmployeeFromEntraClaims,
  issueSessionToken,
};
