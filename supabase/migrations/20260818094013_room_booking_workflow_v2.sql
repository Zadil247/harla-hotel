-- Harla Hotel Room Booking Workflow V2.
-- Additive migration: preserves all existing room bookings and Event Hall data.
-- Apply immediately before deploying the matching Room Booking V2 frontend/API.
--
-- PRE-APPLY REVIEW (read-only):
-- select status, count(*) from public.room_bookings group by status order by status;
-- select payment_status, count(*) from public.room_bookings group by payment_status order by payment_status;
-- select booking_number, confirmation_pdf_path from public.room_bookings
-- where confirmation_pdf_path is not null
--   and confirmation_pdf_path <> 'confirmed/' || booking_number || '.pdf';
-- select room_type, total_rooms, available_rooms from public.room_inventory order by room_type;
-- select slug, name, price_per_night, is_active from public.rooms order by name;
--
-- IMPORTANT: this workflow migration never changes public.rooms.price_per_night,
-- room_inventory.total_rooms, or the legacy room_inventory.available_rooms value.

do $$
declare
  missing_columns text;
begin
  if to_regclass('public.room_bookings') is null then
    raise exception 'public.room_bookings is required. Apply the base Harla Hotel schema first.';
  end if;
  if to_regclass('public.room_inventory') is null then
    raise exception 'public.room_inventory is required. Apply the base Harla Hotel schema first.';
  end if;
  if to_regclass('public.rooms') is null then
    raise exception 'public.rooms is required. Apply the base Harla Hotel schema first.';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'public.set_updated_at() is required. Apply the base Harla Hotel schema first.';
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
  into missing_columns
  from unnest(array[
    'booking_number', 'full_name', 'room_type', 'check_in', 'check_out',
    'guests', 'number_of_rooms', 'payment_method', 'payment_status',
    'status', 'confirmed_at', 'declined_at', 'created_at', 'updated_at'
  ]) as required(column_name)
  where not exists (
    select 1
    from pg_attribute attribute
    where attribute.attrelid = 'public.room_bookings'::regclass
      and attribute.attname = required.column_name
      and not attribute.attisdropped
  );

  if missing_columns is not null then
    raise exception 'Room Workflow V2 requires room_bookings columns: %', missing_columns;
  end if;
end;
$$;

alter table public.room_inventory
  add column if not exists sellable_rooms integer;

do $$
declare
  invalid_inventory text;
begin
  select string_agg(
    format('%s(total=%s, available=%s, sellable=%s)',
      room_type, total_rooms, available_rooms, coalesce(sellable_rooms::text, 'NULL')),
    ', ' order by room_type
  )
  into invalid_inventory
  from public.room_inventory
  where total_rooms < 0
    or available_rooms < 0
    or available_rooms > total_rooms
    or (sellable_rooms is not null and (sellable_rooms < 0 or sellable_rooms > total_rooms));

  if invalid_inventory is not null then
    raise exception 'Unsafe room inventory capacity values found: %', invalid_inventory;
  end if;
end;
$$;

-- Harla's legacy available_rooms value was reduced when reservations were
-- approved, so it is not physical sellable capacity. Using it here would count
-- those same bookings once in sellable_rooms and again in the date-overlap
-- query. Initialize only previously-unset sellable_rooms from total_rooms.
-- Future maintenance/out-of-service reductions must be made explicitly by
-- operations through sellable_rooms after this migration.
update public.room_inventory
set sellable_rooms = total_rooms
where sellable_rooms is null;

alter table public.room_inventory
  alter column sellable_rooms set default 0,
  alter column sellable_rooms set not null;

alter table public.room_inventory
  drop constraint if exists room_inventory_sellable_nonnegative,
  drop constraint if exists room_inventory_sellable_within_total;

alter table public.room_inventory
  add constraint room_inventory_sellable_nonnegative check (sellable_rooms >= 0),
  add constraint room_inventory_sellable_within_total check (sellable_rooms <= total_rooms);

-- Date-aware availability is sellable_rooms minus overlapping active holds.
-- Existing total_rooms, available_rooms, and public.rooms prices stay untouched.

