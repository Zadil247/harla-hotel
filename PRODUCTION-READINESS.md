# Harla V1 readiness review — 16 September 2026

Baseline: `3d46c26264b8f2dbd5044f093b63c2b64c89d1a3` (Add V1 room admin inventory controls), deployed to harlahotel.com.

## Verified

- Build and all five room/event/restaurant workflow and PDF test scripts pass. These are regression checks, not complete authenticated end-to-end tests.
- Live browser date check for 1–2 October 2026 returns Queen 4,500 ETB / 8 rooms, Twin 4,500 ETB / 2 rooms, VIP 7,500 ETB / 1 room.
- V1 inventory migration is applied; the HTTP 409 classification fix is present; one active room admin exists.
- All five storage buckets for guest IDs, payment screenshots, room/event confirmations, and private assets are private.
- Vercel reported no runtime errors for the preceding 24 hours at inspection time. This does not prove untested paths work.

## Changes in this branch

- Remove developer setup text from the public homepage.
- Use the configured hotel WhatsApp number for restaurant VIP inquiries.
- Hide social links until actual HTTPS profile URLs are configured.
- Record the restaurant privacy migration already applied to production as `20260916132019`: remove the legacy anonymous SELECT and unrestricted INSERT policies; revoke direct anonymous SELECT. Existing pending-order submissions, private number/phone lookup, and admin policies are preserved.
- Add a transaction/rollback SQL regression check. Verified in production: pending submission succeeds, matching lookup succeeds, wrong phone reveals nothing, anonymous direct SELECT is denied, and self-approved submission is rejected. Synthetic records are rolled back.

## Restaurant implementation

- Add a restaurant admin page using the existing active legacy admin role, with order review, payment-proof links, approve/decline, kitchen handoff, and ordering availability.
- Server recomputes item names and prices from the imported catalogue; quantities and payment rules are validated. Private proof uploads are decoded/re-encoded and signed only for authorized admins.
- Opaque random order references support safe retries; order lookup still requires the phone number. Existing database `odoo_status` columns now represent kitchen handoff for compatibility.
- Production grants allow the service role to use restaurant orders/settings. Public direct INSERT must be revoked after the updated website deploys so that the canonical pricing API cannot be bypassed.
- Import script reads only selected data from the archive without executing SQL. Full database dump and unrelated business/customer data are excluded from GitHub and the site.

## Still required before production sign-off

- Authenticated browser checks for room and event admins, including full booking → proof upload → approval/rejection → PDF → email flows, inventory release/restore, and separation of admin roles.
- Browser verification of the new restaurant ordering/admin flow and deployment. Odoo is cancelled; there is no live Odoo dependency.
- The uploaded Odoo backup is now the menu source: 155 distinct restaurant items in 12 categories, 60 pictures, ETB prices with the restaurant company tax rules applied. One duplicate Special Ful was merged. Only configured restaurant POS products are included. Optional Odoo product variants are not offered. Hotel staff should review delivery/payment instructions and backup-date prices before accepting orders.
- International transfer instructions remain empty; the UI directs guests to contact the hotel. Verified instructions are needed for a self-service international transfer flow.
- Test room confirmation delivery to booking@harlahotel.com and event delivery to events@harlahotel.com, as designated by the owner. Mailbox ownership does not by itself configure the transactional sender. No test confirmation emails have been sent yet.
- Complete mobile visual checks, private-upload authorization checks, and a full database policy/function review. Advisor warnings remain for mutable function search path, publicly executable SECURITY DEFINER functions (some intentionally support lookups), and disabled leaked-password protection. Do not revoke those functions indiscriminately.
- Coordinate with the separate Codex session: this review cannot see its running terminal or unpushed local changes. Merge this branch only against the current agreed baseline.

Harla V2 remains a separate React/TypeScript rebuild. V1 completion and sign-off must precede that work.

## Deployment checkpoint

- The active production commit is still `3d46c26264b8f2dbd5044f093b63c2b64c89d1a3`. New restaurant code is committed locally on `codex/v1-production-readiness`; it has not deployed.
- All 60 product-image Git blobs are uploaded. Their SHA references can be regenerated with `git rev-parse HEAD:<path>`; no image re-upload is needed.
- Automatic approval review rejected creating the public GitHub source tree twice, flagging payment-account instructions. A source comparison confirmed that `restaurantPaymentMethods` is unchanged from public main, but review still requires explicit user permission. Do not try another publishing route to bypass this decision.
- Secure room-admin sign-in succeeded in the test browser. The live dashboard loaded and authenticated inventory controls were visible.
- A synthetic room request was prepared for 1–2 February 2027, with the designated `booking@harlahotel.com` recipient. The room availability check returned 8 Queen rooms at 4,500 ETB. A clearly labelled synthetic image (not an identity document or payment receipt) was selected successfully.
- Automatic approval review blocked the next form step, citing transmission of contact/identity fields. No test booking was created and no test confirmation email was sent. Explicit permission is needed for this synthetic workflow before continuing.
- `20260916173605_restaurant_server_only_submissions.sql` is prepared but NOT applied. Apply only after the new restaurant API is deployed and verified. The updated SQL regression test targets that future state.
- Next: obtain the two explicit approvals, create the GitHub tree/commit/PR using existing image blobs, verify the Vercel preview, finish the synthetic room/event/restaurant tests, publish, then apply and verify the final INSERT revocation. Release all synthetic inventory holds after testing.
