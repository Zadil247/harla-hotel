-- Harla Hotel restaurant orders migration
-- Run this in Supabase SQL Editor if your project already has the earlier Harla schema.

create extension if not exists pgcrypto;

create table if not exists public.restaurant_orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  order_type text not null check (order_type in ('Dine In', 'Take Away', 'Delivery')),
  address_area text not null,
  custom_address text,
  items jsonb not null default '[]'::jsonb,
  pastry_items jsonb not null default '[]'::jsonb,
  payment_method text not null,
  payment_reference text,
  payment_screenshot_url text,
  payment_status text not null check (payment_status in ('submitted_for_verification', 'pay_at_hotel')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_orders_has_items check (
    jsonb_array_length(items) > 0 or jsonb_array_length(pastry_items) > 0
  )
);

alter table public.restaurant_orders
add column if not exists payment_screenshot_url text;

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

alter table public.restaurant_orders enable row level security;

drop policy if exists "Public can create restaurant orders" on public.restaurant_orders;
create policy "Public can create restaurant orders"
on public.restaurant_orders for insert
to anon, authenticated
with check (status = 'pending');

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

drop policy if exists "Admins can view payment screenshots" on storage.objects;
create policy "Admins can view payment screenshots"
on storage.objects for select
to authenticated
using (bucket_id = 'payment-screenshots' and public.is_harla_admin());
