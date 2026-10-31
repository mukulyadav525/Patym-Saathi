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
| Task inbox (approve/reject from the card), approval history, inventory, invoices, orders, payments & settlements, audit trail, connection status, demo reset | ✅ Android + web |
| Paytm for Business home (Android): Saathi as the NEW first tile, QR/Soundbox/Card/Loan pages, profile menu (settlements, notifications, Hindi/English, approval PIN, legal) | ✅ product pages are labelled prototype screens |
| Approval safety extras: optional 4-digit approval PIN (hashed, 5 tries → 10-min lock), renew an expired approval for the unchanged payload, read-back built from stored records | ✅ tested |
| **Grow with Saathi** (Android grid + web pages): Diwali/festival restock from last festival's sales, Hindi voice brief, Saathi impact, slow stock → customer offers (8 languages via Mayura), proactive Saathi check, 14-day cash-flow forecast, khata insights with suggested credit limits, supplier bill → stock (photo via Sarvam Document AI or typed), nearby-store benchmarks | ✅ computed from records, 69 backend tests; Sarvam parts need the key |
| **Soundbox & QR** (iPad, `/soundbox`): “Saathi, atta liya Mukul ne” → Sarvam STT + LLM → stock −1, bill SB-0001, khata credit or linked QR payment; asks back (“paise diye ya udhaar?”), undo, DEMO QR pay page + spoken “Paytm par ₹… prapt hue”; phone app and dashboard update live | ✅ end-to-end, 34 tests; voice needs the Sarvam key and https on the iPad |
| Voice input (Sarvam STT) and read-back audio (Bulbul) | Built; **needs `SARVAM_API_KEY`**, otherwise text input and text read-back |
| Paytm staging adapter (Create Link, Transaction Status v3, CHECKSUMHASH callbacks via `paytmchecksum`) | **Built to staging spec, tested with recorded mocks only**; set `PAYTM_ENV=staging`, `PAYTM_MID`, `PAYTM_MERCHANT_KEY` |

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

## Demo mode (fast, works on a phone hotspot)

Run everything on the laptop with the **local** Postgres (`DATABASE_URL=postgresql+psycopg://localhost/paytm_saathi?host=/tmp`):
every screen answers in ~10–20 ms. Using Supabase from a laptop in India adds a Delhi↔Singapore round trip per query
(0.5–2 s per screen), so use Supabase only when the API is deployed in the same region as the database.

```bash
npm run api:prod    # migrations + API, 2 workers, no reloader
npm run web:prod    # production build of the dashboard on :3000
```

**Voice:** say “Hey Saathi” while the app is open (on-device recognition; foreground only), or tap the mic in the tab bar.
Ask anything about the shop (“atta kitna bacha hai?”, “Aman ka kitna baaki hai?”, “pichhle hafte kitni bikri hui?”):
common questions are answered instantly from records; others by Sarvam with only this shop's data, and any number not in
the records is rejected. Answers are spoken back. Orders and payment links still need an on-screen approval.

## Soundbox & QR on an iPad (counter prototype)

A Paytm QR standee + Soundbox at `/soundbox`, meant for an iPad on the counter. The shopkeeper never opens the app:
they say **“Saathi, atta liya Mukul ne”** and the books update; the phone app and the dashboard show it within a second.

```bash
npm run api:prod     # API (Sarvam key in backend/.env)
npm run web:prod     # dashboard on :3000 (forwards /api/v1 to the API)
npm run soundbox     # https on :3443 for the iPad; prints the address and first-time steps
```

iPad Safari allows the microphone only on https. `npm run soundbox` makes a local certificate authority
(`certs/saathi-local-ca.pem`) and a certificate for the laptop's Wi-Fi address. Once per iPad: AirDrop the `.pem`,
install the profile (Settings → General → VPN & Device Management), then enable full trust (Settings → General → About
→ Certificate Trust Settings). Open the printed `https://<laptop-ip>:3443/soundbox`, sign in, tap **Start**, allow the mic.
Phone, iPad and laptop must be on the same Wi-Fi; if the laptop's address changes, use **Change** under the sign-in
form in the app.

