-- Harla Hotel V1 Room Admin Inventory Authority / Early Checkout.
-- Additive only: the two applied Room Workflow V2 migrations remain unchanged.
-- This migration does not change room prices, total_rooms, sellable_rooms,
-- legacy available_rooms, contractual check_in/check_out dates, or Event data.
--
-- PRE-APPLY REVIEW (read-only):
-- select status, count(*) from public.room_bookings group by status order by status;
-- select room_type, total_rooms, sellable_rooms, available_rooms
-- from public.room_inventory order by room_type;
--
-- IMPORTANT INVENTORY SEMANTICS:
-- Harla's legacy available_rooms value was already reduced by reservations.
-- It is not base capacity and must never initialize or overwrite sellable_rooms.
-- Workflow V2 correctly initialized previously-null sellable_rooms from
-- total_rooms. This migration leaves all three inventory capacity columns
-- untouched; overlapping booking holds determine date-aware availability.

do $$
declare
  missing_columns text;
  unsupported_statuses text;
  invalid_inventory text;
begin
  if to_regclass('public.room_bookings') is null
    or to_regclass('public.room_inventory') is null
    or to_regclass('public.rooms') is null then
    raise exception 'The existing Harla V1 Room Workflow tables are required before applying this migration.';
  end if;
  if to_regprocedure('public.room_booking_status_blocks_inventory(text)') is null
    or to_regprocedure('public.get_room_availability_for_dates(date,date)') is null
    or to_regprocedure('public.create_room_booking_with_hold(text,text,text,text,date,text,text,text,date,date,integer,integer,text,text,text,text,text,numeric,numeric,date,text,text,text,text,bigint,timestamp with time zone)') is null then
    raise exception 'The existing Harla V1 Room Workflow functions are required before applying this migration.';
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
  into missing_columns
  from unnest(array[
    'id', 'booking_number', 'room_type', 'check_in', 'check_out',
    'number_of_rooms', 'status', 'confirmed_at', 'declined_at', 'updated_at'
  ]) as required(column_name)
  where not exists (
    select 1 from pg_attribute attribute
    where attribute.attrelid = 'public.room_bookings'::regclass
      and attribute.attname = required.column_name
      and not attribute.attisdropped
  );
  if missing_columns is not null then
    raise exception 'The Harla V1 inventory-authority migration requires room_bookings columns: %', missing_columns;
  end if;

  select string_agg(value, ', ' order by value)
  into unsupported_statuses
  from (
    select distinct coalesce(status, '<NULL>') as value
    from public.room_bookings
    where status is null or status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved', 'confirmed', 'checked_in',
      'declined', 'rejected', 'cancelled', 'checked_out'
    )
  ) status_values;
  if unsupported_statuses is not null then
    raise exception 'Unsupported room booking statuses found before hold backfill: %', unsupported_statuses;
  end if;

  select string_agg(
    format('%s(total=%s, sellable=%s)', room_type, total_rooms, sellable_rooms),
    ', ' order by room_type
  )
  into invalid_inventory
  from public.room_inventory
  where total_rooms < 0
    or sellable_rooms < 0
    or sellable_rooms > total_rooms;
  if invalid_inventory is not null then
    raise exception 'Unsafe room inventory capacity values found: %', invalid_inventory;
  end if;
end;
$$;

alter table public.room_bookings
  add column if not exists inventory_hold_active boolean,
  add column if not exists inventory_released_at timestamptz,
  -- Historical actor identity is a snapshot, deliberately not a live Auth FK.
  -- Deleting an Auth account must not alter official Room Admin history.
  add column if not exists inventory_released_by uuid,
  add column if not exists inventory_released_by_email text,
  add column if not exists inventory_released_by_role text,
  add column if not exists inventory_release_reason text,
  add column if not exists inventory_release_type text,
  add column if not exists actual_check_in_at timestamptz,
  add column if not exists actual_check_out_at timestamptz;

-- Existing active workflow states continue holding inventory. Existing inactive
-- states are recorded as released without changing their status or stay dates.
update public.room_bookings
set inventory_hold_active = true,
    inventory_released_at = null,
    inventory_released_by = null,
    inventory_released_by_email = null,
    inventory_released_by_role = null,
    inventory_release_reason = null,
    inventory_release_type = null
where status in (
  'pending', 'pending_review', 'pending_payment_review',
  'pending_payment_confirmation', 'approved', 'confirmed', 'checked_in'
);

