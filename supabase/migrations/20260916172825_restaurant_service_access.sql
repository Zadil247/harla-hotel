-- Trusted server endpoint access; guest and staff RLS policies are unchanged.
grant select, insert, update on public.restaurant_orders to service_role;
grant select, update on public.restaurant_settings to service_role;
