const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { LeaveRequestAttachment, LeaveRequest, Watcher, Employee } = require('../models');
const auditService = require('../services/audit.service');

// NFR-10: stored outside the web root (never under a static-served /public), served
// only through this access-checked endpoint — never a direct file:// or static URL.
const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/attachments');
fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — LMS-035's configured limit, kept explicit here
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, STORAGE_ROOT),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) return cb(new Error('Unsupported file type. Allowed: PDF, PNG, JPEG.'));
    cb(null, true);
  },
});

/** LMS-035: only where the leave type permits attachments; access is checked per NFR-10. */
async function uploadAttachment(req, res) {
  const { LeaveType } = require('../models');
  const request = await LeaveRequest.findByPk(req.params.requestId, { include: [LeaveType] });
  if (!request || String(request.employee_id) !== String(req.currentUser.employeeId)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Request not found.' } });
  }
  if (!request.LeaveType.permits_attachments) {
    return res.status(400).json({ success: false, error: { code: 'ATTACHMENTS_NOT_PERMITTED', message: `${request.LeaveType.type_name} does not permit attachments.` } });
  }

  const attachment = await LeaveRequestAttachment.create({
    request_id: request.request_id,
    file_name: req.file.originalname,
    content_type: req.file.mimetype,
    size_bytes: req.file.size,
    storage_path: req.file.path,
    uploaded_by: req.currentUser.employeeId,
  });

  await auditService.record({
    actorId: req.currentUser.employeeId, action: 'ATTACHMENT_UPLOADED', entityType: 'leave_request_attachments', entityId: attachment.attachment_id,
  });

  return res.status(201).json({ success: true, data: { attachment_id: attachment.attachment_id, file_name: attachment.file_name } });
}

/**
 * NFR-13/BR-42: only the employee, their approvers in the chain, and HR/Admin may
 * access an attachment — Watchers are excluded here at the query layer, never left
 * to the presentation layer to hide.
 */
async function downloadAttachment(req, res) {
  const attachment = await LeaveRequestAttachment.findByPk(req.params.attachmentId, { include: [LeaveRequest] });
  if (!attachment) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found.' } });

  const request = attachment.LeaveRequest;
  const isOwner = String(request.employee_id) === String(req.currentUser.employeeId);
  const isHrAdmin = req.currentUser.roles.includes('HR_ADMIN');
  const isCurrentApprover = String(request.current_approver_id) === String(req.currentUser.employeeId);

  if (!isOwner && !isHrAdmin && !isCurrentApprover) {
    return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have access to this attachment.' } });
  }

  return res.download(attachment.storage_path, attachment.file_name);
}

module.exports = { upload, uploadAttachment, downloadAttachment };
