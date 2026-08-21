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
