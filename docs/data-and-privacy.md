# Data, retention and incident plan (required before any real pilot)

Status: prototype with sample data only. This document defines what must be true before real merchant data is used.

## Data held

| Data | Where | Why | Retention (pilot) |
|---|---|---|---|
| Merchant + user account, password hash, optional approval PIN hash | `merchants`, `users` | Sign-in, approvals | Until account deletion |
| Stock, weekly sales, products (POS/MANUAL/SAMPLE provenance) | `inventory`, `sales_weekly`, `products` | Restock plans, brief | 13 months rolling |
| Supplier quotes | `supplier_quotes` | Plan pricing | 90 days |
| Tasks, plans, approvals, orders | `tasks`, `plans`, `approvals`, `orders` | Workflow + proof of approval | 3 years (business records) |
| Invoices, payment events (redacted payload, masked customer phone) | `invoices`, `payment_events` | Collection + verification | As required by payment regulations (period to be confirmed with Paytm compliance) |
| Audit trail (append-only) | `audit_events` | Accountability | Same as the record it describes |
| Voice audio | Not stored | Sent to Sarvam only when the mic is tapped | Not retained by Saathi |

POS/inventory data is stored separately from payment data and margins are never derived from payments.

## Consent

Each source in `data_connections` records `mode` and `consent_granted_at`, shown on the Connections screen.
Revoking consent sets the source to OFF; Saathi then reports the data as missing instead of inferring it.

## Deletion

- Merchant request → disable login immediately, delete operational data within 30 days, keep only records the
  law requires (payments, approvals) with personal fields minimised.
- Customer phone numbers are masked at ingestion; raw numbers are not stored in Saathi.

## Security controls in the build

- Secrets only on the API (`JWT_SECRET`, `DEMO_WEBHOOK_KEY`, `PAYTM_MERCHANT_KEY`, `SARVAM_API_KEY`); none in
  `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*`. API refuses to start outside development with default secrets.
- Every query filtered by merchant; RLS enabled on all tables (no client access).
- Approvals bound to a SHA-256 payload hash, 10-minute expiry, single use; optional PIN with lockout.
- Webhooks: signature verification, dedupe, server-side status check before PAID.

## Incident response

1. Detect: structured logs with correlation IDs; alerts on webhook signature failures and reconciliation spikes.
2. Contain: rotate the affected secret (JWT, webhook, Paytm key); disable the adapter (`PAYTM_ENV=demo`) to stop
   new links; revoke sessions by rotating `JWT_SECRET`.
3. Assess: audit trail shows every approval, adapter call and status check per merchant.
4. Notify: affected merchants and, where personal data is involved, the Data Protection Board per DPDP Act
   timelines; Paytm partner contacts per the partnership agreement.
5. Review: post-incident write-up within 5 working days.

## Backup / restore

Daily managed Postgres backups with point-in-time recovery (Supabase), restore tested before pilot.
`npm run seed` rebuilds the demo fixture only; it is not a backup.
