-- Trigger helpers are internal database infrastructure, not customer RPCs.
-- Safe before the V1 web release; does not change booking or ordering behavior.
alter function public.set_updated_at() set search_path = '';
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
