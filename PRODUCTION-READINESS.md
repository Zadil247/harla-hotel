# Harla V1 readiness checkpoint — 16 September 2026

## Release status

PR #3: https://github.com/Zadil247/harla-hotel/pull/3

The restaurant implementation is published to `codex/v1-production-readiness`. Both Vercel previews built successfully. Production remains on `3d46c26264b8f2dbd5044f093b63c2b64c89d1a3`.

The owner explicitly approved publishing the source (including existing customer payment instructions) and creating, approving and cancelling synthetic test bookings and test emails. Automatic approval review subsequently rejected the merge into `main`, requiring explicit approval for the production merge/deployment. Do not bypass that restriction with another deployment route.

## Implemented

- Import 155 distinct food/drink items across 12 categories and 60 photos from the supplied Odoo backup. Prices use the restaurant company's ETB tax settings. Merge one duplicate Special Ful. Exclude unrelated products, the SQL dump and private customer/business data.
- Replace the cancelled Odoo handoff with website ordering, private payment-proof uploads and a restaurant staff dashboard. Existing legacy restaurant-admin accounts authorize staff actions.
- Compute order prices on the server, validate quantities/payment requirements, use random references for retries, and preserve reference-plus-phone status lookup.
- Add approval/decline, kitchen handoff and ordering availability controls. Legacy `odoo_status` fields represent kitchen handoff for compatibility.
- Remove developer copy and empty social links. Improve cart spacing and customer payment-status labels.

## Verified

- Build and all five room/event/restaurant workflow and PDF regression suites passed. Restaurant tests cover catalogue/assets/prices, tampered client prices, invalid quantities, required proof, transitions and malformed requests.
- Preview browser: all 155 items load; search narrows Special Ful to one item; one unit totals 250 ETB; checkout creates a pending order.
- Restaurant customer lookup returns the synthetic order for its matching phone and no result for the wrong phone. Direct anonymous table reads are denied.
- Secure room-admin login and live inventory dashboard worked. The 1–2 February 2027 test stay returned eight available Queen rooms at 4,500 ETB.
- Room submission, private synthetic ID/proof uploads and admin confirmation worked. The official confirmation PDF was stored and its signed link opened in a new tab. The email provider accepted the confirmation to booking@harlahotel.com, with no stored error.
- Public event API created a pending request and the email provider accepted its acknowledgment to events@harlahotel.com. Valid portal token: HTTP 200; wrong token: HTTP 404; unauthenticated event-admin API: HTTP 403.
- All five guest/document/proof storage buckets are private.

Provider acceptance confirms email sending, not receipt in the destination inbox. No actual payment, stay, meal or event took place.

## Synthetic records and cleanup

- Room `HRB-MU4G34FM1JB`: cancelled; `inventory_hold_active=false`.
- Restaurant `HRL-51a53a67b1a5423fa2da64c12f39ce17`: declined; never sent to the kitchen.
- Event `HARLA-HALL-2026-0004`: cancelled.

Cleanup used narrowly targeted, owner-authorized database maintenance after the browser stalled. This does not count as a passing browser cancellation test. Synthetic records and clearly labelled test uploads remain for audit; no real customer records were changed.

## Remaining before full operational sign-off

- Explicit production merge/deployment approval, followed by production smoke checks.
- Apply `20260916173605_restaurant_server_only_submissions.sql` ONLY AFTER the new restaurant API is live. It revokes direct client INSERT so canonical server prices cannot be bypassed. Then run `supabase/tests/restaurant_order_privacy.sql` and record the actual migration version. The earlier privacy and service-access migrations are already applied.
- Restaurant staff dashboard approval/proof/kitchen/availability checks with an authorized restaurant admin.
- Event-admin sign-in, quote/payment approval, final confirmation PDF/email and role-isolation checks. Room and event admin accounts are separate; no active account currently has both roles.
- Remaining browser cancellation, inventory override and mobile visual checks. The browser stalled after the PDF viewer/checkout interaction; a fresh-tab recovery also failed. No claim is made that these checks passed.
- Confirm inbox receipt at both designated addresses. Event request acknowledgment passed; final event-confirmation sending remains untested.
- International transfer instructions currently require hotel contact; optional Odoo product variants were not imported. Backup prices are the supplied source of truth.
- Review remaining Supabase advisor warnings (including mutable function search path and leaked-password protection) without indiscriminately revoking intended customer lookup functions.

V2 remains a separate rebuild and should start after V1 sign-off.
