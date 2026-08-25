const { z } = require("zod");
const { COMPANY_TYPES } = require("./auth");

const createCompanySchema = z.object({
  legalName: z.string().trim().min(2).max(255),
  displayName: z.string().trim().min(2).max(255),
  companyType: z.enum(COMPANY_TYPES).optional(),
  industryType: z.string().trim().max(100).optional(),
  website: z.string().trim().max(1024).optional(),
  addressLine1: z.string().trim().min(2).max(255),
  addressLine2: z.string().trim().max(255).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(254).optional()
});

const updateCompanySchema = createCompanySchema.partial();

const createProfileSchema = z.object({
  eventId: z.coerce.number().int().positive(),
  companyId: z.coerce.number().int().positive(),
  participationType: z.enum(["standalone", "group", "pavilion", "co_exhibitor"]).optional(),
  category: z.string().trim().max(100).optional(),
  subCategory: z.string().trim().max(100).optional(),
  fasciaName: z.string().trim().max(255).optional()
});

const updateProfileStatusSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "suspended"]),
  rejectionReason: z.string().trim().max(1000).optional()
});

module.exports = { createCompanySchema, updateCompanySchema, createProfileSchema, updateProfileStatusSchema };
