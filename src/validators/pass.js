const { z } = require("zod");

const createAllocationSchema = z.object({
  exhibitorProfileId: z.coerce.number().int().positive(),
  passTypeId: z.coerce.number().int().positive(),
  allocatedQty: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional()
});

const issuePassSchema = z.object({
  allocationId: z.coerce.number().int().positive(),
  holderFirstName: z.string().trim().min(1).max(100),
  holderLastName: z.string().trim().min(1).max(100),
  holderEmail: z.string().trim().email().max(254).optional(),
  holderPhone: z.string().trim().max(30).optional(),
  holderJobTitle: z.string().trim().max(150).optional()
});

const voidPassSchema = z.object({
  voidReason: z.string().trim().max(1000).optional()
});

module.exports = { createAllocationSchema, issuePassSchema, voidPassSchema };
