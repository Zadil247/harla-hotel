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
- Dedicated event hall page, Cultural Photo & Lunch Room, and catering options: `event-hall.html` and `src/event-hall.js`.
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
- Event hall request forms: `src/event-hall.js` and `src/event-booking.js`.
- Supabase insert/update helpers: `src/supabase-api.js`.
