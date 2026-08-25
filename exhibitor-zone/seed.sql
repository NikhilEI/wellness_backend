-- Exhibitor Zone reference-data patch.
-- roles / events / pass_types / service_categories / event_settings are already
-- seeded in the real database (2026-08-20) and are left untouched here.
-- This file only fills in what's genuinely missing so the system is usable
-- end-to-end: the seeded admin's event-role grant, all 8 form templates
-- (currently 0), and a fuller service_items catalogue (currently 1 row).
-- Safe to re-run — every insert is guarded against duplicates.

USE wellness_india_expo;

-- ---------------------------------------------------------------------------
-- Grant the seeded admin user global super_admin access.
-- Without this, the doc-documented "no user_event_roles row -> silently
-- treated as exhibitor_staff" fallback applies and the seeded login is
-- effectively useless as an admin account.
-- ---------------------------------------------------------------------------

INSERT INTO user_event_roles (user_id, event_id, role_id, granted_at, is_active)
SELECT u.id, e.id, r.id, NOW(), 1
FROM users u
CROSS JOIN events e
CROSS JOIN roles r
WHERE u.email = 'admin@exhibitorzone.com'
  AND e.slug = 'ci-2027'
  AND r.name = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_event_roles x
    WHERE x.user_id = u.id AND x.role_id = r.id
  );

-- ---------------------------------------------------------------------------
-- Form templates (all 8 — the documented gap was only 5 of 8 seeded;
-- this instance had 0, so all 8 are added here).
-- `schema` is a JSON field-list used for display/reference; the authoritative
-- validation lives server-side in src/validators/forms.js (per-slug Zod).
-- ---------------------------------------------------------------------------

INSERT INTO form_templates (uuid, event_id, name, slug, description, form_type, `schema`, version, requires_approval, allow_multiple, is_active, sort_order, created_by)
SELECT UUID(), e.id, t.name, t.slug, t.description, t.form_type, t.schema_json, 1, t.requires_approval, t.allow_multiple, 1, t.sort_order, u.id
FROM events e
CROSS JOIN users u
CROSS JOIN (
  SELECT
    'Exhibitor Badges' AS name, 'badges' AS slug,
    'Nominate the staff who will hold your exhibitor badges for stand access.' AS description,
    'mandatory' AS form_type,
    '[{"name":"fullName","label":"Full Name","type":"text","required":true},{"name":"designation","label":"Designation","type":"text","required":true},{"name":"companyName","label":"Company Name","type":"text","required":true},{"name":"country","label":"Country","type":"text","required":true},{"name":"countryCode","label":"Country Code","type":"text","required":true},{"name":"mobileNo","label":"Mobile Number","type":"text","required":true},{"name":"email","label":"Email","type":"email","required":true}]' AS schema_json,
    1 AS requires_approval, 1 AS allow_multiple, 1 AS sort_order
  UNION ALL SELECT
    'Stall Design Approval', 'stall-design-approval',
    'Submit your custom stand design for organiser approval before build-up.',
    'mandatory',
    '[{"name":"designType","label":"Design Type","type":"select","options":["Shell Scheme","Raw Space Custom"],"required":true},{"name":"designerName","label":"Designer / Contractor Name","type":"text","required":true},{"name":"maxHeightM","label":"Maximum Structure Height (m)","type":"number","required":true},{"name":"notes","label":"Additional Notes","type":"textarea","required":false}]',
    1, 0, 2
  UNION ALL SELECT
    'Electrical Requirement', 'electrical-requirement',
    'Declare your stand''s electrical load and connection requirements.',
    'additional',
    '[{"name":"connectionType","label":"Connection Type","type":"select","options":["5A","15A","3-Phase"],"required":true},{"name":"loadKw","label":"Total Load (kW)","type":"number","required":true},{"name":"backupRequired","label":"Backup Power Required","type":"checkbox","required":false}]',
    1, 0, 3
  UNION ALL SELECT
    'Insurance & Compliance', 'insurance-compliance',
    'Confirm your public liability insurance and compliance documentation.',
    'mandatory',
    '[{"name":"insurerName","label":"Insurer Name","type":"text","required":true},{"name":"policyNumber","label":"Policy Number","type":"text","required":true},{"name":"coverageAmount","label":"Coverage Amount","type":"number","required":true},{"name":"policyDocument","label":"Policy Document (attach via Documents page)","type":"file","required":false}]',
    1, 0, 4
  UNION ALL SELECT
    'Material Movement', 'material-movement',
    'Request move-in/move-out slots and vehicle passes for your materials.',
    'additional',
    '[{"name":"movementType","label":"Movement Type","type":"select","options":["Move-In","Move-Out"],"required":true},{"name":"preferredDate","label":"Preferred Date","type":"date","required":true},{"name":"vehicleType","label":"Vehicle Type","type":"text","required":false},{"name":"vehicleNumber","label":"Vehicle Number","type":"text","required":false}]',
    0, 1, 5
  UNION ALL SELECT
    'Catering / F&B', 'catering-fnb',
    'Order in-stand catering and food & beverage service.',
    'additional',
    '[{"name":"serviceDate","label":"Service Date","type":"date","required":true},{"name":"headcount","label":"Headcount","type":"number","required":true},{"name":"menuPreference","label":"Menu Preference","type":"select","options":["Veg","Non-Veg","Mixed"],"required":true},{"name":"specialRequests","label":"Special Requests","type":"textarea","required":false}]',
    0, 1, 6
  UNION ALL SELECT
    'AV Equipment Request', 'av-equipment',
    'Request additional audio-visual equipment not covered by the catalogue.',
    'additional',
    '[{"name":"equipment","label":"Equipment Needed","type":"textarea","required":true},{"name":"quantity","label":"Quantity","type":"number","required":true},{"name":"requiredFrom","label":"Required From","type":"date","required":true}]',
    0, 1, 7
  UNION ALL SELECT
    'Safety & Fire NOC', 'safety-fire-noc',
    'Submit your stand''s fire and safety no-objection documentation.',
    'mandatory',
    '[{"name":"nocDocument","label":"NOC Document (attach via Documents page)","type":"file","required":false},{"name":"fireExtinguishers","label":"Fire Extinguishers on Stand","type":"number","required":true},{"name":"contactName","label":"Safety Contact Name","type":"text","required":true},{"name":"contactPhone","label":"Safety Contact Phone","type":"text","required":true}]',
    1, 0, 8
) t
WHERE e.slug = 'ci-2027'
  AND u.email = 'admin@exhibitorzone.com'
  AND NOT EXISTS (
    SELECT 1 FROM form_templates ft WHERE ft.event_id = e.id AND ft.slug = t.slug
  );