create table if not exists public.room_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'room_admin'
    check (role in ('room_admin', 'room_manager', 'hotel_manager', 'master_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists room_admin_users_set_updated_at on public.room_admin_users;
create trigger room_admin_users_set_updated_at
before update on public.room_admin_users
for each row execute function public.set_updated_at();

alter table public.room_admin_users enable row level security;

create or replace function public.is_harla_room_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_admin_users room_admin
    where room_admin.user_id = (select auth.uid())
      and room_admin.active = true
      and room_admin.role in ('room_admin', 'room_manager', 'hotel_manager', 'master_admin')
  );
$$;

revoke execute on function public.is_harla_room_admin() from public;
grant execute on function public.is_harla_room_admin() to authenticated, service_role;

drop policy if exists "Room admins can view own room profile" on public.room_admin_users;
create policy "Room admins can view own room profile"
on public.room_admin_users for select
to authenticated
using (user_id = (select auth.uid()) and active = true);

revoke all on table public.room_admin_users from anon, authenticated;
grant select on table public.room_admin_users to authenticated;

-- Room access is deliberately provisioned in room_admin_users. This migration
-- does not copy generic, Restaurant, or Event Admin accounts into the table.
-- Add approved Room Admins explicitly after review, for example:
-- insert into public.room_admin_users (user_id, email, full_name, role)
-- select id, email, 'Room Manager Name', 'room_manager'
-- from auth.users where email = 'approved-room-manager@example.com';

alter table public.room_bookings
  add column if not exists date_of_birth date,
  add column if not exists nationality text,
  add column if not exists government_id_path text,
  add column if not exists government_id_file_name text,
  add column if not exists government_id_mime_type text,
  add column if not exists government_id_file_size bigint,
  add column if not exists government_id_uploaded_at timestamptz,
  add column if not exists total_price_etb numeric(12, 2),
  add column if not exists total_price_usd numeric(12, 2),
  add column if not exists exchange_rate numeric(18, 6),
  add column if not exists exchange_rate_date date,
  add column if not exists payment_currency text,
  add column if not exists decline_reason text,
  add column if not exists confirmation_pdf_path text,
  add column if not exists confirmation_pdf_generated_at timestamptz,
  add column if not exists confirmation_pdf_sha256 text,
  add column if not exists email_status text,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_message_id text,
  add column if not exists email_error text,
  add column if not exists email_attempted_at timestamptz;

-- Fail closed before replacing legacy constraints. Existing rows are never
-- deleted or normalized by this migration; operations must review unexpected
-- values explicitly instead of having the migration reinterpret them.
do $$
declare
  invalid_statuses text;
  invalid_payment_statuses text;
  invalid_confirmation_paths text;
  invalid_room_prices text;
  missing_inventory_rates text;
begin
  select string_agg(value, ', ' order by value)
  into invalid_statuses
  from (
    select distinct coalesce(status, '<NULL>') as value
    from public.room_bookings
    where status is null or status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved', 'confirmed', 'checked_in',
      'checked_out', 'declined', 'rejected', 'cancelled'
    )
  ) values_found;

  if invalid_statuses is not null then
    raise exception 'Unsupported room booking status values found: %', invalid_statuses;
  end if;

  select string_agg(value, ', ' order by value)
  into invalid_payment_statuses
  from (
    select distinct payment_status as value
    from public.room_bookings
    where payment_status is not null
      and payment_status not in (
        'not_submitted', 'pending', 'pending_verification',
        'pending_payment_review', 'pending_payment_confirmation',
        'submitted_for_verification', 'pay_at_hotel', 'verified', 'paid',
        'declined', 'failed', 'cancelled'
      )
  ) values_found;

  if invalid_payment_statuses is not null then
    raise exception 'Unsupported room payment status values found: %', invalid_payment_statuses;
  end if;

  select string_agg(booking_number || '=' || confirmation_pdf_path, ', ' order by booking_number)
  into invalid_confirmation_paths
  from public.room_bookings
  where confirmation_pdf_path is not null
    and confirmation_pdf_path <> 'confirmed/' || booking_number || '.pdf';

  if invalid_confirmation_paths is not null then
    raise exception 'Unexpected room confirmation PDF paths found: %', invalid_confirmation_paths;
  end if;

  select string_agg(slug || '=' || coalesce(price_per_night::text, 'NULL'), ', ' order by slug)
  into invalid_room_prices
  from public.rooms
  where is_active = true
    and (price_per_night is null or price_per_night <= 0);

  if invalid_room_prices is not null then
    raise exception 'Active rooms require a positive database price: %', invalid_room_prices;
  end if;

  select string_agg(inventory.room_type, ', ' order by inventory.room_type)
  into missing_inventory_rates
  from public.room_inventory inventory
  where not exists (
    select 1
    from public.rooms room
    where room.is_active = true
      and lower(btrim(room.name)) = lower(btrim(inventory.room_type))
      and room.price_per_night > 0
  );

  if missing_inventory_rates is not null then
    raise exception 'Room inventory rows without an active database rate found: %', missing_inventory_rates;
  end if;
end;
$$;

-- Remove only CHECK constraints attached to the status columns. This is safe
-- across manually-applied Phase 2 variants whose constraint names may differ.
do $$
declare
  constraint_row record;
  status_attnum smallint;
  payment_status_attnum smallint;
