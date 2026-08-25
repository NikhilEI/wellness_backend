const { z } = require("zod");

const createEventSchema = z.object({
  name: z.string().trim().min(2).max(255),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only."),
  edition: z.string().trim().max(50).optional(),
  tagline: z.string().trim().max(500).optional(),
  venueName: z.string().trim().max(255).optional(),
  venueCity: z.string().trim().max(100).optional(),
  venueCountry: z.string().trim().max(100).optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  primaryCurrency: z.string().trim().length(3).default("INR"),
  timezone: z.string().trim().max(64).default("Asia/Kolkata"),
  status: z.enum(["draft", "published", "active", "completed", "cancelled"]).default("draft")
});

const updateEventSchema = createEventSchema.partial();

module.exports = { createEventSchema, updateEventSchema };
