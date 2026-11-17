insert into public.room_inventory (room_type, total_rooms, available_rooms)
values ('Sweet Room', 6, 6)
on conflict (room_type) do update set
  total_rooms = excluded.total_rooms,
  available_rooms = least(public.room_inventory.available_rooms, excluded.total_rooms),
  updated_at = now();