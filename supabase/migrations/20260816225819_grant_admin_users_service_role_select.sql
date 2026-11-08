-- Allow the trusted Harla backend to verify authenticated admin users.
grant select
on table public.admin_users
to service_role;