begin
  select attnum into status_attnum
  from pg_attribute
  where attrelid = 'public.room_bookings'::regclass
    and attname = 'status'
    and not attisdropped;

  select attnum into payment_status_attnum
  from pg_attribute
  where attrelid = 'public.room_bookings'::regclass
    and attname = 'payment_status'
    and not attisdropped;

  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.room_bookings'::regclass
      and contype = 'c'
      and (
        (status_attnum is not null and conkey = array[status_attnum]::smallint[])
        or (payment_status_attnum is not null and conkey = array[payment_status_attnum]::smallint[])
      )
  loop
    execute format(
      'alter table public.room_bookings drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.room_bookings
  drop constraint if exists room_bookings_status_v2_check,
  drop constraint if exists room_bookings_payment_status_v2_check,
  drop constraint if exists room_bookings_confirmation_pdf_path_v2_check,
  drop constraint if exists room_bookings_confirmation_pdf_hash_v2_check,
  drop constraint if exists room_bookings_decline_reason_v2_check,
  drop constraint if exists room_bookings_government_id_size_v2_check;

alter table public.room_bookings
  add constraint room_bookings_status_v2_check check (
    status in (
      'pending',
      'pending_review',
      'pending_payment_review',
      'pending_payment_confirmation',
      'approved',
      'confirmed',
      'checked_in',
      'checked_out',
      'declined',
      'rejected',
      'cancelled'
    )
  ),
  add constraint room_bookings_payment_status_v2_check check (
    payment_status is null or payment_status in (
      'not_submitted',
      'pending',
      'pending_verification',
      'pending_payment_review',
      'pending_payment_confirmation',
      'submitted_for_verification',
      'pay_at_hotel',
      'verified',
      'paid',
      'declined',
      'failed',
      'cancelled'
    )
  ),
  add constraint room_bookings_confirmation_pdf_path_v2_check check (
    confirmation_pdf_path is null
    or confirmation_pdf_path = 'confirmed/' || booking_number || '.pdf'
  ),
  add constraint room_bookings_confirmation_pdf_hash_v2_check check (
    confirmation_pdf_sha256 is null
    or confirmation_pdf_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add constraint room_bookings_decline_reason_v2_check check (
    decline_reason is null or length(btrim(decline_reason)) between 1 and 1500
  ),
  add constraint room_bookings_government_id_size_v2_check check (
    government_id_file_size is null
    or government_id_file_size between 1 and 10485760
  );

create index if not exists room_bookings_date_availability_v2_idx
  on public.room_bookings (room_type, check_in, check_out, status);
create index if not exists room_bookings_admin_status_v2_idx
  on public.room_bookings (status, created_at desc);
create unique index if not exists room_bookings_confirmation_pdf_path_v2_uidx
  on public.room_bookings (confirmation_pdf_path)
  where confirmation_pdf_path is not null;

create or replace function public.room_booking_status_blocks_inventory(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_status, ''))) in (
    'pending',
    'pending_review',
    'pending_payment_review',
    'pending_payment_confirmation',
    'approved',
    'confirmed',
    'checked_in'
  );
$$;

revoke execute on function public.room_booking_status_blocks_inventory(text)
  from public, anon, authenticated;
grant execute on function public.room_booking_status_blocks_inventory(text)
  to service_role;

create or replace function public.enforce_room_booking_capacity_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_capacity integer;
  held_capacity integer;
begin
  if not public.room_booking_status_blocks_inventory(new.status) then
    return new;
  end if;

  if new.room_type is null or btrim(new.room_type) = '' then
    raise exception using
      errcode = '22023',
      message = 'A valid room type is required.';
  end if;
  if new.check_in is null or new.check_out is null or new.check_out <= new.check_in then
    raise exception using
      errcode = '22023',
      message = 'Check-out must be after check-in.';
  end if;
  if coalesce(new.number_of_rooms, 0) < 1 then
    raise exception using
      errcode = '22023',
      message = 'Number of rooms must be at least 1.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('harla-room:' || lower(btrim(new.room_type)), 0)
  );

  select inventory.sellable_rooms
  into base_capacity
  from public.room_inventory inventory
  where lower(btrim(inventory.room_type)) = lower(btrim(new.room_type))
  for update;

  if base_capacity is null then
    raise exception using
      errcode = '22023',
      message = 'The selected room type is not configured.';
  end if;

  select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer
  into held_capacity
  from public.room_bookings booking
  where lower(btrim(booking.room_type)) = lower(btrim(new.room_type))
    and public.room_booking_status_blocks_inventory(booking.status)
    and booking.check_in < new.check_out
    and new.check_in < booking.check_out
    and (tg_op = 'INSERT' or booking.id <> new.id);

  if held_capacity + new.number_of_rooms > base_capacity then
    raise exception using
      errcode = 'P0001',
      message = 'This room is no longer available for the selected dates. Please choose another room or contact Harla Hotel.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_room_booking_capacity_v2()
  from public, anon, authenticated;
