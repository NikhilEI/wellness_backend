const { z } = require("zod");

const sendNotificationSchema = z
  .object({
    target: z.enum(["all", "companies"]),
    companyIds: z.array(z.coerce.number().int().positive()).optional(),
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(2000),
    type: z.enum(["info", "success", "warning", "error"]).default("info")
  })
  .refine((data) => data.target !== "companies" || (data.companyIds && data.companyIds.length > 0), {
    message: "Please select at least one exhibitor company.",
    path: ["companyIds"]
  });

module.exports = { sendNotificationSchema };
