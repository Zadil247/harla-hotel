-- Harla Hotel restaurant orders, customer status lookup, Odoo handoff, and settings migration.
-- Run this in Supabase SQL Editor if your project already has the earlier Harla schema.

create extension if not exists pgcrypto;

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
add column if not exists payment_screenshot_url text,
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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restaurant_orders_set_updated_at on public.restaurant_orders;
create trigger restaurant_orders_set_updated_at
before update on public.restaurant_orders
for each row execute function public.set_updated_at();

drop trigger if exists restaurant_settings_set_updated_at on public.restaurant_settings;
create trigger restaurant_settings_set_updated_at
before update on public.restaurant_settings
for each row execute function public.set_updated_at();

alter table public.restaurant_orders enable row level security;
alter table public.restaurant_settings enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.restaurant_orders to anon, authenticated;
grant select, update on public.restaurant_orders to authenticated;
grant select on public.restaurant_settings to anon, authenticated;
grant insert, update on public.restaurant_settings to authenticated;

drop policy if exists "Public can create restaurant orders" on public.restaurant_orders;
create policy "Public can create restaurant orders"
on public.restaurant_orders for insert
to public
with check (
  coalesce(status, 'pending') = 'pending'
  and coalesce(odoo_status, 'not_entered') = 'not_entered'
);

-- Public status lookup is handled through the secure RPC below so users only see
-- an order when both order_number and phone match.
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
