// Shared server-side length/format guards so oversized input is rejected with a clear
// message instead of being truncated or failing at the database.

// limits: { fieldKey: [label, maxLength] } — returns an error message or null.
function checkMaxLengths(data, limits) {
  for (const [key, [label, max]] of Object.entries(limits)) {
    if (data[key] && data[key].length > max) {
      return `${label} must be ${max} characters or fewer.`;
    }
  }
  return null;
}

const COUNTRY_CODE_RE = /^\+[0-9]{1,4}$/;
const ZIP_RE = /^[A-Za-z0-9][A-Za-z0-9\s-]{1,19}$/;

module.exports = { checkMaxLengths, COUNTRY_CODE_RE, ZIP_RE };
