# Harla Hotel Website

A responsive static website for Harla Hotel, covering hotel rooms, VIP restaurant and lounge features, event hall booking, Harar travel packages, gallery, contact details, and inquiry forms.

## Run Locally

From this folder:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/
```

## Where To Replace Content

- Logo / brand name: `assets/logo/harla-hotel-logo.jpeg`, `src/data.js`, `siteConfig.brandName`, and the `Navbar()` comment in `src/components.js`.
- Phone, WhatsApp, email, address, and social links: `src/data.js`, inside `siteConfig`.
- Booking API endpoint: `src/data.js`, `siteConfig.bookingEndpoint`.
- Room names, amenities, and price placeholders: `src/data.js`, inside `rooms`.
- Dedicated room booking page, room prices, room availability, and room estimate logic: `book-room.html`, `room-booking.html`, `src/room-booking.js`, and `src/data.js` inside `roomBookingTypes`.
- Actual room and hotel photos: `assets/rooms/harla-room-bed.jpeg`, `assets/rooms/harla-room-desk.jpeg`, `assets/rooms/harla-honeymoon-grand-suite.jpeg`, `assets/hotel/harla-hotel-hallway.jpeg`, and `assets/hotel/harla-hotel-exterior.jpeg`.
- Restaurant menu preview: `src/data.js`, inside `menuPreview`.
- Restaurant VIP majlis and hotel VIP lounge text: `src/data.js`, inside `hospitalityHighlights`.
- Restaurant menu/order page: `restaurant-order.html` and `src/restaurant-order.js`.
- Old restaurant compatibility redirect: `restaurant.html`.
- Event services and feature wording: `src/data.js`, inside `services`, plus the Event Hall section in `src/components.js`.
- Dedicated event hall catalogue, Cultural Photo & Lunch Room, and catering options: `event-hall.html`, `event-booking.html`, `src/event-hall.js`, `src/event-booking.js`, and `src/event-booking-core.js`.
- Event Hall base schema: `supabase/migrations/20260816140037_create_event_hall_booking_v1.sql`.
- Request-first Event Hall workflow, separate Events Team authorization, secure customer portal, quote holds, and stricter private storage policies: `supabase/migrations/20260817215359_event_hall_request_workflow_v2.sql`.
- Trusted event hall confirmation generation and storage: `api/event-confirmation.js`, `server/event-confirmation-service.js`, and `server/event-confirmation-pdf.js`. Browser downloads use only short-lived signed URLs through `src/event-confirmation-pdf.js`.
- Optional event hall confirmation email endpoint: `api/event-confirmation-email.js`.
- Packages and Harar experience deals: `src/data.js`, inside `packages`.
- Booking form service options: `src/components.js`, inside `BookingForm()`.
- Supabase schema and row-level security policies: `supabase/schema.sql`.
- Restaurant orders migration for existing Supabase projects: `supabase/restaurant-orders.sql`.
- Supabase connection settings: `.env.example`, `src/supabase-config.js`, `src/supabase-client.js`, and `src/supabase-api.js`.
- Admin login: `admin-login.html` and `src/admin-login.js`.
- Protected admin dashboard: `admin.html` and `src/admin.js`.
- Homepage navigation, shared footer, room/package cards, video placeholder, and homepage sections: `src/components.js`.
- Placeholder photos: `src/data.js`, inside `images`.
- Google Maps embed: replace the map placeholder comment in `src/components.js`.

## Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run `supabase/schema.sql`.
3. In Supabase Auth, create an admin user with email and password.
4. Copy that user UUID from Supabase Auth and insert it into `public.admin_users`:

```sql
insert into public.admin_users (user_id, email, full_name)
values ('AUTH_USER_UUID_HERE', 'admin@example.com', 'Harla Admin');
```

5. Copy `.env.example` to `.env` if you later run the site through Vite, then replace:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

For the current static local server, fill the existing `window.HARLA_SUPABASE_CONFIG` block in the HTML pages:

```html
<script>
  window.HARLA_SUPABASE_CONFIG = {
    url: "https://your-project-ref.supabase.co",
    anonKey: "your-supabase-anon-key",
  };
</script>
```

## Booking Pages

- Room booking page: `book-room.html`, also reachable through `/book-room/`.
- Admin login page: `admin-login.html`, also reachable through `/admin-login/`.
- Protected admin dashboard: `admin.html`, also reachable through `/admin/`.
- General homepage inquiry form: `src/main.js`.
- Restaurant menu/order page: `restaurant-order.html`.
- Event hall catalogue: `event-hall.html`.
- Event hall reservation: `event-booking.html`.
- Secure customer Event Hall request portal: `event-request.html`.
- Separate Events Team login and dashboard: `event-admin-login.html` and `event-admin.html`.
- Event Hall admin request details: `event-booking-detail.html`.
- Supabase insert/update helpers: `src/supabase-api.js`.

## Event Hall Booking V1

Apply `supabase/migrations/20260816140037_create_event_hall_booking_v1.sql`, `supabase/migrations/20260816213425_grant_event_hall_service_role_access.sql`, and then `supabase/migrations/20260817215359_event_hall_request_workflow_v2.sql` after the base schema. The migrations preserve the original `event_requests` inquiries, add the request-first quote and payment lifecycle, and isolate Events Team authorization from the room-admin system.

Public submissions begin as `pending_review` and do not hold a hall. Only `approved_awaiting_payment`, `payment_submitted`, and `confirmed` records block overlapping reservations for the same hall and time. The public customer portal requires the booking reference and a strong secret token; only its SHA-256 hash is stored in Supabase. Customer payment proofs are validated and uploaded to the existing private `payment-screenshots` bucket by trusted server code.

After applying the V2 migration, add the first Events Team administrator without granting room-admin privileges:

```sql
insert into public.event_admin_users (user_id, email, full_name, role)
select id, email, 'Events Team Admin', 'event_manager'
from auth.users
where email = 'events-admin@harlahotel.com'
on conflict (user_id) do update
set active = true, email = excluded.email;
```

The seeded venue catalogue contains only spaces already documented by Harla Hotel. Capacities and prices remain “confirmed on review” until verified values are entered in `public.event_halls`.

Official event confirmation PDFs are generated only by `api/event-confirmation.js`. The server reloads the canonical booking, embeds the private official stamp, uploads the PDF with the Supabase service role, stores its SHA-256 digest, and returns a short-lived signed URL. Browsers never receive write access to the official confirmation bucket.

After applying the migration, upload the real stamp in the Supabase dashboard to the private bucket path `hotel-private-assets/event-confirmation/harla-official-stamp.png`. Then configure these server-only environment variables in Vercel:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-supabase-service-role-key
HARLA_EVENT_STAMP_PATH=event-confirmation/harla-official-stamp.png
RESEND_API_KEY=re_replace_me
HARLA_EMAIL_FROM="Harla Hotel Events <events@harlahotel.com>"
EVENT_PORTAL_TOKEN_SECRET=replace-with-at-least-32-random-characters
SITE_URL=https://harlahotel.com
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` or `EVENT_PORTAL_TOKEN_SECRET` in an HTML file or a `VITE_` variable. Verify `harlahotel.com` in Resend before enabling Event Hall email delivery.