grant execute on function public.enforce_room_booking_capacity_v2()
  to service_role;

drop trigger if exists room_bookings_capacity_v2 on public.room_bookings;
create trigger room_bookings_capacity_v2
before insert or update of room_type, check_in, check_out, number_of_rooms, status
on public.room_bookings
for each row execute function public.enforce_room_booking_capacity_v2();

drop function if exists public.get_room_availability_for_dates(date, date);

create function public.get_room_availability_for_dates(
  p_check_in date,
  p_check_out date
)
returns table (
  room_slug text,
  room_type text,
  price_per_night numeric,
  total_rooms integer,
  sellable_rooms integer,
  held_rooms integer,
  available_rooms integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception using
      errcode = '22023',
      message = 'Check-out must be after check-in.';
  end if;

  return query
  select
    configured_room.slug,
    inventory.room_type,
    configured_room.price_per_night,
    inventory.total_rooms,
    inventory.sellable_rooms,
    coalesce(holds.held_rooms, 0)::integer,
    greatest(inventory.sellable_rooms - coalesce(holds.held_rooms, 0), 0)::integer
  from public.room_inventory inventory
  join lateral (
    select room.slug, room.price_per_night
    from public.rooms room
    where room.is_active = true
      and lower(btrim(room.name)) = lower(btrim(inventory.room_type))
    order by room.created_at
    limit 1
  ) configured_room on true
  left join lateral (
    select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer as held_rooms
    from public.room_bookings booking
    where lower(btrim(booking.room_type)) = lower(btrim(inventory.room_type))
      and public.room_booking_status_blocks_inventory(booking.status)
      and booking.check_in < p_check_out
      and p_check_in < booking.check_out
  ) holds on true
  order by inventory.room_type;
end;
$$;

revoke execute on function public.get_room_availability_for_dates(date, date)
  from public, anon, authenticated;
grant execute on function public.get_room_availability_for_dates(date, date)
  to service_role;

create or replace function public.create_room_booking_with_hold(
  p_booking_number text,
  p_full_name text,
  p_phone text,
  p_email text,
  p_date_of_birth date,
  p_nationality text,
  p_room_type text,
  p_room_slug text,
  p_check_in date,
  p_check_out date,
  p_guests integer,
  p_number_of_rooms integer,
  p_payment_method text,
  p_payment_reference text,
  p_payment_screenshot_url text,
  p_payment_status text,
  p_payment_currency text,
  p_total_price_usd numeric,
  p_exchange_rate numeric,
  p_exchange_rate_date date,
  p_message text,
  p_government_id_path text,
  p_government_id_file_name text,
  p_government_id_mime_type text,
  p_government_id_file_size bigint,
  p_government_id_uploaded_at timestamptz
)
returns table (
  id uuid,
  booking_number text,
  status text,
  available_rooms integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inventory_record public.room_inventory%rowtype;
  room_record public.rooms%rowtype;
  existing_record public.room_bookings%rowtype;
  inserted_record public.room_bookings%rowtype;
  held_capacity integer;
  stay_nights integer;
  calculated_total numeric(12, 2);
  clean_booking_number text := upper(btrim(coalesce(p_booking_number, '')));
  clean_room_type text := btrim(coalesce(p_room_type, ''));
  clean_payment_status text := lower(btrim(coalesce(p_payment_status, '')));
begin
  if clean_booking_number !~ '^HRB-[A-Z0-9]{6,32}$' then
    raise exception using errcode = '22023', message = 'Booking reference format is invalid.';
  end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception using errcode = '22023', message = 'Check-out must be after check-in.';
  end if;
  if p_check_in < (now() at time zone 'Africa/Addis_Ababa')::date then
    raise exception using errcode = '22023', message = 'Check-in cannot be in the past.';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 2 and 160
    or length(btrim(coalesce(p_phone, ''))) not between 7 and 40
    or length(btrim(coalesce(p_email, ''))) not between 5 and 254 then
    raise exception using errcode = '22023', message = 'Valid guest contact details are required.';
  end if;
  if p_date_of_birth is null
    or p_date_of_birth >= (now() at time zone 'Africa/Addis_Ababa')::date then
    raise exception using errcode = '22023', message = 'A valid date of birth is required.';
  end if;
  if length(btrim(coalesce(p_nationality, ''))) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'A valid nationality is required.';
  end if;
  if coalesce(p_guests, 0) < 1 or p_guests > 20 then
    raise exception using errcode = '22023', message = 'Number of guests must be between 1 and 20.';
  end if;
  if coalesce(p_number_of_rooms, 0) < 1 then
    raise exception using errcode = '22023', message = 'Number of rooms must be at least 1.';
  end if;
  if clean_payment_status not in ('pending_payment_confirmation', 'pending_payment_review', 'submitted_for_verification') then
    raise exception using errcode = '22023', message = 'Choose a valid pending payment status.';
  end if;
  if p_payment_currency not in ('ETB', 'USD') then
    raise exception using errcode = '22023', message = 'Payment currency must be ETB or USD.';
  end if;
  if p_government_id_path is null
    or p_government_id_path not like 'room-bookings/' || clean_booking_number || '/%' then
    raise exception using errcode = '22023', message = 'Government ID storage path is invalid.';
  end if;
  if p_government_id_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or coalesce(p_government_id_file_size, 0) not between 1 and 10485760 then
    raise exception using errcode = '22023', message = 'Government ID file metadata is invalid.';
  end if;
  if p_payment_screenshot_url is null
    or p_payment_screenshot_url not like 'room-bookings/' || clean_booking_number || '/%' then
    raise exception using errcode = '22023', message = 'Payment confirmation storage path is invalid.';
  end if;

  select * into existing_record
  from public.room_bookings booking
  where booking.booking_number = clean_booking_number;

  if found then
    if existing_record.full_name = btrim(p_full_name)
      and existing_record.room_type = clean_room_type
      and existing_record.check_in = p_check_in
      and existing_record.check_out = p_check_out then
      return query
      select existing_record.id, existing_record.booking_number,
        existing_record.status,
        null::integer;
      return;
    end if;
    raise exception using errcode = '23505', message = 'This booking reference is already in use.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('harla-room:' || lower(clean_room_type), 0)
  );

  select * into inventory_record
  from public.room_inventory inventory
  where lower(btrim(inventory.room_type)) = lower(clean_room_type)
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'The selected room type is not configured.';
  end if;

  select * into room_record
  from public.rooms room
  where room.is_active = true
    and (
      room.slug = btrim(coalesce(p_room_slug, ''))
      or lower(btrim(room.name)) = lower(clean_room_type)
    )
  order by case when room.slug = btrim(coalesce(p_room_slug, '')) then 0 else 1 end
  limit 1;

  if not found then
    raise exception using errcode = '22023', message = 'The selected room rate is not configured.';
  end if;

  select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer
  into held_capacity
  from public.room_bookings booking
  where lower(btrim(booking.room_type)) = lower(clean_room_type)
    and public.room_booking_status_blocks_inventory(booking.status)
    and booking.check_in < p_check_out
    and p_check_in < booking.check_out;

  if held_capacity + p_number_of_rooms > inventory_record.sellable_rooms then
    raise exception using
      errcode = 'P0001',
      message = 'This room is no longer available for the selected dates. Please choose another room or contact Harla Hotel.';
  end if;

  stay_nights := p_check_out - p_check_in;
  calculated_total := room_record.price_per_night * stay_nights * p_number_of_rooms;

  insert into public.room_bookings (
    room_id,
    booking_number,
    room_slug,
    room_name,
    room_type,
    full_name,
    phone,
    email,
    date_of_birth,
    nationality,
    check_in,
    check_out,
    nights,
    guests,
    number_of_rooms,
    price_per_night,
    total_price,
    total_price_etb,
    total_price_usd,
    exchange_rate,
    exchange_rate_date,
    payment_currency,
    payment_method,
    payment_reference,
    payment_screenshot_url,
    payment_status,
    message,
    government_id_path,
    government_id_file_name,
    government_id_mime_type,
    government_id_file_size,
    government_id_uploaded_at,
    status
  ) values (
    room_record.id,
    clean_booking_number,
    room_record.slug,
    room_record.name,
    inventory_record.room_type,
    btrim(p_full_name),
    btrim(p_phone),
    lower(btrim(p_email)),
    p_date_of_birth,
    btrim(p_nationality),
    p_check_in,
    p_check_out,
    stay_nights,
    p_guests,
    p_number_of_rooms,
    room_record.price_per_night,
    calculated_total,
    calculated_total,
    case when p_payment_currency = 'USD' then p_total_price_usd else null end,
    case when p_payment_currency = 'USD' then p_exchange_rate else null end,
    case when p_payment_currency = 'USD' then p_exchange_rate_date else null end,
    p_payment_currency,
    btrim(p_payment_method),
    nullif(btrim(coalesce(p_payment_reference, '')), ''),
    p_payment_screenshot_url,
    clean_payment_status,
    nullif(btrim(coalesce(p_message, '')), ''),
    p_government_id_path,
    btrim(p_government_id_file_name),
    p_government_id_mime_type,
    p_government_id_file_size,
    coalesce(p_government_id_uploaded_at, now()),
    'pending_review'
  )
  returning * into inserted_record;

  return query
  select inserted_record.id, inserted_record.booking_number,
    inserted_record.status,
    inventory_record.sellable_rooms - held_capacity - p_number_of_rooms;
end;
$$;

revoke execute on function public.create_room_booking_with_hold(
  text, text, text, text, date, text, text, text, date, date, integer,
  integer, text, text, text, text, text, numeric, numeric, date, text,
  text, text, text, bigint, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_room_booking_with_hold(
  text, text, text, text, date, text, text, text, date, date, integer,
  integer, text, text, text, text, text, numeric, numeric, date, text,
  text, text, text, bigint, timestamptz
) to service_role;

create or replace function public.transition_room_booking_v2(
  p_booking_id uuid,
  p_expected_status text,
  p_action text,
  p_reason text default null
)
returns public.room_bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  booking_record public.room_bookings%rowtype;
  updated_record public.room_bookings%rowtype;
  clean_action text := lower(btrim(coalesce(p_action, '')));
  now_value timestamptz := now();
begin
  select * into booking_record
  from public.room_bookings booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room booking was not found.';
  end if;
  if booking_record.status is distinct from p_expected_status then
    raise exception using
      errcode = '40001',
      message = 'This booking changed while you were reviewing it. Refresh and try again.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('harla-room:' || lower(btrim(booking_record.room_type)), 0)
  );

  if clean_action = 'confirm' then
    if booking_record.status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved'
    ) then
      raise exception using errcode = '22023', message = 'Only an active pending room booking can be confirmed.';
    end if;
    update public.room_bookings
    set status = 'confirmed',
        confirmed_at = now_value,
        declined_at = null,
        decline_reason = null,
        payment_status = case
          when payment_status in (
            'pending', 'pending_verification', 'pending_payment_review',
            'pending_payment_confirmation', 'submitted_for_verification'
          ) then 'verified'
          else payment_status
        end,
        updated_at = now_value
    where id = booking_record.id
      and status = p_expected_status
    returning * into updated_record;
  elsif clean_action = 'decline' then
    if booking_record.status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved'
    ) then
      raise exception using errcode = '22023', message = 'Only an active pending room booking can be declined.';
    end if;
    update public.room_bookings
    set status = 'declined',
        confirmed_at = null,
        declined_at = now_value,
        decline_reason = coalesce(
          nullif(btrim(coalesce(p_reason, '')), ''),
          'Harla Hotel could not approve this room request.'
        ),
        updated_at = now_value
    where id = booking_record.id
      and status = p_expected_status
    returning * into updated_record;
  elsif clean_action = 'cancel' then
    if booking_record.status in ('declined', 'rejected', 'cancelled', 'checked_out') then
      raise exception using errcode = '22023', message = 'This booking is already inactive.';
    end if;
    update public.room_bookings
    set status = 'cancelled',
        decline_reason = coalesce(
          nullif(btrim(coalesce(p_reason, '')), ''),
          'This booking was cancelled by Harla Hotel.'
        ),
        updated_at = now_value
    where id = booking_record.id
      and status = p_expected_status
    returning * into updated_record;
  else
    raise exception using errcode = '22023', message = 'Choose a valid room booking action.';
  end if;

  if updated_record.id is null then
    raise exception using
      errcode = '40001',
      message = 'This booking changed while you were reviewing it. Refresh and try again.';
  end if;

  return updated_record;
