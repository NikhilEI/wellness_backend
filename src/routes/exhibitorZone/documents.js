const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireEventContext = require("../../middleware/requireEventContext");
const { upload, sha256File } = require("../../middleware/upload");
const { ApiError } = require("../../middleware/errorHandler");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser", "finance"];

router.use(requireAuth, requireEventContext);

async function resolveOwnProfileId(req) {
  if (!req.user.companyId) throw new ApiError(404, "No company profile is associated with this account.");
  const [rows] = await pool.query(
    "SELECT id FROM exhibitor_event_profiles WHERE event_id = ? AND company_id = ? LIMIT 1",
    [req.user.eventId, req.user.companyId]
  );
  if (rows.length === 0) throw new ApiError(404, "No exhibitor profile found for the active event.");
  return rows[0].id;
}

async function assertProfileAccess(req, profileId) {
  if (ADMIN_ROLES.includes(req.user.role)) return;
  const own = await resolveOwnProfileId(req);
  if (Number(own) !== Number(profileId)) {
    throw new ApiError(403, "You do not have access to this profile's documents.");
  }
}

router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "No file was uploaded.");

    const documentType = String(req.body.documentType || "other").slice(0, 50);
    let exhibitorProfileId = req.body.exhibitorProfileId ? Number(req.body.exhibitorProfileId) : null;

    if (!ADMIN_ROLES.includes(req.user.role)) {
      exhibitorProfileId = await resolveOwnProfileId(req);
    } else if (!exhibitorProfileId) {
      fs.unlink(req.file.path, () => {});
      throw new ApiError(400, "exhibitorProfileId is required when an admin uploads on behalf of an exhibitor.");
    }

    const checksum = await sha256File(req.file.path);

    const [result] = await pool.query(
      `INSERT INTO document_uploads
        (uuid, event_id, exhibitor_profile_id, uploaded_by, document_type, original_filename,
         stored_filename, storage_path, storage_backend, mime_type, file_size_bytes, checksum_sha256,
         is_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, 0, NOW())`,
      [
        crypto.randomUUID(),
        req.user.eventId,
        exhibitorProfileId,
        req.user.id,
        documentType,
        req.file.originalname,
        req.file.filename,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        checksum
      ]
    );

    res.status(201).json({ message: "Document uploaded.", documentId: result.insertId });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    let profileId = req.query.exhibitorProfileId ? Number(req.query.exhibitorProfileId) : null;

    if (!ADMIN_ROLES.includes(req.user.role)) {
      profileId = await resolveOwnProfileId(req);
    }

    const params = [req.user.eventId];
    let profileFilter = "";
    if (profileId) {
      profileFilter = "AND exhibitor_profile_id = ?";
      params.push(profileId);
    }

    const [rows] = await pool.query(
      `SELECT id, uuid, exhibitor_profile_id, document_type, original_filename, mime_type,
              file_size_bytes, is_verified, verified_at, created_at
       FROM document_uploads
       WHERE event_id = ? AND deleted_at IS NULL ${profileFilter}
       ORDER BY created_at DESC`,
      params
    );

    res.json({ documents: rows });
  })
);

router.get(
  "/:id/file",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM document_uploads WHERE id = ? AND deleted_at IS NULL LIMIT 1", [
      req.params.id
    ]);
    const doc = rows[0];
    if (!doc) throw new ApiError(404, "Document not found.");

    await assertProfileAccess(req, doc.exhibitor_profile_id);

    if (!fs.existsSync(doc.storage_path)) throw new ApiError(404, "File is missing from storage.");

    res.setHeader("Content-Type", doc.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.original_filename)}"`);
    fs.createReadStream(doc.storage_path).pipe(res);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM document_uploads WHERE id = ? AND deleted_at IS NULL LIMIT 1", [
      req.params.id
    ]);
    const doc = rows[0];
    if (!doc) throw new ApiError(404, "Document not found.");

    await assertProfileAccess(req, doc.exhibitor_profile_id);

    await pool.query("UPDATE document_uploads SET deleted_at = NOW() WHERE id = ?", [doc.id]);
    fs.unlink(doc.storage_path, () => {});

    res.json({ message: "Document deleted." });
  })
);

module.exports = router;