How it works:
- **Listening:** the page detects sentences on the iPad and sends each one (16 kHz WAV) to the API; silence is never sent.
  Sarvam Saaras transcribes it; only sentences that *start* with “Saathi” (also heard as “Saath hi”, “Sarthi”) are
  acted on. A short answer to Saathi's own question (“udhaar”, “haan”) needs no wake word.
- **Understanding:** the Sarvam LLM turns the sentence into intent, items, quantities, customer and payment. Its output is
  checked: items must be in the catalog (prices from the catalog), customers from the khata, amounts must be in what was
  said, and the payment mode only comes from words actually spoken. Without the LLM a rule parser takes over.
- **Asking back:** “Paise diye ya udhaar likhun?”, “Kaunse Mukul?”, “Rohan naye customer hain. Unka khata kholun?”.
  A QR payment of the same amount answers “paise diye?” by itself.
- **Recording:** stock moves, the khata gets a credit or payment, the QR payment is linked, a bill number (SB-0001…) is
  given, with an audit event and a live event, in one transaction. “Saathi, cancel karo” or **Undo** reverses exactly
  that (30 minutes).
- **QR (DEMO):** the QR opens a practice pay page on the laptop; paying there (or **Customer pays** on the iPad) makes the
  Soundbox ding and say “Paytm par ₹420 prapt hue” with Sarvam Bulbul. No real money moves.
- **Live:** `/api/v1/live` is a long-poll feed; the app and the dashboard refresh their data and show a banner on each entry.

Try: “Saathi, atta liya Mukul ne” → “udhaar” · “Saathi, Priya ko do kilo cheeni di, paise de diye” ·
“Saathi, Mukul ne 200 diye” · “Saathi, Mukul ne atta wapas kiya” · “Saathi, atta kitna bacha hai?” · “Saathi, cancel karo”.

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
npm run test:api    # 69 backend tests
npm run types       # regenerate shared/api-types.ts (API must be running)
```

Demo login: `mukul24360@iiitd.ac.in`, password = `DEMO_PASSWORD` in `backend/.env` (seed default in `.env.example`).
A second merchant `owner@storeb.demo` exists only for isolation tests.

### Supabase

Use the Supabase Postgres connection string as `DATABASE_URL`, e.g.
`postgresql+psycopg://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`
(Session pooler or direct connection — the API keeps a connection pool, so avoid the transaction pooler).
Then `npm run seed`. Clients never talk to Supabase directly; RLS is on with no policies, so anon keys see nothing.
Auth is backend-issued JWT (HS256) only. Supabase is used as the Postgres database, not for sign-in.

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

Supabase (database) + Render (API, `render.yaml`) + Vercel (website, root `web/`, env `API_ORIGIN`) + EAS (APK).
Step by step: [docs/DEPLOY.md](docs/DEPLOY.md). Secrets stay on the API; nothing secret goes in `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`.

## Demo script (≈4 min)

Full script with checklist and prepared answers: [docs/demo-script.md](docs/demo-script.md).
Data retention, deletion and incident plan: [docs/data-and-privacy.md](docs/data-and-privacy.md).

1. **Reset** (Saathi → Business tab → Reset demo data, or web → Connections).
   The app opens on the Paytm for Business home; tap the **NEW Paytm Saathi** tile to sign in.
2. **Home**: dues ₹1,850, 5 low-stock items, 3 cited priorities.
3. **Saathi**: tap "Plan stock for weekend" → ₹4,650 plan → *Review & approve* → evidence (4-week sales, stock, quotes).
4. Approve ₹4,650 → **Supplier A: sunflower oil out of stock** → plan v2 ₹4,850 (+₹200, Metro Wholesale) → old approval superseded.
5. Approve ₹4,850 (or show it on the **web inbox** — same task) → *Simulate delivery* → inventory +31 packs, "₹150 under limit".
6. **Dues**: INV-1042 → *Create payment link* → approve → DEMO link + Hindi message → *Simulate customer UPI payment* → 4/4 checks → PAID.
7. **Activity / Audit**: every plan, approval, adapter call, with timestamps.

Honest answers: suppliers are simulated; who pays suppliers is an open product decision (COD/UPI on delivery, outside Saathi);
Paytm merchant-level access needs a partnership + credentials; sales/stock are sample POS data, never inferred from payments.