end;
$$;

revoke execute on function public.transition_room_booking_v2(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_room_booking_v2(uuid, text, text, text)
  to service_role;

-- Backward-compatible admin RPC: approval now confirms the existing date hold
-- and never decrements room_inventory.available_rooms a second time.
create or replace function public.confirm_room_booking(booking_id uuid)
returns public.room_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_record public.room_bookings%rowtype;
  updated_booking public.room_bookings%rowtype;
begin
  if not public.is_harla_room_admin() then
    raise exception 'Only active Harla Hotel Room Admins can confirm room bookings.';
  end if;

  select * into booking_record
  from public.room_bookings booking
  where booking.id = booking_id
  for update;

  if not found then
    raise exception 'Room booking was not found.';
  end if;
  if booking_record.status in ('confirmed', 'checked_in', 'checked_out') then
    return booking_record;
  end if;
  if booking_record.status not in (
    'pending', 'pending_review', 'pending_payment_review',
    'pending_payment_confirmation', 'approved'
  ) then
    raise exception 'Only an active pending room booking can be confirmed.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('harla-room:' || lower(btrim(booking_record.room_type)), 0)
  );

  update public.room_bookings
  set status = 'confirmed',
      confirmed_at = now(),
      declined_at = null,
      decline_reason = null,
      payment_status = case
        when payment_status in (
          'pending', 'pending_verification', 'pending_payment_review',
          'pending_payment_confirmation', 'submitted_for_verification'
        ) then 'verified'
        else payment_status
      end,
      updated_at = now()
  where id = booking_record.id
  returning * into updated_booking;

  return updated_booking;
