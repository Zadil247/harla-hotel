-- Harla Hotel Stripe room confirmation
-- Run manually in the Supabase SQL Editor after the Stripe/payment columns migration.
-- This function is called only by the Vercel server with the Supabase service role.

create or replace function public.confirm_stripe_room_booking(
  booking_id uuid,
  checkout_session_id text,
  payment_intent_id text
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
    raise exception 'Only the Harla Hotel payment service can confirm Stripe bookings.'
      using errcode = '42501';
  end if;

  select *
  into locked_booking
  from public.room_bookings
  where id = booking_id
    and stripe_session_id = checkout_session_id
  for update;

  if not found then
    raise exception 'Stripe room booking was not found.'
      using errcode = 'P0002';
  end if;

  if locked_booking.status = 'confirmed'
    and locked_booking.payment_status = 'paid' then
    return locked_booking;
  end if;

  if locked_booking.status <> 'pending' then
    raise exception 'Only pending room bookings can be confirmed.'
      using errcode = 'P0001';
  end if;

  if locked_booking.payment_status <> 'pending_payment_confirmation' then
    raise exception 'Room booking is not awaiting Stripe payment confirmation.'
      using errcode = 'P0001';
  end if;

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

  update public.room_bookings
  set status = 'confirmed',
      payment_status = 'paid',
      stripe_payment_status = 'paid',
      stripe_payment_intent_id = payment_intent_id,
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

revoke all on function public.confirm_stripe_room_booking(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.confirm_stripe_room_booking(uuid, text, text)
to service_role;

-- Verification only: this should show service_role as the sole grantee.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'confirm_stripe_room_booking'
order by grantee;
