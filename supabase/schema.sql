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

create table if not exists public.room_bookings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  room_slug text not null,
  room_name text not null,
  full_name text not null,
  phone text not null,
  email text,
  check_in date not null,
  check_out date not null,
  nights integer not null check (nights > 0),
  guests integer not null check (guests > 0),
  number_of_rooms integer not null check (number_of_rooms > 0),
  price_per_night integer not null check (price_per_night >= 0),
  total_price integer not null check (total_price >= 0),
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_bookings_valid_dates check (check_out > check_in)
);

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
  ('double-bed-room', 'Double Bed Room', 'Comfortable double-bed room with private bathroom, Wi-Fi, and workspace.', 4000, 2, 2),
  ('queen-normal-room', 'Queen/Normal Room', 'Standard queen room for business travelers, couples, and families.', 4000, 8, 8),
  ('cultural-king-room', 'Cultural King Room', 'Special Harari-style room with king-size bed, traditional living room, and private bathroom.', 7000, 1, 1)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_per_night = excluded.price_per_night,
  total_rooms = excluded.total_rooms,
  available_rooms = excluded.available_rooms,
  is_active = true;

alter table public.rooms enable row level security;
alter table public.room_bookings enable row level security;
alter table public.event_requests enable row level security;
alter table public.restaurant_requests enable row level security;
alter table public.package_bookings enable row level security;
alter table public.admin_users enable row level security;

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