-- ---------------------------------------------------------------------------
-- Fill out the service catalogue (currently 1 item across 4 categories).
-- ---------------------------------------------------------------------------

INSERT INTO service_items (uuid, event_id, category_id, sku, name, description, unit, price_inr, price_usd, late_surcharge_pct, tax_rate_pct, min_order_qty, inventory_reserved, inventory_sold, requires_sq_footage, requires_terms, sort_order, is_active)
SELECT UUID(), e.id, sc.id, i.sku, i.name, i.description, i.unit, i.price_inr, i.price_usd, 15.00, 18.00, 1, 0, 0, 0, 0, i.sort_order, 1
FROM events e
JOIN service_categories sc ON sc.event_id = e.id
CROSS JOIN (
  SELECT 'electrical-power' AS cat_slug, 'ELEC-15AMP' AS sku, '15 Amp Single Phase Connection' AS name, '24-hour supply, single-phase.' AS description, 'each' AS unit, 3200.00 AS price_inr, 40.00 AS price_usd, 2 AS sort_order
  UNION ALL SELECT 'electrical-power', 'ELEC-3PHASE', '3-Phase Connection (per kW)', 'Industrial 3-phase supply, billed per kW.', 'kW', 1800.00, 22.00, 3
  UNION ALL SELECT 'furniture-fittings', 'FURN-COUNTER', 'Information Counter', 'Standard information counter with stool.', 'each', 2500.00, 32.00, 1
  UNION ALL SELECT 'furniture-fittings', 'FURN-CHAIR', 'Chrome Chair', 'Chrome-frame stacking chair.', 'each', 450.00, 6.00, 2
  UNION ALL SELECT 'furniture-fittings', 'FURN-TABLE4', 'Round Table (4-seater)', 'Round meeting table, seats 4.', 'each', 1800.00, 23.00, 3
  UNION ALL SELECT 'internet-connectivity', 'NET-WIFI', 'Wi-Fi Access (per device)', 'Dedicated Wi-Fi access for the event duration.', 'device', 1000.00, 13.00, 1
  UNION ALL SELECT 'internet-connectivity', 'NET-LAN', 'Wired LAN Connection', 'Dedicated 100 Mbps wired connection.', 'connection', 3500.00, 44.00, 2
  UNION ALL SELECT 'housekeeping', 'HK-DAILY', 'Stand Cleaning (daily)', 'Daily stand cleaning service.', 'day', 700.00, 9.00, 1
  UNION ALL SELECT 'housekeeping', 'HK-WASTE', 'Waste Removal (per day)', 'Daily waste removal service.', 'day', 500.00, 6.00, 2
) i ON i.cat_slug = sc.slug
WHERE e.slug = 'ci-2027'
  AND NOT EXISTS (
    SELECT 1 FROM service_items si WHERE si.event_id = e.id AND si.sku = i.sku
  );
