# Deploying Paytm Saathi

Three parts, one database:

| Part | Where | Address you get |
|---|---|---|
| Database | Supabase (Postgres), region Singapore | connection string |
| API (FastAPI) | Render, Docker, region Singapore | `https://paytm-saathi-api.onrender.com` |
| Website + Soundbox | Vercel, root `web/` | `https://<project>.vercel.app` |
| Android app | EAS build, profile `preview` | APK link |

The website forwards `/api/v1/*` to the API (Next.js rewrite), so the browser only talks to the Vercel address:
no CORS setup, and the Soundbox page is on https, so the iPad microphone works without any certificate.

## 1. Database (Supabase)
1. New project, region **Southeast Asia (Singapore)**, note the database password.
2. Project Settings → Database → Connection string → **Session pooler** (port 5432). Make it SQLAlchemy-style:
   `postgresql+psycopg://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`
   (not the transaction pooler on 6543).

## 2. API (Render)
1. Render → New → **Blueprint** → this GitHub repo. It reads `render.yaml`.
2. Fill the secrets it asks for: `DATABASE_URL` (step 1), `DEMO_PASSWORD` (your demo login password),
   `SARVAM_API_KEY`. `JWT_SECRET` and `DEMO_WEBHOOK_KEY` are generated.
3. Deploy. On boot it runs the migrations and loads the demo shop into the empty database.
4. Check `https://<api>/health` → `{"status":"ok", "database":"ok", "voice":"LIVE"}`.

## 3. Website (Vercel)
1. Vercel → Add New Project → this repo. **Root Directory: `web`**. Framework: Next.js (auto).
2. Environment variable: `API_ORIGIN = https://<your-render-api>` (no trailing slash). It is read at build time:
   after changing it, redeploy.
   Leave `NEXT_PUBLIC_API_BASE_URL` unset.
3. Deploy. Open `https://<project>.vercel.app`, sign in with `mukul24360@iiitd.ac.in` + `DEMO_PASSWORD`.
4. Soundbox for the iPad: `https://<project>.vercel.app/soundbox` (Safari, tap Start, allow the microphone).

## 4. Android app (EAS)
1. In `mobile/eas.json`, profile `preview`: set `EXPO_PUBLIC_API_BASE_URL` to `https://<your-render-api>`.
2. `cd mobile && npx eas-cli build -p android --profile preview` → APK link.
   (An https build always uses that server; the "Change server" option is only in local demo builds.)

## Before a demo
- Open `/health` a minute before (a free Render instance sleeps).
- Reset the demo data: Connections page → Reset demo data (or `POST /api/v1/demo/reset`).
- Rotate the Sarvam key after the event; it lives only in Render's environment.

## Limits to know
- Vercel forwards requests up to 4.5 MB: voice clips (≤2 MB) are fine; a bill photo over 4.5 MB must be taken
  at a lower resolution (phones' default camera photos are usually 2-4 MB).
- Payments are DEMO (the QR opens a practice pay page). Live Paytm needs `PAYTM_ENV=staging`, `PAYTM_MID`,
  `PAYTM_MERCHANT_KEY` and Paytm's callback URL pointed at `https://<api>/api/v1/webhooks/paytm`.
