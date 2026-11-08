-- Harla Hotel Supabase schema
-- Run this file in the Supabase SQL Editor before connecting the website.
-- REPLACE: Update seeded prices, room availability, and admin email values as needed.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  price_per_night integer not null check (price_per_night >= 0),
  total_rooms integer not null check (total_rooms >= 0),
  available_rooms integer not null check (available_rooms >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_inventory (
  id uuid primary key default gen_random_uuid(),
  room_type text not null unique,
  total_rooms integer not null check (total_rooms >= 0),
  available_rooms integer not null check (available_rooms >= 0),
  updated_at timestamptz not null default now(),
  constraint room_inventory_available_within_total check (available_rooms <= total_rooms)
);

create table if not exists public.room_bookings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  booking_number text not null unique default ('HRB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  room_slug text,
  room_name text,
  room_type text not null,
  full_name text not null,
  phone text not null,
  email text,
  check_in date not null,
  check_out date not null,
  nights integer check (nights is null or nights > 0),
  guests integer not null check (guests > 0),
  number_of_rooms integer not null default 1 check (number_of_rooms > 0),
  price_per_night integer check (price_per_night is null or price_per_night >= 0),
  total_price integer check (total_price is null or total_price >= 0),
  payment_method text,
  payment_reference text,
  payment_screenshot_url text,
  payment_status text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  confirmed_at timestamptz,
  declined_at timestamptz,
  customer_contacted boolean not null default false,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_bookings_valid_dates check (check_out > check_in)
);

alter table public.room_bookings
add column if not exists booking_number text,
add column if not exists room_type text,
add column if not exists payment_method text,
add column if not exists payment_reference text,
add column if not exists payment_screenshot_url text,
add column if not exists payment_status text,
add column if not exists confirmed_at timestamptz,
add column if not exists declined_at timestamptz,
add column if not exists customer_contacted boolean not null default false,
add column if not exists contacted_at timestamptz;

alter table public.room_bookings
alter column room_slug drop not null,
alter column room_name drop not null,
alter column nights drop not null,
alter column price_per_night drop not null,
alter column total_price drop not null,
alter column number_of_rooms set default 1;

update public.room_bookings
set booking_number = 'HRB-' || upper(substr(replace(id::text, '-', ''), 1, 10))
where booking_number is null;

update public.room_bookings
set room_type = coalesce(room_type, room_name, room_slug, 'Queen Size Bed Room')
where room_type is null;

update public.room_bookings
set status = case
  when status = 'approved' then 'confirmed'
  when status = 'rejected' then 'declined'
  else status
end
where status in ('approved', 'rejected');

alter table public.room_bookings
alter column booking_number set not null,
alter column room_type set not null;

alter table public.room_bookings
drop constraint if exists room_bookings_status_check;

alter table public.room_bookings
add constraint room_bookings_status_check check (status in ('pending', 'confirmed', 'declined'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'room_bookings_booking_number_key'
      and conrelid = 'public.room_bookings'::regclass
  ) then
    alter table public.room_bookings
    add constraint room_bookings_booking_number_key unique (booking_number);
  end if;
end;
$$;

create table if not exists public.event_requests (
  id uuid primary key default gen_random_uuid(),
  service_type text not null,
  event_type text,
  full_name text not null,
  phone text not null,
  email text,
  event_date date,
  start_time time,
  end_time time,
  guests integer check (guests is null or guests > 0),
  catering_package text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_requests (
  id uuid primary key default gen_random_uuid(),
  service_type text not null,
  full_name text not null,
  phone text not null,
  email text,
  reservation_date date,
  reservation_time time,
  guests integer check (guests is null or guests > 0),
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  customer_name text not null,
  phone text not null,
  order_type text not null check (order_type in ('Dine In', 'Take Away', 'Delivery')),
  address_area text,
  custom_address text,
  items jsonb not null default '[]'::jsonb,
  pastry_items jsonb not null default '[]'::jsonb,
  payment_method text not null,
  payment_reference text,
  payment_screenshot_url text,
  payment_status text not null check (payment_status in ('submitted_for_verification', 'pay_at_hotel')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  approved_at timestamptz,
  declined_at timestamptz,
  odoo_status text not null default 'not_entered' check (odoo_status in ('not_entered', 'entered')),
  odoo_entered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_orders_has_items check (
    jsonb_array_length(items) > 0 or jsonb_array_length(pastry_items) > 0
  )
);

alter table public.restaurant_orders
add column if not exists order_number text,
add column if not exists approved_at timestamptz,
add column if not exists declined_at timestamptz,
add column if not exists odoo_status text not null default 'not_entered',
add column if not exists odoo_entered_at timestamptz;

alter table public.restaurant_orders
alter column address_area drop not null;

update public.restaurant_orders
set order_number = 'HRL-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where order_number is null;

alter table public.restaurant_orders
alter column order_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurant_orders_order_number_key'
      and conrelid = 'public.restaurant_orders'::regclass
  ) then
    alter table public.restaurant_orders
    add constraint restaurant_orders_order_number_key unique (order_number);
  end if;
end;
$$;

create table if not exists public.restaurant_settings (
  id text primary key default 'default',
  ordering_available boolean not null default true,
  custom_message text,
  updated_at timestamptz not null default now()
);

insert into public.restaurant_settings (id, ordering_available, custom_message)
values ('default', true, '')
on conflict (id) do nothing;

create table if not exists public.package_bookings (
  id uuid primary key default gen_random_uuid(),
  service_type text not null,
  package_name text,
  full_name text not null,
  phone text not null,
  email text,
  check_in date,
  check_out date,
  guests integer check (guests is null or guests > 0),
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

drop trigger if exists room_inventory_set_updated_at on public.room_inventory;
create trigger room_inventory_set_updated_at
before update on public.room_inventory
for each row execute function public.set_updated_at();

drop trigger if exists room_bookings_set_updated_at on public.room_bookings;
create trigger room_bookings_set_updated_at
before update on public.room_bookings
for each row execute function public.set_updated_at();

drop trigger if exists event_requests_set_updated_at on public.event_requests;
create trigger event_requests_set_updated_at
before update on public.event_requests
for each row execute function public.set_updated_at();

drop trigger if exists restaurant_requests_set_updated_at on public.restaurant_requests;
create trigger restaurant_requests_set_updated_at
before update on public.restaurant_requests
for each row execute function public.set_updated_at();

drop trigger if exists restaurant_orders_set_updated_at on public.restaurant_orders;
create trigger restaurant_orders_set_updated_at
before update on public.restaurant_orders
for each row execute function public.set_updated_at();

drop trigger if exists restaurant_settings_set_updated_at on public.restaurant_settings;
create trigger restaurant_settings_set_updated_at
before update on public.restaurant_settings
for each row execute function public.set_updated_at();

drop trigger if exists package_bookings_set_updated_at on public.package_bookings;
create trigger package_bookings_set_updated_at
before update on public.package_bookings
for each row execute function public.set_updated_at();

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
before update on public.admin_users
for each row execute function public.set_updated_at();

insert into public.rooms (slug, name, description, price_per_night, total_rooms, available_rooms)
values
  ('queen-size-bed-room', 'Queen Size Bed Room', 'Queen-size room with private bathroom, Wi-Fi, and workspace.', 4000, 8, 8),
  ('twin-bed-room', 'Twin Bed Room', 'Twin-bed room for friends, families, and business guests traveling together.', 4000, 2, 2),
  ('vip-room', 'VIP Room', 'Special Harari-style VIP room with cultural living room and private bathroom.', 7000, 1, 1)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_per_night = excluded.price_per_night,
  total_rooms = excluded.total_rooms,
  available_rooms = excluded.available_rooms,
  is_active = true;

insert into public.room_inventory (room_type, total_rooms, available_rooms)
values
  ('Queen Size Bed Room', 8, 8),
  ('Twin Bed Room', 2, 2),
  ('VIP Room', 1, 1)
on conflict (room_type) do update set
  total_rooms = excluded.total_rooms,
  available_rooms = least(public.room_inventory.available_rooms, excluded.total_rooms),
  updated_at = now();

alter table public.rooms enable row level security;
alter table public.room_inventory enable row level security;
alter table public.room_bookings enable row level security;
alter table public.event_requests enable row level security;
alter table public.restaurant_requests enable row level security;
alter table public.restaurant_orders enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.package_bookings enable row level security;
alter table public.admin_users enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.rooms to anon, authenticated;
grant select on public.room_inventory to anon, authenticated;
grant insert on public.room_bookings to anon, authenticated;
grant insert on public.event_requests to anon, authenticated;
grant insert on public.restaurant_requests to anon, authenticated;
grant insert on public.restaurant_orders to anon, authenticated;
grant insert on public.package_bookings to anon, authenticated;
grant select, update on public.rooms to authenticated;
grant select, update on public.room_inventory to authenticated;
grant select, update on public.room_bookings to authenticated;
grant select, update on public.event_requests to authenticated;
grant select, update on public.restaurant_requests to authenticated;
grant select, update on public.restaurant_orders to authenticated;
grant select on public.restaurant_settings to anon, authenticated;
grant insert, update on public.restaurant_settings to authenticated;
grant select, update on public.package_bookings to authenticated;
grant select, update on public.admin_users to authenticated;

create or replace function public.is_harla_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and active = true
  );
$$;

drop policy if exists "Public can view active rooms" on public.rooms;
create policy "Public can view active rooms"
on public.rooms for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage rooms" on public.rooms;
create policy "Admins can manage rooms"
on public.rooms for all
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Public can view room inventory" on public.room_inventory;
create policy "Public can view room inventory"
on public.room_inventory for select
to anon, authenticated
using (true);

drop policy if exists "Admins can update room inventory" on public.room_inventory;
create policy "Admins can update room inventory"
on public.room_inventory for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Public can create room bookings" on public.room_bookings;
create policy "Public can create room bookings"
on public.room_bookings for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "Admins can read room bookings" on public.room_bookings;
create policy "Admins can read room bookings"
on public.room_bookings for select
to authenticated
using (public.is_harla_admin());

drop policy if exists "Admins can update room bookings" on public.room_bookings;
create policy "Admins can update room bookings"
on public.room_bookings for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

create or replace function public.get_room_booking_status(
  lookup_booking_number text
)
returns table (
  booking_number text,
  full_name text,
  phone text,
  email text,
  room_type text,
  check_in date,
  check_out date,
  guests integer,
  payment_method text,
  payment_status text,
  status text,
  confirmed_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rb.booking_number,
    rb.full_name,
    rb.phone,
    rb.email,
    rb.room_type,
    rb.check_in,
    rb.check_out,
    rb.guests,
    rb.payment_method,
    rb.payment_status,
    rb.status,
    rb.confirmed_at,
    rb.declined_at,
    rb.created_at
  from public.room_bookings rb
  where upper(rb.booking_number) = upper(trim(lookup_booking_number))
  limit 1;
$$;

grant execute on function public.get_room_booking_status(text) to anon, authenticated;

create or replace function public.confirm_room_booking(
  booking_id uuid
)
returns public.room_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.room_bookings%rowtype;
  updated_booking public.room_bookings%rowtype;
begin
  if not public.is_harla_admin() then
    raise exception 'Only active Harla Hotel admins can confirm room bookings.';
  end if;

  select *
  into booking_record
  from public.room_bookings
  where id = booking_id
  for update;

  if not found then
    raise exception 'Room booking was not found.';
  end if;

  if booking_record.status = 'confirmed' then
    return booking_record;
  end if;

  if booking_record.status <> 'pending' then
    raise exception 'Only pending room bookings can be confirmed.';
  end if;

  update public.room_inventory
  set available_rooms = available_rooms - 1,
      updated_at = now()
  where room_type = booking_record.room_type
    and available_rooms > 0;

  if not found then
    raise exception 'No available rooms remain for %.', booking_record.room_type;
  end if;

  update public.room_bookings
  set status = 'confirmed',
      confirmed_at = now(),
      declined_at = null,
      updated_at = now()
  where id = booking_id
  returning * into updated_booking;

  return updated_booking;
end;
$$;

grant execute on function public.confirm_room_booking(uuid) to authenticated;

drop policy if exists "Public can create event requests" on public.event_requests;
create policy "Public can create event requests"
on public.event_requests for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "Admins can read event requests" on public.event_requests;
create policy "Admins can read event requests"
on public.event_requests for select
to authenticated
using (public.is_harla_admin());

drop policy if exists "Admins can update event requests" on public.event_requests;
create policy "Admins can update event requests"
on public.event_requests for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Public can create restaurant requests" on public.restaurant_requests;
create policy "Public can create restaurant requests"
on public.restaurant_requests for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "Admins can read restaurant requests" on public.restaurant_requests;
create policy "Admins can read restaurant requests"
on public.restaurant_requests for select
to authenticated
using (public.is_harla_admin());

drop policy if exists "Admins can update restaurant requests" on public.restaurant_requests;
create policy "Admins can update restaurant requests"
on public.restaurant_requests for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Public can create restaurant orders" on public.restaurant_orders;
create policy "Public can create restaurant orders"
on public.restaurant_orders for insert
to public
with check (
  coalesce(status, 'pending') = 'pending'
  and coalesce(odoo_status, 'not_entered') = 'not_entered'
);

drop policy if exists "Admins can read restaurant orders" on public.restaurant_orders;
create policy "Admins can read restaurant orders"
on public.restaurant_orders for select
to authenticated
using (public.is_harla_admin());

drop policy if exists "Admins can update restaurant orders" on public.restaurant_orders;
create policy "Admins can update restaurant orders"
on public.restaurant_orders for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

create or replace function public.get_restaurant_order_status(
  lookup_order_number text,
  lookup_phone text
)
returns table (
  order_number text,
  phone text,
  order_type text,
  payment_status text,
  status text,
  odoo_status text,
  created_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  odoo_entered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ro.order_number,
    ro.phone,
    ro.order_type,
    ro.payment_status,
    ro.status,
    ro.odoo_status,
    ro.created_at,
    ro.approved_at,
    ro.declined_at,
    ro.odoo_entered_at
  from public.restaurant_orders ro
  where upper(ro.order_number) = upper(trim(lookup_order_number))
    and regexp_replace(ro.phone, '\D', '', 'g') = regexp_replace(trim(lookup_phone), '\D', '', 'g')
  limit 1;
$$;

grant execute on function public.get_restaurant_order_status(text, text) to anon, authenticated;

drop policy if exists "Public can read restaurant settings" on public.restaurant_settings;
create policy "Public can read restaurant settings"
on public.restaurant_settings for select
to anon, authenticated
using (true);

drop policy if exists "Admins can update restaurant settings" on public.restaurant_settings;
create policy "Admins can update restaurant settings"
on public.restaurant_settings for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Admins can insert restaurant settings" on public.restaurant_settings;
create policy "Admins can insert restaurant settings"
on public.restaurant_settings for insert
to authenticated
with check (public.is_harla_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-screenshots',
  'payment-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can upload payment screenshots" on storage.objects;
create policy "Public can upload payment screenshots"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'payment-screenshots');

grant insert on storage.objects to anon, authenticated;

drop policy if exists "Admins can view payment screenshots" on storage.objects;
create policy "Admins can view payment screenshots"
on storage.objects for select
to authenticated
using (bucket_id = 'payment-screenshots' and public.is_harla_admin());

grant select on storage.objects to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_inventory'
  ) then
    alter publication supabase_realtime add table public.room_inventory;
  end if;
end;
$$;

drop policy if exists "Public can create package bookings" on public.package_bookings;
create policy "Public can create package bookings"
on public.package_bookings for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "Admins can read package bookings" on public.package_bookings;
create policy "Admins can read package bookings"
on public.package_bookings for select
to authenticated
using (public.is_harla_admin());

drop policy if exists "Admins can update package bookings" on public.package_bookings;
create policy "Admins can update package bookings"
on public.package_bookings for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
on public.admin_users for select
to authenticated
using (public.is_harla_admin() or user_id = auth.uid());

drop policy if exists "Admins can update admin users" on public.admin_users;
create policy "Admins can update admin users"
on public.admin_users for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

-- After creating an admin in Supabase Auth, add them to admin_users:
-- insert into public.admin_users (user_id, email, full_name)
-- values ('AUTH_USER_UUID_HERE', 'admin@example.com', 'Harla Admin');
