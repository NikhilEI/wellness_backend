# Wellness India Expo — Backend

Node.js (Express) + MySQL API that powers two forms on the site in `../html`:

- Newsletter signup (footer form on `default.html`, `space-booking.html`, `response.html`, `response-newsletter.html`)
- Space booking / exhibitor enquiry (`space-booking.html`)

## Setup

1. Copy `.env.example` to `.env` and fill in your MySQL credentials.
2. Install dependencies:
   ```
   npm install
   ```
3. Create the database and tables:
   ```
   npm run db:migrate
   ```
   This runs `schema.sql`, which creates the `wellness_india_expo` database and the
   `newsletter_subscribers` and `space_bookings` tables (safe to re-run).
4. Start the API:
   ```
   npm start
   ```
   It listens on `PORT` from `.env` (default `4010`).

## Serving the frontend against this API

Two frontends can point at this API:

- `../latest` (Next.js) — `npm run dev` / `npm start` there both run on port `3010`
  (see its `package.json`). It reads `NEXT_PUBLIC_API_BASE_URL` from `.env.local`
  (default `http://localhost:4010/api`).
- `../html` — plain static HTML, served with any static file server, e.g.
  `npx serve ../html -l 8080`. It reads `window.WELLNESS_API_BASE` if set, otherwise
  falls back to `http://localhost:4010/api` (hardcoded in `js/site-forms.js`).

Either way, `CORS_ORIGIN` in `.env` must include whatever origin is actually serving
the frontend — it currently lists `http://localhost:8080` and `http://localhost:3010`.

## Endpoints

- `GET /api/health` — liveness check
- `POST /api/newsletter` — body `{ email, sourcePage? }`, upserts into `newsletter_subscribers`
- `POST /api/space-booking` — body matching the space-booking form fields, inserts into `space_bookings`
- `/api/exhibitor-zone/*` — see below

## Exhibitor Zone (admin panel + exhibitor portal)

A separate, session-authenticated system living in the same Express app, under
`src/routes/exhibitorZone/`. It shares the same `wellness_india_expo` database and
the same `src/db/pool.js` connection pool as the marketing routes above — there is
only one database. (It originally lived in a separate `exhibitor_zone` database;
all 34 of its tables were moved in with `RENAME TABLE ... TO wellness_india_expo...`
— five tables that collided with or duplicated existing marketing tables
— `visitor_registrations`, `otp_verifications`, `space_booking_inquiries`,
`speaker_registrations`, `brochure_download_leads` — were deliberately left behind
in the now-unused `exhibitor_zone` database, since this repo's marketing forms
already use their own same-named tables in `wellness_india_expo`.)

The bulk of the schema (users, companies, events, roles, user_event_roles, stalls,
catalogue, carts/orders/invoices, passes, forms, notifications, audit log — 34+
tables) was provisioned outside this repo. `exhibitor-zone/schema.sql` only adds
the one table this repo's code needed that wasn't already there (`notifications`,
an in-app inbox); `exhibitor-zone/seed.sql` fills in reference data the existing
seed didn't cover (event-role grant for the admin user, all 8 form templates, a
fuller service catalogue).

Setup (after the main `db:migrate`/`.env` steps above):

```
npm run db:migrate:exhibitor-zone
npm run db:seed:exhibitor-zone
```

The seed script also resets the admin account's password to a known value and
prints it to the console (override via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
env vars before seeding). Default seeded login:

- Email: `admin@exhibitorzone.com`
- Password: `ChangeMe123!`

Frontend: `../wellness_frontend_latest/src/app/exhibitor-zone/**`, served at
`/exhibitor-zone/*` on the same Next.js app (port 3010) as the marketing site —
it's a second Next.js root layout (own `<html>`, own Sneat-theme CSS), not sharing
markup or stylesheets with the marketing pages. Auth is a cookie session (not
JWT); `CORS_ORIGIN` must list the exact frontend origin and `credentials: true` is
already set on the `cors()` middleware for the cookie to work cross-port in dev.

Encrypted columns (`gst_number_enc`, etc.) require `ENCRYPTION_KEY` in `.env` — a
64-character hex string (32 bytes), see `.env.example` for how to generate one.
File uploads (company documents) are written to `UPLOAD_DIR` (default `./uploads`,
gitignored) — only local disk storage is implemented (`storage_backend='local'`);
S3/GCS are schema-level placeholders only.
