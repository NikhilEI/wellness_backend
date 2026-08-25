// Wraps an async route handler so a rejected promise reaches errorHandler
// instead of crashing the request unhandled.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
