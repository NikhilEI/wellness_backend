const { z } = require("zod");

const exhibitorInformationSchema = z.object({
  companyName: z.string().trim().min(1).max(255),
  brandName: z.string().trim().min(1).max(255),
  hallNo: z.string().trim().max(50).optional(),
  zone: z.string().trim().max(100).optional(),
  boothNo: z.string().trim().max(50).optional(),
  boothType: z.enum(["Raw Space", "Shell Space"]),
  country: z.string().trim().min(1).max(100),
  countryCode: z.string().trim().min(1).max(10),
  phoneNo: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(254),
  website: z.string().trim().max(500).optional(),
  companyProfile: z.string().trim().min(1).max(400),
  companyLogoDocumentId: z.coerce.number().int().positive()
});

const productInformationSchema = z.object({
  subcategoryIds: z.array(z.coerce.number().int().positive()).min(1),
  otherSpecification: z.string().trim().max(1000).optional()
});

const principalAgentRecordSchema = z
  .object({
    type: z.enum(["Principal", "Agent"]),
    companyName: z.string().trim().min(1).max(255),
    website: z.string().trim().max(500).optional(),
    countryName: z.string().trim().min(1).max(100),
    countryCode: z.string().trim().min(1).max(10),
    sectorId: z.coerce.number().int().positive().optional(),
    customSector: z.string().trim().max(255).optional()
  })
  .refine((data) => data.sectorId || data.customSector, {
    message: "Please select a sector or specify a custom sector.",
    path: ["sectorId"]
  })
  .refine((data) => !data.website || /^https?:\/\/.+/i.test(data.website), {
    message: "Please enter a valid URL (starting with http:// or https://).",
    path: ["website"]
  });

const principalAgentDeclarationSchema = z.object({
  noPrincipalAgent: z.boolean()
});

const soundNoiseAcknowledgementSchema = z.object({
  acknowledged: z.literal(true)
});

module.exports = {
  exhibitorInformationSchema,
  productInformationSchema,
  principalAgentRecordSchema,
  principalAgentDeclarationSchema,
  soundNoiseAcknowledgementSchema
};
