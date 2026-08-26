const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { resolveOwnProfileId } = require("../../utils/exhibitorProfile");
const { notifyAdmins } = require("../../utils/notify");
const {
  exhibitorInformationSchema,
  productInformationSchema,
  principalAgentRecordSchema,
  principalAgentDeclarationSchema,
  soundNoiseAcknowledgementSchema
} = require("../../validators/mandatoryForms");

const GUIDELINE_VERSION = 1;

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];

router.use(requireAuth, requireEventContext);

async function upsertFormStatus(connection, { profileId, eventId, formKey, status }) {
  await connection.query(
    `INSERT INTO mandatory_form_status (exhibitor_profile_id, event_id, form_key, status, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at), updated_at = NOW()`,
    [profileId, eventId, formKey, status, status === "completed" ? new Date() : null]
  );
}

// GET / — the registry of mandatory forms for the active event, each annotated
// with this exhibitor's own status. Powers both the dashboard summary and the
// dedicated Mandatory Forms tab. Adding a 3rd/4th/5th form later means only
// inserting a mandatory_form_definitions row — this endpoint picks it up
// automatically, no code change required here.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);

    const [rows] = await pool.query(
      `SELECT d.id, d.form_key, d.name, d.description, d.sort_order,
              COALESCE(s.status, 'pending') AS status, s.completed_at
       FROM mandatory_form_definitions d
       LEFT JOIN mandatory_form_status s
         ON s.form_key = d.form_key AND s.exhibitor_profile_id = ? AND s.event_id = d.event_id
       WHERE d.event_id = ? AND d.is_active = 1
       ORDER BY d.sort_order`,
      [profileId, req.user.eventId]
    );

    res.json({ forms: rows });
  })
);

// Admin variant — same registry, but for an arbitrary exhibitor profile.
router.get(
  "/status/:profileId",
  requireRole(...ADMIN_ROLES, "finance"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT d.id, d.form_key, d.name, d.sort_order,
              COALESCE(s.status, 'pending') AS status, s.completed_at
       FROM mandatory_form_definitions d
       LEFT JOIN mandatory_form_status s
         ON s.form_key = d.form_key AND s.exhibitor_profile_id = ? AND s.event_id = d.event_id
       WHERE d.event_id = ? AND d.is_active = 1
       ORDER BY d.sort_order`,
      [req.params.profileId, req.user.eventId]
    );
    res.json({ forms: rows });
  })
);

router.get(
  "/product-categories",
  asyncHandler(async (req, res) => {
    const [categories] = await pool.query("SELECT id, name, sort_order FROM product_categories ORDER BY sort_order");
    const [subcategories] = await pool.query(
      "SELECT id, category_id, name, sort_order FROM product_subcategories ORDER BY category_id, sort_order"
    );
    res.json({ categories, subcategories });
  })
);

router.get(
  "/exhibitor-information",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const [rows] = await pool.query(
      "SELECT * FROM exhibitor_directory_info WHERE exhibitor_profile_id = ? AND event_id = ? LIMIT 1",
      [profileId, req.user.eventId]
    );
    res.json({ info: rows[0] || null });
  })
);

router.patch(
  "/exhibitor-information",
  validate(exhibitorInformationSchema),
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const b = req.body;

    const [docRows] = await pool.query(
      "SELECT id FROM document_uploads WHERE id = ? AND exhibitor_profile_id = ? AND deleted_at IS NULL LIMIT 1",
      [b.companyLogoDocumentId, profileId]
    );
    if (docRows.length === 0) throw new ApiError(400, "Uploaded company logo could not be found. Please re-upload it.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO exhibitor_directory_info
          (exhibitor_profile_id, event_id, company_name, brand_name, hall_no, zone, booth_no, booth_type,
           country, country_code, phone_no, email, website, company_profile, company_logo_document_id,
           status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           company_name = VALUES(company_name), brand_name = VALUES(brand_name), hall_no = VALUES(hall_no),
           zone = VALUES(zone), booth_no = VALUES(booth_no), booth_type = VALUES(booth_type),
           country = VALUES(country), country_code = VALUES(country_code), phone_no = VALUES(phone_no),
           email = VALUES(email), website = VALUES(website), company_profile = VALUES(company_profile),
           company_logo_document_id = VALUES(company_logo_document_id), status = 'completed', updated_at = NOW()`,
        [
          profileId,
          req.user.eventId,
          b.companyName,
          b.brandName,
          b.hallNo || null,
          b.zone || null,
          b.boothNo || null,
          b.boothType,
          b.country,
          b.countryCode,
          b.phoneNo || null,
          b.email,
          b.website || null,
          b.companyProfile,
          b.companyLogoDocumentId
        ]
      );

      await upsertFormStatus(connection, {
        profileId,
        eventId: req.user.eventId,
        formKey: "exhibitor-information",
        status: "completed"
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    notifyAdmins(pool, req.user.eventId, {
      title: "Exhibitor Information submitted",
      message: `${b.companyName} submitted their Exhibitor Information form.`,
      type: "info"
    }).catch((err) => console.error("Failed to notify admins of exhibitor information submission:", err));

    res.json({ message: "Exhibitor Information saved." });
  })
);

