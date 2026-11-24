update public.rooms
set price_per_night = 5000,
    updated_at = now()
where slug = 'twin-bed-room';
