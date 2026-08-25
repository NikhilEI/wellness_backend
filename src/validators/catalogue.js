const { z } = require("zod");

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(255),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only."),
  description: z.string().trim().max(2000).optional(),
  sortOrder: z.coerce.number().int().default(0)
});

const createItemSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2000).optional(),
  unit: z.string().trim().max(50).optional(),
  priceInr: z.coerce.number().nonnegative(),
  priceUsd: z.coerce.number().nonnegative().optional(),
  lateSurchargePct: z.coerce.number().min(0).max(100).default(0),
  taxRatePct: z.coerce.number().min(0).max(100).default(0),
  minOrderQty: z.coerce.number().int().positive().default(1),
  maxOrderQty: z.coerce.number().int().positive().optional(),
  inventoryTotal: z.coerce.number().int().nonnegative().optional()
});

const updateItemSchema = createItemSchema.partial().extend({
  isActive: z.coerce.boolean().optional()
});

module.exports = { createCategorySchema, createItemSchema, updateItemSchema };
