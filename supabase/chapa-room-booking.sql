-- Harla Hotel Chapa room payment fields and confirmation function.
-- Keep this migration in source control; run it manually in Supabase when needed.
-- Test-mode confirmation intentionally does not decrement production inventory.

alter table public.room_bookings
  add column if not exists chapa_tx_ref text,
  add column if not exists chapa_reference text,
  add column if not exists chapa_payment_status text,
  add column if not exists chapa_checkout_url text,
  add column if not exists chapa_payment_mode text,
  add column if not exists chapa_initialized_at timestamptz,
  add column if not exists chapa_verified_at timestamptz,
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_message_id text,
  add column if not exists is_test_booking boolean;

update public.room_bookings
set is_test_booking = false
where is_test_booking is null;

alter table public.room_bookings
  alter column is_test_booking set default false,
  alter column is_test_booking set not null;

create unique index if not exists room_bookings_chapa_tx_ref_key
  on public.room_bookings (chapa_tx_ref)
  where chapa_tx_ref is not null;

create index if not exists room_bookings_chapa_reference_idx
  on public.room_bookings (chapa_reference)
  where chapa_reference is not null;

create index if not exists room_bookings_chapa_payment_status_idx
  on public.room_bookings (chapa_payment_status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_bookings'::regclass
      and conname = 'room_bookings_chapa_payment_mode_check'
  ) then
    alter table public.room_bookings
      add constraint room_bookings_chapa_payment_mode_check
      check (
        chapa_payment_mode is null
        or chapa_payment_mode in ('test', 'live')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_bookings'::regclass
      and conname = 'room_bookings_chapa_payment_status_check'
  ) then
    alter table public.room_bookings
      add constraint room_bookings_chapa_payment_status_check
      check (
        chapa_payment_status is null
        or chapa_payment_status in (
          'initialized',
          'pending',
          'success',
          'failed',
          'cancelled'
        )
      );
  end if;
end;
$$;

create or replace function public.confirm_chapa_room_booking(
  p_booking_id uuid,
  p_tx_ref text,
  p_chapa_reference text,
  p_payment_mode text
)
returns public.room_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_booking public.room_bookings%rowtype;
  confirmed_booking public.room_bookings%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Only the Harla Hotel payment service can confirm Chapa bookings.'
      using errcode = '42501';
  end if;

  if p_payment_mode not in ('test', 'live') then
    raise exception 'Invalid Chapa payment mode.'
      using errcode = '22023';
  end if;

  select *
  into locked_booking
  from public.room_bookings
  where id = p_booking_id
    and chapa_tx_ref = p_tx_ref
  for update;

  if not found then
    raise exception 'Chapa room booking was not found.'
      using errcode = 'P0002';
  end if;

  if locked_booking.status = 'confirmed'
    and locked_booking.payment_status = 'paid'
    and locked_booking.chapa_payment_status = 'success' then
    return locked_booking;
  end if;

  if locked_booking.status <> 'pending' then
    raise exception 'Only pending room bookings can be confirmed.'
      using errcode = 'P0001';
  end if;

  if locked_booking.payment_status <> 'pending_payment_confirmation' then
    raise exception 'Room booking is not awaiting Chapa payment confirmation.'
      using errcode = 'P0001';
  end if;

  if locked_booking.chapa_payment_mode is distinct from p_payment_mode then
    raise exception 'Chapa payment mode does not match the booking.'
      using errcode = 'P0001';
  end if;

  if p_payment_mode = 'test' and locked_booking.is_test_booking is not true then
    raise exception 'Chapa test payment requires a test booking.'
      using errcode = 'P0001';
  end if;

  if p_payment_mode = 'live' and locked_booking.is_test_booking is not false then
    raise exception 'Chapa live payment cannot confirm a test booking.'
      using errcode = 'P0001';
  end if;

  if p_payment_mode = 'live' then
    update public.room_inventory
    set available_rooms = available_rooms - 1,
        updated_at = now()
    where room_type = locked_booking.room_type
      and available_rooms > 0;

    if not found then
      raise exception 'NO_ROOM_AVAILABLE: No available rooms remain for %.',
        locked_booking.room_type
        using errcode = 'P0001';
    end if;
  end if;

  update public.room_bookings
  set status = 'confirmed',
      payment_status = 'paid',
      payment_method = 'Chapa',
      payment_currency = 'ETB',
      chapa_reference = p_chapa_reference,
      chapa_payment_status = 'success',
      chapa_payment_mode = p_payment_mode,
      chapa_verified_at = coalesce(chapa_verified_at, now()),
      paid_at = coalesce(paid_at, now()),
      booking_confirmed_at = coalesce(booking_confirmed_at, now()),
      confirmed_at = coalesce(confirmed_at, now()),
      declined_at = null,
      updated_at = now()
  where id = locked_booking.id
  returning * into confirmed_booking;

  return confirmed_booking;
end;
$$;

revoke all on function public.confirm_chapa_room_booking(uuid, text, text, text)
from public, anon, authenticated;

grant execute on function public.confirm_chapa_room_booking(uuid, text, text, text)
to service_role;

-- Verification: service_role should be the only grantee.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'confirm_chapa_room_booking'
order by grantee;
