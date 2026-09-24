-- Management reads legacy tours/table enquiries through the authorized server API.
-- Keep client permissions and RLS unchanged; no write access is required.
grant select on table public.package_bookings, public.restaurant_requests to service_role;
