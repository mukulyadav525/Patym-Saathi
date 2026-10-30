# Paytm Saathi — hackathon prototype (TeamAIR01)

An AI business partner for kirana merchants: one conversation to **plan → approve → act → verify**.
Android app (Expo) + web dashboard (Next.js) share one FastAPI backend and one PostgreSQL database.

> Independent hackathon concept. **Sample data. Suppliers are SIMULATED and payments are DEMO** unless
> real credentials are configured — the UI labels every simulated action.

## What works

| Flow | Status |
|---|---|
| Restock: "Weekend ke liye ₹5,000 ke andar stock arrange karo" → ₹4,650 plan (6 items, 31 packs) → approval 1 → Supplier A oil shortage → ₹4,850 re-plan via Supplier B → approval 2 → simulated orders → simulated delivery → inventory +31 packs | ✅ end-to-end, tested |
| Dues: INV-1042 Aman Stores ₹1,200 → payment-link draft → approval → DEMO link → simulated UPI payment → signed webhook → status check → 4 fields match → PAID | ✅ end-to-end, tested |
| Daily brief: 3 cited priorities, read-only | ✅ |
| Task inbox, approval history, inventory, invoices, orders, audit trail, connection status, demo reset | ✅ Android + web |
| Voice input (Sarvam STT) | Built; **needs `SARVAM_API_KEY`**, otherwise the app tells the user to type |
| Paytm staging adapter | **Not enabled** — refuses to run without credentials (never pretends) |

Safety properties enforced in backend code (see `backend/tests`): totals computed in code (Decimal), budget cap,
approvals bound to a SHA-256 payload hash + 10-min expiry + single use, material change supersedes approval,
idempotent confirm/webhooks, inventory changes only on goods receipt, invoice PAID only via verification path,
LLM restricted to read tools, merchant isolation, append-only audit log, RLS enabled on all tables.

## Repo

```
backend/   FastAPI · SQLAlchemy · Alembic · pytest      (app/services/restock.py = calculator)
mobile/    Expo SDK 58 · Expo Router · expo-secure-store · expo-audio · NetInfo
web/       Next.js 16 · Tailwind 4
shared/    api-types.ts generated from the FastAPI OpenAPI schema
```

## Run locally

Prereqs: Python via `uv`, Node 22, PostgreSQL (local) **or** a Supabase project.

```bash
createdb paytm_saathi && createdb paytm_saathi_test   # skip if using Supabase
cp backend/.env.example backend/.env                  # set DATABASE_URL for Supabase if used
npm install
npm run seed        # alembic upgrade + deterministic demo data
npm run api         # http://localhost:8000  (docs at /docs)
npm run web         # http://localhost:3000
npm run mobile      # Expo dev server; press a for Android, w for web preview
npm run test:api    # 30 backend tests
npm run types       # regenerate shared/api-types.ts (API must be running)
```

Demo login: `owner@sharma.demo`, password = `DEMO_PASSWORD` in `backend/.env` (seed default in `.env.example`).
A second merchant `owner@storeb.demo` exists only for isolation tests.

### Supabase

Use the Supabase Postgres connection string as `DATABASE_URL`, e.g.
`postgresql+psycopg://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`
(Session pooler or direct connection — the API keeps a connection pool, so avoid the transaction pooler).
Then `npm run seed`. Clients never talk to Supabase directly; RLS is on with no policies, so anon keys see nothing.
Auth is backend-issued JWT (HS256); `SUPABASE_JWT_SECRET` is also accepted if you move sign-in to Supabase Auth.

## Android APK

* **EAS (cloud)** — needs your Expo account: `cd mobile && npx eas-cli@latest login && npx eas-cli@latest build -p android --profile preview`.
  Set `EXPO_PUBLIC_API_BASE_URL` in `eas.json` → `preview` to the deployed API first.
* **Local demo APK** (no account; laptop API over the phone hotspot):
  ```bash
  cd mobile
  APP_VARIANT=demo-local EXPO_PUBLIC_API_BASE_URL=http://<laptop-ip>:8000 npx expo prebuild -p android --clean
  cd android && JAVA_HOME=<jdk17> ./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk
  ```
  `demo-local` is the only variant that allows plain HTTP, and only for the laptop demo.

## Deploy

* API: `render.yaml` (Docker, `backend/Dockerfile`). Set `DATABASE_URL`, `CORS_ORIGINS`, `DEMO_PASSWORD`, `APP_ENV=production`.
  Startup refuses default secrets outside development. Warm `/health` before demoing (free tiers sleep).
* Web: Vercel, root `web/`, env `NEXT_PUBLIC_API_BASE_URL=https://<api>`.
* Secrets stay on the API. Nothing secret goes in `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`.

## Demo script (≈4 min)

1. **Reset** (Business tab → Reset demo data, or web → Connections).
2. **Home**: dues ₹1,850, 5 low-stock items, 3 cited priorities.
3. **Saathi**: tap "Plan stock for weekend" → ₹4,650 plan → *Review & approve* → evidence (4-week sales, stock, quotes).
4. Approve ₹4,650 → **Supplier A: sunflower oil out of stock** → plan v2 ₹4,850 (+₹200, Metro Wholesale) → old approval superseded.
5. Approve ₹4,850 (or show it on the **web inbox** — same task) → *Simulate delivery* → inventory +31 packs, "₹150 under limit".
6. **Dues**: INV-1042 → *Create payment link* → approve → DEMO link + Hindi message → *Simulate customer UPI payment* → 4/4 checks → PAID.
7. **Activity / Audit**: every plan, approval, adapter call, with timestamps.

Honest answers: suppliers are simulated; who pays suppliers is an open product decision (COD/UPI on delivery, outside Saathi);
Paytm merchant-level access needs a partnership + credentials; sales/stock are sample POS data, never inferred from payments.
