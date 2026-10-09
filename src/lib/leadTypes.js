// Whitelist of lead tabs. Table/column names come only from here, never from the request,
// so interpolating them into SQL below is safe.
const LEAD_TYPES = {
  "space-booking": {
    label: "Space Booking",
    table: "space_bookings",
    columns: [
      ["id", "ID"],
      ["created_at", "Submitted"],
      ["first_name", "First Name"],
      ["last_name", "Last Name"],
      ["organisation", "Organisation"],
      ["designation", "Designation"],
      ["email", "Email"],
      ["mobile_no", "Mobile"],
      ["city", "City"],
      ["country", "Country"],
      ["shell_space", "Space Required"],
      ["learn_about_expo", "Heard About Expo"],
      ["source", "Source"]
    ],
    search: ["first_name", "last_name", "organisation", "email", "mobile_no", "city"]
  },
  visitors: {
    label: "Visitors",
    table: "visitor_registrations",
    columns: [
      ["id", "ID"],
      ["created_at", "Submitted"],
      ["registration_id", "Reg. ID"],
      ["title", "Title"],
      ["first_name", "First Name"],
      ["last_name", "Last Name"],
      ["organisation", "Organisation"],
      ["designation", "Designation"],
      ["department", "Department"],
      ["email", "Email"],
      ["country_code", "Dial Code"],
      ["mobile", "Mobile"],
      ["city", "City"],
      ["state", "State"],
      ["country", "Country"],
      ["visit_objective", "Visit Objective"],
      ["product_interests", "Product Interests"],
      ["marketing_consent", "Marketing Consent"]
    ],
    search: ["registration_id", "first_name", "last_name", "organisation", "email", "mobile", "city"]
  },
  speakers: {
    label: "Speakers",
    table: "speaker_registrations",
    columns: [
      ["id", "ID"],
      ["created_at", "Submitted"],
      ["title", "Title"],
      ["first_name", "First Name"],
      ["last_name", "Last Name"],
      ["organisation", "Organisation"],
      ["designation", "Designation"],
      ["email", "Email"],
      ["mobile", "Mobile"],
      ["address", "Address"],
      ["city", "City"],
      ["state", "State"],
      ["zip_code", "Zip"],
      ["country", "Country"]
    ],
    search: ["first_name", "last_name", "organisation", "email", "mobile", "city"]
  },
  media: {
    label: "Media",
    table: "media_registrations",
    columns: [
      ["id", "ID"],
      ["created_at", "Submitted"],
      ["media_name", "Media House"],
      ["press_card_no", "Press Card No."],
      ["full_name", "Name"],
      ["designation", "Designation"],
      ["email", "Email"],
      ["mobile", "Mobile"],
      ["city", "City"],
      ["country", "Country"]
    ],
    search: ["media_name", "full_name", "email", "mobile", "city"]
  },
  "hosted-buyers": {
    label: "Hosted Buyers",
    table: "hosted_buyer_registrations",
    columns: [
      ["id", "ID"],
      ["created_at", "Submitted"],
      ["full_name", "Name"],
      ["designation", "Designation"],
      ["company", "Company"],
      ["email", "Email"],
      ["mobile", "Mobile"],
      ["city", "City"],
      ["country", "Country"],
      ["website", "Website"],
      ["outlets", "Outlets"],
      ["company_turnover", "Turnover"],
      ["company_profile", "Company Profile"]
    ],
    search: ["full_name", "company", "email", "mobile", "city"]
  },
  brochure: {
    label: "Brochure Downloads",
    table: "brochure_downloads",
    columns: [
      ["id", "ID"],
      ["created_at", "Submitted"],
      ["full_name", "Name"],
      ["designation", "Designation"],
      ["company_name", "Company"],
      ["industry", "Industry"],
      ["interest", "Interest"],
      ["email", "Email"],
      ["country_code", "Dial Code"],
      ["mobile", "Mobile"],
      ["country", "Country"]
    ],
    search: ["full_name", "company_name", "email", "mobile"]
  },
  newsletter: {
    label: "Newsletter",
    table: "newsletter_subscribers",
    columns: [
      ["id", "ID"],
      ["created_at", "Subscribed"],
      ["email", "Email"],
      ["source_page", "Source Page"]
    ],
    search: ["email"]
  }
};

module.exports = { LEAD_TYPES };
