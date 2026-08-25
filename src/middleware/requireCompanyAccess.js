const { ApiError } = require("./errorHandler");
const asyncHandler = require("./asyncHandler");

const ADMIN_TIER_ROLES = ["super_admin", "organiser", "finance"];

// Factory so every exhibitor-scoped route can state exactly how to find the
// company_id it's guarding — either a route param name (the common case) or
// an async resolver that looks the owning company up from the resource itself
// (e.g. an order/pass/submission id in the URL). Admin-tier roles always pass;
// everyone else must own the resolved company.
function requireCompanyAccess(resolver = "companyId") {
  return asyncHandler(async (req, res, next) => {
    if (ADMIN_TIER_ROLES.includes(req.user.role)) return next();

    const targetCompanyId = typeof resolver === "function" ? await resolver(req) : Number(req.params[resolver]);

    if (!targetCompanyId || !req.user.companyId || Number(targetCompanyId) !== Number(req.user.companyId)) {
      throw new ApiError(403, "You do not have access to this company's data.");
    }

    next();
  });
}

module.exports = requireCompanyAccess;
