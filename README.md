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
   It listens on `PORT` from `.env` (default `4000`).

## Serving the frontend against this API

The `html/` folder is plain static HTML — serve it with any static file server, e.g.:

```
npx serve ../html -l 8080
```

Set `CORS_ORIGIN` in `.env` to match whatever origin serves the site (default assumes
`http://localhost:8080`). If the frontend runs on a different host/port, either update
`CORS_ORIGIN` or set `window.WELLNESS_API_BASE = "http://your-api-host:4000/api"` in a
`<script>` tag before `js/site-forms.js` loads on each page.

## Endpoints

- `GET /api/health` — liveness check
- `POST /api/newsletter` — body `{ email, sourcePage? }`, upserts into `newsletter_subscribers`
- `POST /api/space-booking` — body matching the space-booking form fields, inserts into `space_bookings`