update public.room_bookings
set inventory_hold_active = false,
    inventory_released_at = coalesce(
      case when status in ('declined', 'rejected') then declined_at end,
      updated_at,
      now()
    ),
    inventory_released_by = null,
    inventory_released_by_email = null,
    inventory_released_by_role = null,
    inventory_release_reason = case
      when status in ('declined', 'rejected') then 'Legacy declined booking does not hold inventory.'
      when status = 'cancelled' then 'Legacy cancelled booking does not hold inventory.'
      else 'Legacy checked-out booking does not hold inventory.'
    end,
    inventory_release_type = case
      when status in ('declined', 'rejected') then 'declined'
      when status = 'cancelled' then 'cancelled'
      else 'checkout'
    end
where status in ('declined', 'rejected', 'cancelled', 'checked_out');

alter table public.room_bookings
  alter column inventory_hold_active set default true,
  alter column inventory_hold_active set not null;

alter table public.room_bookings
  drop constraint if exists room_bookings_inventory_release_type_v1_check,
  drop constraint if exists room_bookings_inventory_release_metadata_v1_check,
  drop constraint if exists room_bookings_actual_stay_order_v1_check;

alter table public.room_bookings
  add constraint room_bookings_inventory_release_type_v1_check check (
    inventory_release_type is null or inventory_release_type in (
      'declined', 'cancelled', 'checkout', 'early_checkout', 'manual_override'
    )
  ),
  add constraint room_bookings_inventory_release_metadata_v1_check check (
    (
      inventory_hold_active = true
      and inventory_released_at is null
      and inventory_released_by is null
      and inventory_released_by_email is null
      and inventory_released_by_role is null
      and inventory_release_reason is null
      and inventory_release_type is null
    )
    or (
      inventory_hold_active = false
      and inventory_released_at is not null
      and length(btrim(inventory_release_reason)) between 1 and 1500
      and inventory_release_type is not null
      and (
        inventory_release_type <> 'manual_override'
        or (
          inventory_released_by is not null
          and length(btrim(inventory_released_by_email)) between 3 and 254
          and inventory_released_by_role in ('room_admin', 'room_manager', 'hotel_manager', 'master_admin')
        )
      )
    )
  ),
  add constraint room_bookings_actual_stay_order_v1_check check (
    actual_check_in_at is null
    or actual_check_out_at is null
    or actual_check_out_at >= actual_check_in_at
  );

create table if not exists public.room_inventory_hold_audit (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.room_bookings(id) on delete restrict,
  booking_number text not null,
  action text not null check (action in (
    'decline', 'cancel', 'check_in', 'check_out', 'force_release', 'restore_hold'
  )),
  booking_status_before text not null,
  booking_status_after text not null,
  previous_hold_active boolean not null,
  new_hold_active boolean not null,
  release_type text check (release_type is null or release_type in (
    'declined', 'cancelled', 'checkout', 'early_checkout', 'manual_override'
  )),
  reason text check (reason is null or length(btrim(reason)) between 1 and 1500),
  -- Actor fields are immutable snapshots. No auth.users FK is intentional.
  actor_user_id uuid not null,
  actor_email text not null check (length(btrim(actor_email)) between 3 and 254),
  actor_role text not null check (
    actor_role in ('room_admin', 'room_manager', 'hotel_manager', 'master_admin')
  ),
  created_at timestamptz not null default now(),
  constraint room_inventory_hold_audit_release_type_v1_check check (
    (action = 'check_in' and release_type is null)
    or (action = 'decline' and release_type = 'declined')
    or (action = 'cancel' and release_type = 'cancelled')
    or (action = 'check_out' and release_type in ('checkout', 'early_checkout'))
    or (action = 'force_release' and release_type = 'manual_override')
    or (action = 'restore_hold' and release_type is not null)
  ),
  constraint room_inventory_hold_audit_required_reason_v1_check check (
    action not in ('force_release', 'restore_hold')
    or (reason is not null and length(btrim(reason)) between 1 and 1500)
  )
);

create index if not exists room_inventory_hold_audit_booking_v1_idx
  on public.room_inventory_hold_audit (booking_id, created_at desc);
create index if not exists room_bookings_active_hold_dates_v1_idx
  on public.room_bookings (room_type, check_in, check_out)
  where inventory_hold_active = true;

