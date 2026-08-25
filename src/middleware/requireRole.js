const { ApiError } = require("./errorHandler");

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      console.warn(`Exhibitor Zone: role check failed — user ${req.user?.id} (${req.user?.role}) tried ${req.method} ${req.originalUrl}`);
      return next(new ApiError(403, "You do not have permission to perform this action."));
    }
    next();
  };
}

module.exports = requireRole;
