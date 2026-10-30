# Paytm Saathi — 4-minute demo script

Independent hackathon concept (TeamAIR01). Sample data. Suppliers SIMULATED, payments DEMO.

## Before you go on stage

- [ ] Laptop and demo phone on the same hotspot. Laptop IP matches the APK (`mobile/eas.json` → `demo-local`).
- [ ] `npm run api`, `npm run web` running; open `http://<laptop-ip>:8000/health` on the phone → `"status":"ok"`.
- [ ] Reset: Saathi → Business → **Reset demo data** (or web → Connections → Reset).
- [ ] Login on phone and web: `owner@sharma.demo`, password = `DEMO_PASSWORD`.
- [ ] No approval PIN set (Profile → Approval PIN shows "Off"), or tell the audience the PIN.
- [ ] Backup: the same flow on the web dashboard; backup video last.

## Script

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | Phone: Paytm for Business home | "Merchants already live in Paytm for Business. Saathi is a new entry at the top." Tap **Paytm Saathi (NEW)**. |
| 0:20 | Saathi home | Dues ₹1,850, last week ₹9,130, 3 cited priorities. "Every number cites its record; nothing is guessed from payments." |
| 0:40 | Saathi tab | Tap **Plan stock for weekend** (or say "Weekend ke liye ₹5,000 ke andar stock arrange karo"). Plan ₹4,650, 6 items, 31 packs. Open evidence: 4-week sales, stock, quotes with time. |
| 1:20 | Approval sheet | **Suno · Read back**, then **Approve ₹4,650**. "Voice never approves. The approval is bound to this exact plan and expires in 10 minutes." |
| 1:40 | Task | Supplier A: sunflower oil out of stock → plan v2 ₹4,850 (+₹200, Metro Wholesale). "Old approval is superseded automatically." |
| 2:10 | Web dashboard → Task inbox | Same task. Approve ₹4,850 here → **Simulate delivery** → inventory +31 packs (simulated). "₹150 under the limit." |
| 2:50 | Phone: Dues | INV-1042 Aman Stores ₹1,200 → **Create payment link** → approve → DEMO link + Hindi message → share sheet. |
| 3:20 | Task | **Simulate customer UPI payment** → signed webhook → server status check → 4/4 fields match → **PAID**. |
| 3:40 | Activity history | Every plan, approval, adapter call and check with timestamps. Close. |

## Prepared answers

- **Who pays suppliers?** Open product decision; today COD/UPI on delivery, outside Saathi.
- **Paytm access?** Merchant-level APIs need an authorised partnership and credentials. The staging adapter is
  *built to the Paytm staging spec and tested with mocks*; it has not been run against Paytm staging.
- **Data?** Sample POS/inventory records. Margins need sell and buy prices; payments alone cannot give them.
- **What is simulated?** Suppliers, deliveries, payments (DEMO adapter). Labelled on every screen.
- **Where does data live?** Prototype: Postgres (Supabase-ready). Designed to deploy inside Paytm's infrastructure.