alter table public.room_inventory_hold_audit enable row level security;
revoke all on table public.room_inventory_hold_audit from public, anon, authenticated;
revoke all on table public.room_inventory_hold_audit from service_role;
grant select, insert on table public.room_inventory_hold_audit to service_role;

create or replace function public.enforce_room_booking_capacity_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_capacity integer;
  held_capacity integer;
  now_value timestamptz := now();
begin
  -- Keep inactive statuses fail-safe even if an older trusted transition path
  -- changes status without explicitly changing the new hold fields.
  if not public.room_booking_status_blocks_inventory(new.status) then
    if coalesce(new.inventory_hold_active, true) then
      new.inventory_hold_active := false;
      new.inventory_released_at := coalesce(new.inventory_released_at, now_value);
      new.inventory_release_reason := coalesce(
        nullif(btrim(coalesce(new.inventory_release_reason, '')), ''),
        case
          when new.status in ('declined', 'rejected') then 'Booking declined by Harla Hotel.'
          when new.status = 'cancelled' then 'Booking cancelled by Harla Hotel.'
          else 'Guest checked out.'
        end
      );
      new.inventory_release_type := coalesce(
        new.inventory_release_type,
        case
          when new.status in ('declined', 'rejected') then 'declined'
          when new.status = 'cancelled' then 'cancelled'
          else 'checkout'
        end
      );
    end if;
    return new;
  end if;

  if not coalesce(new.inventory_hold_active, true) then
    return new;
  end if;

  if new.room_type is null or btrim(new.room_type) = '' then
    raise exception using errcode = '22023', message = 'A valid room type is required.';
  end if;
  if new.check_in is null or new.check_out is null or new.check_out <= new.check_in then
    raise exception using errcode = '22023', message = 'Check-out must be after check-in.';
  end if;
  if coalesce(new.number_of_rooms, 0) < 1 then
    raise exception using errcode = '22023', message = 'Number of rooms must be at least 1.';
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
    raise exception using errcode = '22023', message = 'The selected room type is not configured.';
  end if;

  select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer
  into held_capacity
  from public.room_bookings booking
  where lower(btrim(booking.room_type)) = lower(btrim(new.room_type))
    and public.room_booking_status_blocks_inventory(booking.status)
    and booking.inventory_hold_active = true
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
before insert or update of room_type, check_in, check_out, number_of_rooms, status, inventory_hold_active
on public.room_bookings
for each row execute function public.enforce_room_booking_capacity_v2();