end;
$$;

revoke execute on function public.confirm_room_booking(uuid) from public, anon;
grant execute on function public.confirm_room_booking(uuid) to authenticated, service_role;

-- V2 browser clients create bookings through /api/room-booking, where the
-- service role invokes the atomic function after server-side validation.
-- Remove the old direct-table insert path so a browser cannot create arbitrary
-- inventory holds by bypassing that validation.
drop policy if exists "Public can create room bookings" on public.room_bookings;
revoke insert on table public.room_bookings from anon, authenticated;

-- Replace generic admin authorization on Room resources with the explicit
-- Room Admin boundary. Event/Restaurant admins have no Room privileges unless
-- they are intentionally provisioned in room_admin_users too.
drop policy if exists "Admins can manage rooms" on public.rooms;
drop policy if exists "Room admins can manage rooms" on public.rooms;
create policy "Room admins can manage rooms"
on public.rooms for all
to authenticated
using (public.is_harla_room_admin())
with check (public.is_harla_room_admin());

drop policy if exists "Admins can update room inventory" on public.room_inventory;
drop policy if exists "Room admins can update room inventory" on public.room_inventory;
create policy "Room admins can update room inventory"
on public.room_inventory for update
to authenticated
using (public.is_harla_room_admin())
with check (public.is_harla_room_admin());

