const { z } = require("zod");

const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum(["unpaid", "partially_paid", "paid", "refunded"]),
  amountPaid: z.coerce.number().nonnegative().optional()
});

module.exports = { updatePaymentStatusSchema };