create or replace function public.get_room_availability_for_dates(
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
    raise exception using errcode = '22023', message = 'Check-out must be after check-in.';
  end if;

  return query
  select
    configured_room.slug::text,
    inventory.room_type::text,
    configured_room.price_per_night::numeric,
    inventory.total_rooms::integer,
    inventory.sellable_rooms::integer,
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
      and booking.inventory_hold_active = true
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
  clean_room_slug text := btrim(coalesce(p_room_slug, ''));
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
  if p_date_of_birth is null or p_date_of_birth >= (now() at time zone 'Africa/Addis_Ababa')::date then
    raise exception using errcode = '22023', message = 'A valid date of birth is required.';
  end if;
  if length(btrim(coalesce(p_nationality, ''))) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'A valid nationality is required.';
  end if;
  if coalesce(p_guests, 0) < 1 or p_guests > 20 then
    raise exception using errcode = '22023', message = 'Number of guests must be between 1 and 20.';
  end if;
  if coalesce(p_number_of_rooms, 0) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'Number of rooms must be between 1 and 20.';
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
        existing_record.status, null::integer;
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
    and lower(btrim(room.name)) = lower(btrim(inventory_record.room_type))
    and (clean_room_slug = '' or room.slug = clean_room_slug)
  order by room.created_at
  limit 1;
  if not found then
    raise exception using
      errcode = '22023',
      message = 'The selected room type and room code do not match an active Harla Hotel room rate.';
  end if;

  select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer
  into held_capacity
  from public.room_bookings booking
  where lower(btrim(booking.room_type)) = lower(clean_room_type)
    and public.room_booking_status_blocks_inventory(booking.status)
    and booking.inventory_hold_active = true
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
    room_id, booking_number, room_slug, room_name, room_type,
    full_name, phone, email, date_of_birth, nationality,
    check_in, check_out, nights, guests, number_of_rooms,
    price_per_night, total_price, total_price_etb, total_price_usd,
    exchange_rate, exchange_rate_date, payment_currency, payment_method,
    payment_reference, payment_screenshot_url, payment_status, message,
    government_id_path, government_id_file_name, government_id_mime_type,
    government_id_file_size, government_id_uploaded_at, status,
    inventory_hold_active
  ) values (
    room_record.id, clean_booking_number, room_record.slug, room_record.name,
    inventory_record.room_type, btrim(p_full_name), btrim(p_phone),
    lower(btrim(p_email)), p_date_of_birth, btrim(p_nationality),
    p_check_in, p_check_out, stay_nights, p_guests, p_number_of_rooms,
    room_record.price_per_night, calculated_total, calculated_total,
    case when p_payment_currency = 'USD' then p_total_price_usd else null end,
    case when p_payment_currency = 'USD' then p_exchange_rate else null end,
    case when p_payment_currency = 'USD' then p_exchange_rate_date else null end,
    p_payment_currency, btrim(p_payment_method),
    nullif(btrim(coalesce(p_payment_reference, '')), ''),
    p_payment_screenshot_url, clean_payment_status,
    nullif(btrim(coalesce(p_message, '')), ''),
    p_government_id_path, btrim(p_government_id_file_name),
    p_government_id_mime_type, p_government_id_file_size,
    coalesce(p_government_id_uploaded_at, now()), 'pending_review', true
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

create or replace function public.transition_room_booking_inventory_authority_v1(
  p_booking_id uuid,
  p_expected_status text,
  p_action text,
  p_reason text,
  p_actor_user_id uuid
)
returns public.room_bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  booking_record public.room_bookings%rowtype;
  updated_record public.room_bookings%rowtype;
  inventory_record public.room_inventory%rowtype;
  actor_record public.room_admin_users%rowtype;
  held_capacity integer;
  clean_action text := lower(btrim(coalesce(p_action, '')));
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  now_value timestamptz := now();
  local_today date := (now() at time zone 'Africa/Addis_Ababa')::date;
  release_type_value text;
  release_reason_value text;
begin
  select * into actor_record
  from public.room_admin_users room_admin
  where room_admin.user_id = p_actor_user_id
    and room_admin.active = true
    and room_admin.role in ('room_admin', 'room_manager', 'hotel_manager', 'master_admin');

  if not found then
    raise exception using errcode = '42501', message = 'Active Harla Hotel Room Admin access is required.';
  end if;

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
    if not booking_record.inventory_hold_active then
      raise exception using errcode = 'P0001', message = 'Restore this booking inventory hold before confirming it.';
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
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'decline' then
    if booking_record.status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved'
    ) then
      raise exception using errcode = '22023', message = 'Only an active pending room booking can be declined.';
    end if;
    release_reason_value := coalesce(clean_reason, 'Harla Hotel could not approve this room request.');
    update public.room_bookings
    set status = 'declined',
        confirmed_at = null,
        declined_at = now_value,
        decline_reason = release_reason_value,
        inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = release_reason_value,
        inventory_release_type = 'declined',
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'cancel' then
    if booking_record.status in ('declined', 'rejected', 'cancelled', 'checked_out') then
      raise exception using errcode = '22023', message = 'This booking is already inactive.';
    end if;
    release_reason_value := coalesce(clean_reason, 'This booking was cancelled by Harla Hotel.');
    update public.room_bookings
    set status = 'cancelled',
        decline_reason = release_reason_value,
        inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = release_reason_value,
        inventory_release_type = 'cancelled',
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'check_in' then
    if booking_record.status not in ('approved', 'confirmed') then
      raise exception using errcode = '22023', message = 'Only an approved or confirmed booking can be checked in.';
    end if;
    if not booking_record.inventory_hold_active then
      raise exception using errcode = 'P0001', message = 'Restore this booking inventory hold before checking in the guest.';
    end if;
    update public.room_bookings
    set status = 'checked_in',
        actual_check_in_at = coalesce(actual_check_in_at, now_value),
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'check_out' then
    if booking_record.status not in ('approved', 'confirmed', 'checked_in') then
      raise exception using errcode = '22023', message = 'Only an approved, confirmed, or checked-in booking can be checked out.';
    end if;
    release_type_value := case when local_today < booking_record.check_out then 'early_checkout' else 'checkout' end;
    release_reason_value := coalesce(
      clean_reason,
      case when release_type_value = 'early_checkout' then 'Guest checked out early.' else 'Guest checked out.' end
    );
    update public.room_bookings
    set status = 'checked_out',
        actual_check_out_at = now_value,
        inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = release_reason_value,
        inventory_release_type = release_type_value,
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'force_release' then
    if not public.room_booking_status_blocks_inventory(booking_record.status) then
      raise exception using errcode = '22023', message = 'This booking status does not hold room inventory.';
    end if;
    if not booking_record.inventory_hold_active then
      raise exception using errcode = '22023', message = 'This booking inventory is already released.';
    end if;
    if clean_reason is null then
      raise exception using errcode = '22023', message = 'A management reason is required to force-release inventory.';
    end if;
    update public.room_bookings
    set inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = clean_reason,
        inventory_release_type = 'manual_override',
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'restore_hold' then
    if not public.room_booking_status_blocks_inventory(booking_record.status) then
      raise exception using errcode = '22023', message = 'Only an active booking can restore an inventory hold.';
    end if;
    if booking_record.inventory_hold_active then
      raise exception using errcode = '22023', message = 'This booking is already holding room inventory.';
    end if;
    if clean_reason is null then
      raise exception using errcode = '22023', message = 'A reason is required to restore inventory.';
    end if;

    select * into inventory_record
    from public.room_inventory inventory
    where lower(btrim(inventory.room_type)) = lower(btrim(booking_record.room_type))
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'The selected room type is not configured.';
    end if;

    select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer
    into held_capacity
    from public.room_bookings booking
    where lower(btrim(booking.room_type)) = lower(btrim(booking_record.room_type))
      and public.room_booking_status_blocks_inventory(booking.status)
      and booking.inventory_hold_active = true
      and booking.check_in < booking_record.check_out
      and booking_record.check_in < booking.check_out
      and booking.id <> booking_record.id;

    if held_capacity + coalesce(booking_record.number_of_rooms, 1) > inventory_record.sellable_rooms then
      raise exception using
        errcode = 'P0001',
        message = 'Inventory cannot be restored because the room capacity is already committed for these dates.';
    end if;

    update public.room_bookings
    set inventory_hold_active = true,
        inventory_released_at = null,
        inventory_released_by = null,
        inventory_released_by_email = null,
        inventory_released_by_role = null,
        inventory_release_reason = null,
        inventory_release_type = null,
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  else
    raise exception using errcode = '22023', message = 'Choose a valid Room Admin booking action.';
  end if;

  if updated_record.id is null then
    raise exception using
      errcode = '40001',
      message = 'This booking changed while you were reviewing it. Refresh and try again.';
  end if;

  if clean_action in ('decline', 'cancel', 'check_in', 'check_out', 'force_release', 'restore_hold') then
    insert into public.room_inventory_hold_audit (
      booking_id, booking_number, action,
      booking_status_before, booking_status_after,
      previous_hold_active, new_hold_active,
      release_type, reason,
      actor_user_id, actor_email, actor_role
    ) values (
      booking_record.id, booking_record.booking_number, clean_action,
      booking_record.status, updated_record.status,
      booking_record.inventory_hold_active, updated_record.inventory_hold_active,
      case
        when clean_action = 'restore_hold' then booking_record.inventory_release_type
        else updated_record.inventory_release_type
      end,
      case when clean_action = 'restore_hold' then clean_reason else updated_record.inventory_release_reason end,
      actor_record.user_id, actor_record.email, actor_record.role
    );
  end if;

  return updated_record;
end;
$$;

revoke execute on function public.transition_room_booking_inventory_authority_v1(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.transition_room_booking_inventory_authority_v1(uuid, text, text, text, uuid)
  to service_role;

-- Verification queries (read-only; run after applying in Supabase):
-- select status, inventory_hold_active, count(*)
-- from public.room_bookings group by status, inventory_hold_active order by status;
-- select room_type, total_rooms, sellable_rooms, available_rooms
-- from public.room_inventory order by room_type;
-- select has_function_privilege('anon',
--   'public.transition_room_booking_inventory_authority_v1(uuid,text,text,text,uuid)', 'EXECUTE')
--   as anon_transition_must_be_false,
--   has_function_privilege('service_role',
--   'public.transition_room_booking_inventory_authority_v1(uuid,text,text,text,uuid)', 'EXECUTE')
--   as service_transition_must_be_true;
