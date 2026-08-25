const { ApiError } = require("./errorHandler");

// Almost every domain table is event-scoped; a session with no active event
// (e.g. a brand-new admin who hasn't picked one, or a user with zero grants)
// can't call these routes.
function requireEventContext(req, res, next) {
  if (!req.user || !req.user.eventId) {
    return next(new ApiError(400, "No active event selected."));
  }
  next();
}

module.exports = requireEventContext;
