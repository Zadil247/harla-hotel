insert into public.rooms (
  slug,
  name,
  description,
  price_per_night,
  total_rooms,
  available_rooms,
  is_active
)
values (
  'sweet-room',
  'Sweet Room',
  'Comfortable Sweet Room with privacy and warm Harla Hotel service.',
  4000,
  6,
  6,
  true
)
on conflict (slug) do update set
  name = excluded.name,
  is_active = true;

insert into public.room_inventory (room_type, total_rooms, available_rooms)
values ('Sweet Room', 6, 6)
on conflict (room_type) do update set
  total_rooms = excluded.total_rooms,
  sellable_rooms = excluded.total_rooms,
  updated_at = now();
