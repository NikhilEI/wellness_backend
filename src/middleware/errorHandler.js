class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ message: "Not found." });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const body = { message: err.message };
    if (err.errors) body.errors = err.errors;
    return res.status(err.status).json(body);
  }

  console.error("Exhibitor Zone unhandled error:", err);
  res.status(500).json({ message: "Something went wrong. Please try again." });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