drop policy if exists "Admins can read room bookings" on public.room_bookings;
drop policy if exists "Room admins can read room bookings" on public.room_bookings;
create policy "Room admins can read room bookings"
on public.room_bookings for select
to authenticated
using (public.is_harla_room_admin());

drop policy if exists "Admins can update room bookings" on public.room_bookings;
drop policy if exists "Room admins can update room bookings" on public.room_bookings;
create policy "Room admins can update room bookings"
on public.room_bookings for update
to authenticated
using (public.is_harla_room_admin())
with check (public.is_harla_room_admin());

-- The deployed two-field lookup and V2 server status endpoint both require a
-- valid full name plus booking reference. Keep the legacy function itself for
-- operational compatibility, but remove its insecure one-field public access.
do $$
begin
  if to_regprocedure('public.get_room_booking_status(text)') is not null then
    execute 'revoke execute on function public.get_room_booking_status(text) from public, anon, authenticated';
    execute 'grant execute on function public.get_room_booking_status(text) to service_role';
  end if;
end;
$$;

-- Server-side room workflow permissions. The service role has no DELETE grant.
revoke all on table public.room_bookings from service_role;
grant select, insert, update on table public.room_bookings to service_role;
revoke all on table public.room_inventory from service_role;
grant select, update on table public.room_inventory to service_role;
revoke all on table public.rooms from service_role;
grant select on table public.rooms to service_role;
revoke all on table public.room_admin_users from service_role;
grant select on table public.room_admin_users to service_role;
revoke all on table public.admin_users from service_role;
grant select on table public.admin_users to service_role;

