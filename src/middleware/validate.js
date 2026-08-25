const { ApiError } = require("./errorHandler");

// validate(schema, 'body' | 'query' | 'params') — 400s with per-field errors on
// failure, otherwise replaces req[source] with the parsed (typed/defaulted) value.
function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || source,
        message: issue.message
      }));
      return next(new ApiError(400, "Please check the highlighted fields.", errors));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = validate;
