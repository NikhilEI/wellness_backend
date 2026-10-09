# CRM Lead Feed API

Read-only API for pulling form leads into an external CRM. One dynamic endpoint serves every form.

**Base URL:** `http://localhost:4010/api/crm` (use your live API host in production)

## Authentication

Send an API key on every request, either way:

```
X-API-Key: <key>
Authorization: Bearer <key>
```

Keys live in `backend/.env` as `CRM_API_KEYS` (comma-separated, one per consumer so each can be revoked
on its own). If the variable is blank the API is disabled and returns `503`. Restart the backend after
changing it. Never put the key in a URL or query string.

## Endpoints

### `GET /forms`
Lists every form with its total, latest id, latest submission time, available fields and supported filters.

### `GET /leads/:form`

`:form` is one of: `space-booking`, `visitors`, `speakers`, `media`, `hosted-buyers`, `brochure`, `newsletter`.

| Param | Example | Meaning |
|---|---|---|
| `from` | `2026-10-01` or `2026-10-01T09:30:00+05:30` | Leads submitted on/after this. |
| `to` | `2026-10-09` | Leads submitted on/before this. A date-only value includes the **whole day**. |
| `since_id` | `120` | Only leads with `id` greater than this. Use for incremental sync. |
| `q` | `acme` | Text search across name, email, mobile, company, city. |
| `source` | `marketing` | `space-booking` only: `public` or `marketing`. |
| `order` | `asc` (default) / `desc` | Sort by `id`. |
| `limit` | `100` (default, max `500`) | Page size. |
| `page` | `1` | Page number. |
| `format` | `json` (default) / `csv` | `csv` returns all matches (up to 50,000 rows) and ignores `limit`/`page`. |

Date-only values are read in the server's time zone, the same zone submission times are stored in.

**Response (json):**

```json
{
  "form": "space-booking",
  "label": "Space Booking",
  "total": 6,
  "count": 2,
  "page": 1,
  "limit": 2,
  "totalPages": 3,
  "hasMore": true,
  "lastId": 5,
  "data": [ { "id": 3, "created_at": "2026-08-20T11:14:07.000Z", "first_name": "..." } ]
}
```

## Examples

```bash
# Everything from one form for a date range
curl -H "X-API-Key: $KEY" "http://localhost:4010/api/crm/leads/visitors?from=2026-10-01&to=2026-10-09"

# Incremental sync: store `lastId` from each run, pass it as since_id on the next
curl -H "X-API-Key: $KEY" "http://localhost:4010/api/crm/leads/space-booking?since_id=13&limit=500"

# Marketing-team space bookings only, as CSV
curl -H "X-API-Key: $KEY" "http://localhost:4010/api/crm/leads/space-booking?source=marketing&format=csv"
```

**Recommended sync loop:** call with `since_id=<last id you stored>`, keep requesting `page=2, 3, ...`
while `hasMore` is `true`, then save the final `lastId` for the next run.

## Errors

| Status | Meaning |
|---|---|
| `400` | Bad parameter (message says which). |
| `401` | Missing or invalid API key. |
| `404` | Unknown form (message lists valid ones). |
| `503` | No API keys configured. |

## Notes

- Responses contain personal data (names, emails, mobile numbers). Keep keys secret and use HTTPS in production.
- In CSV output, values starting with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets don't run them as
  formulas. That includes phone numbers like `+91...`; use `format=json` for clean machine import.