-- Official room confirmations are private and writable only through trusted
-- service-role server code. Browser roles receive no direct bucket access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-confirmations',
  'room-confirmations',
  false,
  5242880,
  array['application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Preserve the current manual local/international room payment flow. The
-- existing bucket is shared, remains private, and accepts the proof formats
-- already validated by the customer UI.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-screenshots',
  'payment-screenshots',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Block browser room confirmation reads" on storage.objects;
create policy "Block browser room confirmation reads"
on storage.objects as restrictive for select
to anon, authenticated
using (bucket_id <> 'room-confirmations');

drop policy if exists "Block browser room confirmation inserts" on storage.objects;
create policy "Block browser room confirmation inserts"
on storage.objects as restrictive for insert
to anon, authenticated
with check (bucket_id <> 'room-confirmations');

drop policy if exists "Block browser room confirmation updates" on storage.objects;
create policy "Block browser room confirmation updates"
on storage.objects as restrictive for update
to anon, authenticated
using (bucket_id <> 'room-confirmations')
with check (bucket_id <> 'room-confirmations');

drop policy if exists "Block browser room confirmation deletes" on storage.objects;
create policy "Block browser room confirmation deletes"
on storage.objects as restrictive for delete
to anon, authenticated
using (bucket_id <> 'room-confirmations');

-- Keep customer identity and payment evidence private. Browser roles receive
-- no direct Room upload permission. The server validates a real booking draft
-- and issues short-lived, exact-path Supabase signed upload tokens instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guest-ids',
  'guest-ids',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Restrict browser room guest ID inserts" on storage.objects;
drop policy if exists "Block direct browser room guest ID inserts" on storage.objects;
create policy "Block direct browser room guest ID inserts"
on storage.objects as restrictive for insert
to anon, authenticated
with check (bucket_id <> 'guest-ids');

drop policy if exists "Block browser room guest ID reads" on storage.objects;
create policy "Block browser room guest ID reads"
on storage.objects as restrictive for select
to anon, authenticated
using (bucket_id <> 'guest-ids');

drop policy if exists "Block browser room guest ID updates" on storage.objects;
create policy "Block browser room guest ID updates"
on storage.objects as restrictive for update
to anon, authenticated
using (bucket_id <> 'guest-ids')
with check (bucket_id <> 'guest-ids');

drop policy if exists "Block browser room guest ID deletes" on storage.objects;
create policy "Block browser room guest ID deletes"
on storage.objects as restrictive for delete
to anon, authenticated
using (bucket_id <> 'guest-ids');

drop policy if exists "Restrict browser room payment inserts" on storage.objects;
drop policy if exists "Block direct browser room payment inserts" on storage.objects;
create policy "Block direct browser room payment inserts"
on storage.objects as restrictive for insert
to anon, authenticated
with check (
  not (
    bucket_id = 'payment-screenshots'
    and coalesce((storage.foldername(name))[1], '') = 'room-bookings'
  )
);

drop policy if exists "Block direct browser room payment reads" on storage.objects;
create policy "Block direct browser room payment reads"
on storage.objects as restrictive for select
to anon, authenticated
using (
  not (
    bucket_id = 'payment-screenshots'
    and coalesce((storage.foldername(name))[1], '') = 'room-bookings'
  )
);

drop policy if exists "Block direct browser room payment updates" on storage.objects;
create policy "Block direct browser room payment updates"
on storage.objects as restrictive for update
to anon, authenticated
using (
  not (
    bucket_id = 'payment-screenshots'
    and coalesce((storage.foldername(name))[1], '') = 'room-bookings'
  )
)
with check (
  not (
    bucket_id = 'payment-screenshots'
    and coalesce((storage.foldername(name))[1], '') = 'room-bookings'
  )
);

drop policy if exists "Block direct browser room payment deletes" on storage.objects;
create policy "Block direct browser room payment deletes"
on storage.objects as restrictive for delete
to anon, authenticated
using (
  not (
    bucket_id = 'payment-screenshots'
    and coalesce((storage.foldername(name))[1], '') = 'room-bookings'
  )
);

-- Verification queries (run after applying in Supabase SQL Editor):
-- select room_type, total_rooms, sellable_rooms, available_rooms
-- from public.room_inventory order by room_type;
-- select slug, name, price_per_night from public.rooms order by name;
-- select user_id, email, role, active from public.room_admin_users order by email;
-- select proname, prosecdef, proacl from pg_proc
-- where proname in (
--   'is_harla_room_admin',
--   'get_room_availability_for_dates',
--   'create_room_booking_with_hold',
--   'transition_room_booking_v2',
--   'confirm_room_booking'
-- ) order by proname;
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets
-- where id in ('room-confirmations', 'guest-ids', 'payment-screenshots');
-- select policyname, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- order by policyname;
-- select status, count(*) from public.room_bookings group by status order by status;
-- select payment_status, count(*) from public.room_bookings group by payment_status order by payment_status;
-- select booking_number, confirmation_pdf_path from public.room_bookings
-- where confirmation_pdf_path is not null
--   and confirmation_pdf_path <> 'confirmed/' || booking_number || '.pdf';
-- select
--   has_function_privilege('anon', 'public.create_room_booking_with_hold(text,text,text,text,date,text,text,text,date,date,integer,integer,text,text,text,text,text,numeric,numeric,date,text,text,text,text,bigint,timestamptz)', 'EXECUTE') as anon_create_must_be_false,
--   has_function_privilege('service_role', 'public.create_room_booking_with_hold(text,text,text,text,date,text,text,text,date,date,integer,integer,text,text,text,text,text,numeric,numeric,date,text,text,text,text,bigint,timestamptz)', 'EXECUTE') as service_create_must_be_true,
--   has_function_privilege('anon', 'public.transition_room_booking_v2(uuid,text,text,text)', 'EXECUTE') as anon_transition_must_be_false,
--   has_function_privilege('service_role', 'public.transition_room_booking_v2(uuid,text,text,text)', 'EXECUTE') as service_transition_must_be_true;
-- select has_table_privilege('service_role', 'public.room_bookings', 'DELETE')
--   as service_delete_must_be_false;
-- select
--   has_table_privilege('anon', 'public.room_admin_users', 'SELECT') as anon_room_admin_select_must_be_false,
--   has_table_privilege('service_role', 'public.room_admin_users', 'SELECT') as service_room_admin_select_must_be_true;
-- Event/Restaurant admins are intentionally NOT copied. Verify separation with
-- test Auth users before deployment: an account present only in event_admin_users
-- or admin_users must receive 403 from /api/room-admin.
