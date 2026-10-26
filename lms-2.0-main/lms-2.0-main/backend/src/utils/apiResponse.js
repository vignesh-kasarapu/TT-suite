function ok(res, data, meta = undefined) {
  return res.status(200).json({ success: true, data, meta });
}

function created(res, data) {
  return res.status(201).json({ success: true, data });
}

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

module.exports = { ok, created, fail };
