const { z } = require("zod");

// One schema per form_templates.slug — the actual enforcement mechanism for
// fix #2 ("POST /forms/submissions/:slug accepts arbitrary JSON"). File-type
// fields (policy_document, noc_document) are handled separately via
// POST /documents with a submissionId, not as part of this JSON payload.

const badgesSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  designation: z.string().trim().min(1).max(150),
  companyName: z.string().trim().min(1).max(255),
  country: z.string().trim().min(1).max(100),
  countryCode: z.string().trim().min(1).max(10),
  mobileNo: z.string().trim().min(6).max(20),
  email: z.string().trim().email().max(254)
});

const stallDesignApprovalSchema = z.object({
  designType: z.enum(["Shell Scheme", "Raw Space Custom"]),
  designerName: z.string().trim().min(1).max(150),
  maxHeightM: z.coerce.number().positive().max(20),
  notes: z.string().trim().max(2000).optional()
});

const electricalRequirementSchema = z.object({
  connectionType: z.enum(["5A", "15A", "3-Phase"]),
  loadKw: z.coerce.number().positive().max(1000),
  backupRequired: z.coerce.boolean().optional().default(false)
});

const insuranceComplianceSchema = z.object({
  insurerName: z.string().trim().min(1).max(150),
  policyNumber: z.string().trim().min(1).max(100),
  coverageAmount: z.coerce.number().positive()
});

const materialMovementSchema = z.object({
  movementType: z.enum(["Move-In", "Move-Out"]),
  preferredDate: z.string().date(),
  vehicleType: z.string().trim().max(100).optional(),
  vehicleNumber: z.string().trim().max(30).optional()
});

const cateringFnbSchema = z.object({
  serviceDate: z.string().date(),
  headcount: z.coerce.number().int().positive().max(10000),
  menuPreference: z.enum(["Veg", "Non-Veg", "Mixed"]),
  specialRequests: z.string().trim().max(2000).optional()
});

const avEquipmentSchema = z.object({
  equipment: z.string().trim().min(1).max(2000),
  quantity: z.coerce.number().int().positive().max(1000),
  requiredFrom: z.string().date()
});

const safetyFireNocSchema = z.object({
  fireExtinguishers: z.coerce.number().int().nonnegative(),
  contactName: z.string().trim().min(1).max(150),
  contactPhone: z.string().trim().min(6).max(20)
});

const translatorsSchema = z.object({
  requests: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(150),
        fromLanguage: z.string().trim().min(1).max(100),
        toLanguage: z.string().trim().min(1).max(100),
        personnel: z.coerce.number().int().positive().max(100),
        date: z.string().date()
      })
    )
    .min(1)
});

const securityPersonnelSchema = z.object({
  requests: z
    .array(
      z.object({
        personnelType: z.enum(["Security Guard", "Security Supervisor"]),
        personnel: z.coerce.number().int().positive().max(100),
        fromDate: z.string().date(),
        fromTime: z.string().trim().min(1).max(10),
        toDate: z.string().date(),
        toTime: z.string().trim().min(1).max(10)
      })
    )
    .min(1)
});

const additionalPowerSupplySchema = z.object({
  kwRequired: z.coerce.number().positive().max(10000)
});

const outdoorSpaceSchema = z.object({
  sqmsRequired: z.coerce.number().positive().max(100000)
});

const FORM_SCHEMAS = new Map([
  ["badges", badgesSchema],
  ["stall-design-approval", stallDesignApprovalSchema],
  ["electrical-requirement", electricalRequirementSchema],
  ["insurance-compliance", insuranceComplianceSchema],
  ["material-movement", materialMovementSchema],
  ["catering-fnb", cateringFnbSchema],
  ["av-equipment", avEquipmentSchema],
  ["safety-fire-noc", safetyFireNocSchema],
  ["translators", translatorsSchema],
  ["security-personnel", securityPersonnelSchema],
  ["additional-power-supply", additionalPowerSupplySchema],
  ["outdoor-space", outdoorSpaceSchema]
]);

module.exports = { FORM_SCHEMAS };
