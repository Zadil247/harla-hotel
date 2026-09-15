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
  if p_check_in is null
    or p_check_out is null
    or p_check_out <= p_check_in then
    raise exception using
      errcode = '22023',
      message = 'Check-out must be after check-in.';
  end if;

  return query
  select
    configured_room.slug::text,
    inventory.room_type::text,
    configured_room.price_per_night::numeric,
    inventory.total_rooms::integer,
    inventory.sellable_rooms::integer,
    coalesce(holds.held_rooms, 0)::integer,
    greatest(
      inventory.sellable_rooms - coalesce(holds.held_rooms, 0),
      0
    )::integer
  from public.room_inventory inventory
  join lateral (
    select
      room.slug,
      room.price_per_night
    from public.rooms room
    where room.is_active = true
      and lower(btrim(room.name)) = lower(btrim(inventory.room_type))
    order by room.created_at
    limit 1
  ) configured_room on true
  left join lateral (
    select
      coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer as held_rooms
    from public.room_bookings booking
    where lower(btrim(booking.room_type)) =
          lower(btrim(inventory.room_type))
      and public.room_booking_status_blocks_inventory(booking.status)
      and booking.check_in < p_check_out
      and p_check_in < booking.check_out
  ) holds on true
  order by inventory.room_type;
end;
$$;

revoke execute
on function public.get_room_availability_for_dates(date, date)
from public, anon, authenticated;

grant execute
on function public.get_room_availability_for_dates(date, date)
to service_role;