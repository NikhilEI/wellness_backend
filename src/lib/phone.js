// Shared mobile-number handling for forms that let the visitor pick a country code.
// The OTP is verified against `${countryCode}${nationalNumber}`; India numbers (+91) are stored as the
// bare 10-digit number (as before), other countries are stored with their dial code so they stay unambiguous.
const DEFAULT_COUNTRY_CODE = "+91";
const COUNTRY_CODE_RE = /^\+[0-9]{1,4}$/;
const INTL_MOBILE_RE = /^[0-9]{6,15}$/;
const INDIA_MOBILE_RE = /^[0-9]{10}$/;

function parseMobile(rawCountryCode, rawMobile) {
  const countryCode = String(rawCountryCode || DEFAULT_COUNTRY_CODE).trim();
  const mobile = String(rawMobile || "").trim();
  if (!COUNTRY_CODE_RE.test(countryCode)) {
    return { ok: false, message: "Please select a valid country code." };
  }
  if (countryCode === DEFAULT_COUNTRY_CODE) {
    if (!INDIA_MOBILE_RE.test(mobile)) return { ok: false, message: "Please enter a valid 10-digit mobile number." };
  } else if (!INTL_MOBILE_RE.test(mobile)) {
    return { ok: false, message: "Please enter a valid mobile number." };
  }
  return {
    ok: true,
    countryCode,
    mobile,
    stored: countryCode === DEFAULT_COUNTRY_CODE ? mobile : `${countryCode}${mobile}`
  };
}

module.exports = { parseMobile };
