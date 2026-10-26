const crypto = require('crypto');
const env = require('../config/env');
const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
const { ok } = require('../utils/apiResponse');
const { Employee } = require('../models');

const STATE_COOKIE_NAME = 'lms_oauth_state';

/** Public, unauthenticated: lets the (already-built, production) login page know whether
 * to offer the dev/demo sign-in link at all, without hardcoding it to a Vite build-time
 * flag (import.meta.env.DEV is always false in a production bundle — e.g. the one served
 * by nginx in Docker — even when DEV_AUTH_BYPASS_ENABLED=true server-side). */
function getAuthConfig(req, res) {
  return ok(res, { devAuthBypassEnabled: env.devAuthBypass.enabled });
}

/** LMS-001: entry point redirects to Microsoft. No username/password screen exists in this system. */
function redirectToEntra(req, res) {
  // CSRF protection: bind this browser to the state we send Entra, and check it back on callback.
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes to complete the round trip
  });

  const authorizeUrl = `https://login.microsoftonline.com/${env.entra.tenantId}/oauth2/v2.0/authorize`
    + `?client_id=${encodeURIComponent(env.entra.clientId)}`
    + `&response_type=code`
    + `&redirect_uri=${encodeURIComponent(env.entra.redirectUri)}`
    + `&response_mode=query&scope=${encodeURIComponent('openid profile email')}`
    + `&state=${state}`;
  return res.redirect(authorizeUrl);
}

/** Every failure path below must land the user back on the SPA's login screen with a
 * readable reason, never a raw JSON error body served from the backend's own origin —
 * the login page has nothing to read a thrown error from, since it's not an XHR call. */
function redirectToLoginWithError(res, message) {
  return res.redirect(`${env.clientBaseUrl}/login?error=${encodeURIComponent(message)}`);
}

/** LMS-002/003: exchange code, verify claims, resolve employee, issue our own session. */
async function handleCallback(req, res) {
  const { code, state, error: entraError, error_description: entraErrorDescription } = req.query;
  const expectedState = req.cookies ? req.cookies[STATE_COOKIE_NAME] : undefined;
  res.clearCookie(STATE_COOKIE_NAME);

  if (entraError) {
    return redirectToLoginWithError(res, entraErrorDescription || 'Microsoft Entra sign-in failed.');
  }

  if (!code) {
    return redirectToLoginWithError(res, 'Missing authorization code from Entra callback.');
  }

  if (!state || !expectedState || state !== expectedState) {
    return redirectToLoginWithError(res, 'Invalid or expired sign-in state. Please try signing in again.');
  }

  let employee;
  try {
    const idToken = await authService.exchangeCodeForIdToken(code);
    const claims = await authService.verifyEntraIdToken(idToken);
    employee = await authService.resolveEmployeeFromEntraClaims(claims);
  } catch (err) {
    return redirectToLoginWithError(res, err.message || 'Sign-in failed. Please try again.');
  }

  const sessionToken = authService.issueSessionToken(employee.employee_id);
  res.cookie(env.session.cookieName, sessionToken, { httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'lax' });

  await auditService.record({ actorId: employee.employee_id, action: 'SIGN_IN', entityType: 'auth', entityId: employee.employee_id });

  return res.redirect(env.clientBaseUrl);
}

/** Local-only login for development/demo data. Never available in production. */
async function devLogin(req, res) {
  if (env.nodeEnv === 'production' || !env.devAuthBypass.enabled) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } });
  }

  const employee = await Employee.findOne({ where: { employee_code: env.devAuthBypass.employeeCode } });
  if (!employee) {
    return res.status(401).json({
      success: false,
      error: { code: 'DEV_BYPASS_MISCONFIGURED', message: `No employee found for code ${env.devAuthBypass.employeeCode}. Run the demo seed first.` },
    });
  }

  const sessionToken = authService.issueSessionToken(employee.employee_id);
  res.cookie(env.session.cookieName, sessionToken, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
  });
  return res.redirect(env.clientBaseUrl);
}

/** LMS-007: sign out invalidates the application session immediately. */
async function signOut(req, res) {
  res.clearCookie(env.session.cookieName);
  if (req.currentUser) {
    await auditService.record({ actorId: req.currentUser.employeeId, action: 'SIGN_OUT', entityType: 'auth', entityId: req.currentUser.employeeId });
  }
  return ok(res, { signedOut: true });
}

module.exports = { getAuthConfig, redirectToEntra, handleCallback, devLogin, signOut };
