const { z } = require("zod");

const COMPANY_TYPES = ["private_limited", "public_limited", "partnership", "llp", "proprietorship", "ngo", "government", "other"];

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

const registerSchema = z.object({
  companyLegalName: z.string().trim().min(2).max(255),
  companyDisplayName: z.string().trim().min(2).max(255),
  companyType: z.enum(COMPANY_TYPES),
  industryType: z.string().trim().max(100).optional().default(""),
  website: z.string().trim().max(1024).optional().default(""),
  addressLine1: z.string().trim().min(2).max(255),
  addressLine2: z.string().trim().max(255).optional().default(""),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().max(100).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  country: z.string().trim().min(2).max(100),
  companyPhone: z.string().trim().min(6).max(30),
  companyEmail: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  phone: z.string().trim().max(30).optional().default("")
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1, "Password is required.")
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254)
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema
});

const switchEventSchema = z.object({
  eventId: z.coerce.number().int().positive()
});

module.exports = {
  COMPANY_TYPES,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  switchEventSchema
};
