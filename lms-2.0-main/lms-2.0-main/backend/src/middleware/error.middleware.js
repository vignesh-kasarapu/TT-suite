const { fail } = require('../utils/apiResponse');

/** Sequelize validation/constraint errors otherwise fall through to a raw 500 with an
 * internal-looking message (e.g. "Validation error") — map them to a clean 400 instead. */
function mapSequelizeError(err) {
  if (err.name === 'SequelizeUniqueConstraintError') {
    const field = err.errors?.[0]?.path;
    return { status: 409, code: 'DUPLICATE_VALUE', message: field ? `A record with this ${field} already exists.` : 'A record with these values already exists.' };
  }
  if (err.name === 'SequelizeValidationError') {
    const message = err.errors?.[0]?.message || 'Validation failed.';
    return { status: 400, code: 'VALIDATION_ERROR', message };
  }
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return { status: 400, code: 'INVALID_REFERENCE', message: 'This action references a record that does not exist or cannot be linked.' };
  }
  if (err.name === 'SequelizeDatabaseError') {
    return { status: 400, code: 'INVALID_REQUEST', message: 'The request could not be processed with the given values.' };
  }
  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : 'The uploaded file could not be processed.';
    return { status: 400, code: 'VALIDATION_ERROR', message };
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const mapped = mapSequelizeError(err);
  const status = mapped?.status || err.status || 500;
  const code = mapped?.code || err.code || 'INTERNAL_ERROR';
  const message = mapped?.message || err.message || 'Something went wrong. Please try again.';

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  return fail(res, status, code, message);
}

module.exports = errorMiddleware;
