# Harla V1 readiness checkpoint — 17 September 2026

## Latest continuation

- Resumed from PR #3 at `bb12707d403ce9a62bd2afa0aa5e4a9c47d22f82`. The matching Vercel preview was READY. Production has not been released.
- Browser access recovered using the authorized Vercel preview link. Restaurant staff sign-in rendered correctly, but the secure sign-in attempt returned **Invalid login credentials**. Authenticated restaurant, event and room checks remain blocked. This is a sign-in failure, not evidence that the preview is down. Do not repeat browser resets; use the existing sign-in page and secure/manual sign-in.
- Corrected restaurant staff payment labels to show verified transfer payment for approved orders; declined customer orders no longer imply that payment verification or kitchen handoff is still pending. The existing database stores payment method state separately from approval, so no payment-status schema change was needed.
- Restaurant staff footer now also uses `restaurant@harlahotel.com`. Public restaurant/menu/status pages already use it. Automated restaurant email notifications are still outside the implemented workflow.
- Applied and verified `20260917183832_v1_trigger_security_hardening`: fixed `set_updated_at()` search path and revoked client execution of the internal `rls_auto_enable()` event trigger. A rollback-only timestamp-trigger test and privilege assertions passed; the advisor no longer reports those issues.
- Reviewed the remaining public lookup and role-check functions: they intentionally return limited status/availability or a membership boolean. Do not revoke these customer APIs indiscriminately. The private inventory audit table intentionally has no client RLS policy. Leaked-password protection remains disabled and was not changed.
- Rechecked the three prior synthetic records: room cancelled with no inventory hold; restaurant declined and never sent to kitchen; event cancelled. This continuation created no new bookings and sent no test emails.
- JavaScript syntax, production build and restaurant regression checks passed after these edits. All four room/event workflow and PDF suites also passed again.
- The original release gate and post-deployment migration order below still apply. No further owner deployment approval is needed; working admin sign-in and the remaining operational checks are needed.

## Release status

PR #3: https://github.com/Zadil247/harla-hotel/pull/3

The restaurant implementation is published to `codex/v1-production-readiness`. Both Vercel previews built successfully. Production remains on `3d46c26264b8f2dbd5044f093b63c2b64c89d1a3`.

The owner explicitly approved publishing the source (including existing customer payment instructions) and creating, approving and cancelling synthetic test bookings and test emails. After the initial automatic approval rejection, the owner explicitly approved merging PR #3 into `main` and deploying to Vercel once the remaining checks pass. No further production approval is needed once that condition is met.

Email routing: room reservations use booking@harlahotel.com; events use events@harlahotel.com; the owner designated restaurant@harlahotel.com for restaurant contact and future restaurant email testing. Restaurant pages now show that address. Automated restaurant email notifications are not implemented in the current workflow; staff use the dashboard and customers use order-status lookup.

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

The owner confirmed receipt of both test emails in the designated room and event inboxes. This confirms delivery of the room confirmation and event-request acknowledgment; final event-confirmation email remains untested. No actual payment, stay, meal or event took place.

## Synthetic records and cleanup

- Room `HRB-MU4G34FM1JB`: cancelled; `inventory_hold_active=false`.
- Restaurant `HRL-51a53a67b1a5423fa2da64c12f39ce17`: declined; never sent to the kitchen.
- Event `HARLA-HALL-2026-0004`: cancelled.

Cleanup used narrowly targeted, owner-authorized database maintenance after the browser stalled. This does not count as a passing browser cancellation test. Synthetic records and clearly labelled test uploads remain for audit; no real customer records were changed.

## Remaining before full operational sign-off

- Complete the remaining checks below, then merge/deploy under the recorded owner approval and perform production smoke checks.
- Apply `20260916173605_restaurant_server_only_submissions.sql` ONLY AFTER the new restaurant API is live. It revokes direct client INSERT so canonical server prices cannot be bypassed. Then run `supabase/tests/restaurant_order_privacy.sql` and record the actual migration version. The earlier privacy and service-access migrations are already applied.
- Restaurant staff dashboard approval/proof/kitchen/availability checks with an authorized restaurant admin.
- Event-admin sign-in, quote/payment approval, final confirmation PDF/email and role-isolation checks. Room and event admin accounts are separate; no active account currently has both roles.
- Remaining browser cancellation, inventory override and mobile visual checks. The browser stalled after the PDF viewer/checkout interaction; a fresh-tab recovery also failed. No claim is made that these checks passed.
- Test the final event-confirmation email. Inbox receipt of the room confirmation and event-request acknowledgment is already owner-confirmed.
- International transfer instructions currently require hotel contact; optional Odoo product variants were not imported. Backup prices are the supplied source of truth.
- Review remaining Supabase advisor warnings (including mutable function search path and leaked-password protection) without indiscriminately revoking intended customer lookup functions.

V2 remains a separate rebuild and should start after V1 sign-off.
