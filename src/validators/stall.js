const { z } = require("zod");

const createStallSchema = z.object({
  stallNumber: z.string().trim().min(1).max(30),
  hall: z.string().trim().max(100).optional(),
  block: z.string().trim().max(50).optional(),
  stallType: z.string().trim().max(100).optional(),
  areaSqm: z.coerce.number().positive().optional(),
  priceInr: z.coerce.number().nonnegative().optional(),
  priceUsd: z.coerce.number().nonnegative().optional()
});

const updateStallSchema = createStallSchema.partial().extend({
  status: z.enum(["available", "held", "booked", "blocked"]).optional()
});

const createAllocationSchema = z.object({
  stallId: z.coerce.number().int().positive(),
  exhibitorProfileId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional()
});

module.exports = { createStallSchema, updateStallSchema, createAllocationSchema };