router.get(
  "/product-information",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const [rows] = await pool.query(
      `SELECT epc.subcategory_id, epc.other_specification, psc.name AS subcategory_name, psc.category_id
       FROM exhibitor_product_categories epc
       JOIN product_subcategories psc ON psc.id = epc.subcategory_id
       WHERE epc.exhibitor_profile_id = ? AND epc.event_id = ?`,
      [profileId, req.user.eventId]
    );
    res.json({ selections: rows });
  })
);

router.patch(
  "/product-information",
  validate(productInformationSchema),
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const { subcategoryIds, otherSpecification } = req.body;

    const [validRows] = await pool.query(
      `SELECT id, name FROM product_subcategories WHERE id IN (${subcategoryIds.map(() => "?").join(",")})`,
      subcategoryIds
    );
    if (validRows.length !== subcategoryIds.length) {
      throw new ApiError(400, "One or more selected categories are invalid.");
    }

    const othersRow = validRows.find((r) => r.name === "Others");
    if (othersRow && subcategoryIds.includes(othersRow.id) && !otherSpecification) {
      throw new ApiError(400, "Please specify your category since 'Others' was selected.", [
        { field: "otherSpecification", message: "Please specify your category." }
      ]);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query("DELETE FROM exhibitor_product_categories WHERE exhibitor_profile_id = ? AND event_id = ?", [
        profileId,
        req.user.eventId
      ]);

      for (const subcategoryId of subcategoryIds) {
        const isOthers = othersRow && subcategoryId === othersRow.id;
        await connection.query(
          `INSERT INTO exhibitor_product_categories (exhibitor_profile_id, event_id, subcategory_id, other_specification, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [profileId, req.user.eventId, subcategoryId, isOthers ? otherSpecification : null]
        );
      }

      await upsertFormStatus(connection, {
        profileId,
        eventId: req.user.eventId,
        formKey: "product-information",
        status: "completed"
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    notifyAdmins(pool, req.user.eventId, {
      title: "Product Information submitted",
      message: "An exhibitor submitted their Product Information form.",
      type: "info"
    }).catch((err) => console.error("Failed to notify admins of product information submission:", err));

    res.json({ message: "Product Information saved." });
  })
);

router.get(
  "/principal-agent-sectors",
  asyncHandler(async (req, res) => {
    const [sectors] = await pool.query("SELECT id, name, sort_order FROM principal_agent_sectors ORDER BY sort_order");
    res.json({ sectors });
  })
);

router.get(
  "/principal-agent-information",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);

    const [records] = await pool.query(
      `SELECT r.id, r.type, r.company_name, r.website, r.country_name, r.country_code,
              r.sector_id, r.custom_sector, s.name AS sector_name, r.created_at, r.updated_at
       FROM principal_agent_records r
       LEFT JOIN principal_agent_sectors s ON s.id = r.sector_id
       WHERE r.exhibitor_profile_id = ? AND r.event_id = ?
       ORDER BY r.created_at`,
      [profileId, req.user.eventId]
    );

    const [metaRows] = await pool.query(
      "SELECT no_principal_agent FROM principal_agent_meta WHERE exhibitor_profile_id = ? AND event_id = ?",
      [profileId, req.user.eventId]
    );

    res.json({ records, noPrincipalAgent: metaRows.length > 0 ? !!metaRows[0].no_principal_agent : false });
  })
);

router.post(
  "/principal-agent-information/records",
  validate(principalAgentRecordSchema),
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const b = req.body;

    if (b.sectorId) {
      const [sectorRows] = await pool.query("SELECT id FROM principal_agent_sectors WHERE id = ?", [b.sectorId]);
      if (sectorRows.length === 0) throw new ApiError(400, "Selected sector is invalid.");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO principal_agent_records
          (exhibitor_profile_id, event_id, type, company_name, website, country_name, country_code, sector_id, custom_sector, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          profileId,
          req.user.eventId,
          b.type,
          b.companyName,
          b.website || null,
          b.countryName,
          b.countryCode,
          b.sectorId || null,
          b.sectorId ? null : b.customSector
        ]
      );

      await connection.query(
        `INSERT INTO principal_agent_meta (exhibitor_profile_id, event_id, no_principal_agent, created_at, updated_at)
         VALUES (?, ?, 0, NOW(), NOW())
         ON DUPLICATE KEY UPDATE no_principal_agent = 0, updated_at = NOW()`,
        [profileId, req.user.eventId]
      );

      await upsertFormStatus(connection, {
        profileId,
        eventId: req.user.eventId,
        formKey: "principal-agent-information",
        status: "completed"
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    notifyAdmins(pool, req.user.eventId, {
      title: "Principal / Agent Information submitted",
      message: "An exhibitor added a Principal/Agent record.",
      type: "info"
    }).catch((err) => console.error("Failed to notify admins of principal/agent submission:", err));

    res.status(201).json({ message: "Record added." });
  })
);

router.delete(
  "/principal-agent-information/records/:id",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const recordId = Number(req.params.id);
    if (!Number.isInteger(recordId) || recordId <= 0) throw new ApiError(400, "Invalid record id.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existing] = await connection.query(
        "SELECT id FROM principal_agent_records WHERE id = ? AND exhibitor_profile_id = ? AND event_id = ? FOR UPDATE",
        [recordId, profileId, req.user.eventId]
      );
      if (existing.length === 0) throw new ApiError(404, "Record not found.");

      await connection.query("DELETE FROM principal_agent_records WHERE id = ?", [recordId]);

      const [remaining] = await connection.query(
        "SELECT COUNT(*) AS count FROM principal_agent_records WHERE exhibitor_profile_id = ? AND event_id = ?",
        [profileId, req.user.eventId]
      );
      const [metaRows] = await connection.query(
        "SELECT no_principal_agent FROM principal_agent_meta WHERE exhibitor_profile_id = ? AND event_id = ?",
        [profileId, req.user.eventId]
      );
      const noPrincipalAgent = metaRows.length > 0 && !!metaRows[0].no_principal_agent;
      const status = remaining[0].count > 0 || noPrincipalAgent ? "completed" : "pending";

      await upsertFormStatus(connection, {
        profileId,
        eventId: req.user.eventId,
        formKey: "principal-agent-information",
        status
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    res.json({ message: "Record deleted." });
  })
);

router.patch(
  "/principal-agent-information/declaration",
  validate(principalAgentDeclarationSchema),
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const { noPrincipalAgent } = req.body;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existing] = await connection.query(
        "SELECT COUNT(*) AS count FROM principal_agent_records WHERE exhibitor_profile_id = ? AND event_id = ?",
        [profileId, req.user.eventId]
      );
      const recordCount = existing[0].count;
      if (noPrincipalAgent && recordCount > 0) {
        throw new ApiError(400, "Please delete your existing Principal/Agent records before selecting this option.");
      }

      await connection.query(
        `INSERT INTO principal_agent_meta (exhibitor_profile_id, event_id, no_principal_agent, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE no_principal_agent = VALUES(no_principal_agent), updated_at = NOW()`,
        [profileId, req.user.eventId, noPrincipalAgent ? 1 : 0]
      );

      await upsertFormStatus(connection, {
        profileId,
        eventId: req.user.eventId,
        formKey: "principal-agent-information",
        status: noPrincipalAgent || recordCount > 0 ? "completed" : "pending"
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    res.json({ message: "Saved." });
  })
);

router.get(
  "/sound-noise-guidelines",
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);
    const [rows] = await pool.query(
      "SELECT acknowledged, acknowledged_at, guideline_version FROM sound_noise_guideline_acknowledgement WHERE exhibitor_profile_id = ? AND event_id = ? LIMIT 1",
      [profileId, req.user.eventId]
    );
    res.json({ acknowledgement: rows[0] || null });
  })
);

router.patch(
  "/sound-noise-guidelines",
  validate(soundNoiseAcknowledgementSchema),
  asyncHandler(async (req, res) => {
    const profileId = await resolveOwnProfileId(pool, req);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO sound_noise_guideline_acknowledgement
          (exhibitor_profile_id, event_id, acknowledged, acknowledged_at, guideline_version, created_at, updated_at)
         VALUES (?, ?, 1, NOW(), ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE acknowledged = 1, acknowledged_at = NOW(), guideline_version = VALUES(guideline_version), updated_at = NOW()`,
        [profileId, req.user.eventId, GUIDELINE_VERSION]
      );

      await upsertFormStatus(connection, {
        profileId,
        eventId: req.user.eventId,
        formKey: "sound-noise-guidelines",
        status: "completed"
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    notifyAdmins(pool, req.user.eventId, {
      title: "Sound & Noise Guidelines acknowledged",
      message: "An exhibitor acknowledged the Sound & Noise Level Guidelines.",
      type: "info"
    }).catch((err) => console.error("Failed to notify admins of sound/noise acknowledgement:", err));

    res.json({ message: "Acknowledgement saved." });
  })
);

module.exports = router;
