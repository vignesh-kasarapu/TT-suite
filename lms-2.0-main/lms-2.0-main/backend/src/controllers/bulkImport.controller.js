const multer = require('multer');
const { parse } = require('csv-parse/sync');
const bulkImportService = require('../services/bulkImport.service');
const { ok } = require('../utils/apiResponse');

// LMS-019: delimited file, kept in memory only — never written to disk, since
// only the resulting employee rows matter, not the upload artifact itself.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function importEmployees(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: { code: 'FILE_REQUIRED', message: 'Attach a CSV file with column headers: fullName, workEmail, employeeCode, entraOid, dateOfJoining, designation, reportingManagerCode (optional).' } });
  }

  const rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  const result = await bulkImportService.importEmployees(rows, req.currentUser.employeeId);
  return ok(res, result);
}

module.exports = { upload, importEmployees };
