# Harla V1 readiness checkpoint — 17 September 2026

## Account settings and resettable numbering — 24 September 2026

This section supersedes the earlier owner-review pause. The owner confirmed the corrected preview works and explicitly requested deployment of the new account and numbering controls.

- Added Account Settings to room, restaurant, event and master dashboards. Each user can change their login email/password after their current password is verified. Login email changes are administrator-assigned and explicitly confirmed twice in the form; they do not change mailbox passwords.
- Master Admin can create and edit department-only staff accounts. Other staff cannot list or edit these accounts; management accounts cannot be edited through department controls. Passwords are entered only in the website and are never recorded in audit logs.
- Rooms already uses booking@harlahotel.com; Events already uses events@harlahotel.com. Restaurant does not yet have its own login: owner must choose the password under Account Settings → Create Restaurant Login (restaurant@harlahotel.com is prefilled). No credentials were changed by this release, and no password was requested in chat. Master can choose its new email/password in Your Login; no destination was invented.
- Applied admin_request_numbering (local 20260924201301). Each service starts its next new request at #1. Master can start a new series at #1 whenever needed. Unique series/number pairs, transactional counter locks, immutable assigned numbers, stale-reset protection and audit entries preserve earlier records and permanent customer/payment references. Existing records show Earlier record. Excel includes the series and number.
- Live rollback-only numbering regression passed: increasing numbers, spoofed-number rejection, immutable prior numbers, reset to 1, retained history, stale reset rejection, master authorization, client denial and audit. No test records/counter changes retained.
- Account tests passed for guest/staff denial, current-password verification, service-only provisioning, protected management accounts, own-account updates and password-free audit. All seven workflow/report/account/PDF suites, production build, JavaScript syntax and diff checks passed.
- No new security advisor warnings from these changes; counter RLS intentionally has no client policy. Pre-existing customer lookup RPC and leaked-password-protection warnings remain.
- Production deployment is now authorized by the owner. Credential changes require the owner to enter chosen passwords after deployment. Signed-in browser credential changes were deliberately not performed with invented or chat-supplied passwords.

## Master dashboard loading fix — 24 September 2026

- Confirmed the reported loading failure in preview logs: dashboard requests returned PostgreSQL 42501 for restaurant_requests and package_bookings. The server role lacked SELECT on those two legacy enquiry tables.
- Applied manager_enquiry_read_access: SELECT only for service_role. Existing guest/staff privileges and RLS remain unchanged. No credentials, bookings or report settings were changed.
- Added and ran supabase/tests/manager_dashboard_access.sql against the live database as service_role. All six service projections, activity, master profile, report settings and report history queries passed. This covers the permission gap missed by the earlier local tests.
- Initial dashboard errors now replace the loading screen with an explicit error and Try Again button; API errors distinguish loading/access failures from report delivery failures.
- Manager reporting regression suite, production build and diff checks passed. Signed-in browser verification is still for the owner's review; no claim of a browser pass is made.
- Owner explicitly paused production to review the preview. Do not merge or deploy to harlahotel.com until that review and approval.

## Management release — current work (17 September 2026)

This section supersedes earlier UI/access notes below; the older entries are history.

- Owner confirmed the restaurant login works and requested a separate Master Admin, live oversight, configurable Excel email reports and weekly/monthly summaries. Existing passwords and login emails are unchanged.
- Added a management login/dashboard, server-enforced master membership, access to all three existing department dashboards, and a 10-second activity feed. Removed cross-department tabs from individual staff login/dashboard pages.
- Added private audit records for customer submissions and staff status/payment/kitchen/inventory actions. Verified server requests carry the staff identity; client-supplied actor headers cannot attribute actions to other staff.
- Added typed Excel reports for rooms, restaurant, events, tours, enquiries and activity. Reports use Ethiopia time, compare new records with the preceding equal-length period, and clearly distinguish recorded request/quote value from collected revenue. No paid AI service.
- Added configurable daily/weekly/monthly email reports and optional weekly/monthly summaries, private file storage, delivery history, retry leases and provider idempotency keys. The general manager's recipient email has not been supplied: delivery stays disabled until an authorized master saves it.
- Hotel/rooms/tours/events phone and WhatsApp: +251984517677. Restaurant phone and WhatsApp: +251984977677. Existing payment account numbers remain unchanged.
- Applied the master_admin_reporting schema migration and granted the existing owner account master membership using a private database operation. No credentials are recorded in the repository. New report/audit tables have RLS and no anon/authenticated privileges; report storage is private.
- All five existing workflow/PDF suites, new manager reporting/access tests, syntax checks and production build pass locally. Authenticated browser and final deployment verification remain pending.
- Deployment order: release the new API; apply restaurant_server_only_submissions and manager_report_scheduler; run privacy and live smoke checks. The scheduler uses Supabase Cron every five minutes and makes HTTP calls only for enabled, due schedules.
- Archived and removed 14 explicitly labelled test records: 9 rooms, 2 restaurant orders, 3 event bookings. Private recovery archive: harla_private.test_record_archive. Preserved 9 ambiguous/real room records, 5 restaurant records, 1 event record and 8 legacy event enquiries. Room capacities, rates, menus, halls and staff credentials are unchanged.
- Rollback-only live database tests passed: master-authorized room decline releases inventory and records the manager actor; restaurant approval records the staff identity. No test mutations were retained.

## Latest continuation

### Restaurant admin layout requested by the owner

- Rebuilt the basic restaurant admin page using the existing room/event admin layout: branded hero and logo, toolbar, status counts, order cards, search and order-type filters, private proof links, approval/decline/kitchen actions, and ordering availability.
- Added `restaurant-admin-login.html` with the same two-column protected sign-in layout, responsive navigation, useful authentication errors and links between Room, Event Hall and Restaurant Admin. Guest and unauthorized sessions cannot load the restaurant dashboard data; the existing server authorization is retained.
- Restaurant contact remains `restaurant@harlahotel.com`. A mailbox is not automatically a staff login. No authentication account or new administrator permission was created by this UI change.
- Production build, syntax validation and restaurant workflow/UI regression checks pass. Live authenticated operational tests remain pending working restaurant staff credentials; the prior deployment condition still applies.

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
