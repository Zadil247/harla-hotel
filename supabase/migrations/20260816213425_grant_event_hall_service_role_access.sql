-- Allow the trusted Harla Hotel backend to read bookings
-- and record PDF/email generation results.
grant select, update
on table public.event_hall_bookings
to service_role;
