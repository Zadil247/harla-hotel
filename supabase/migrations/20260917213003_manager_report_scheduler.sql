-- Apply only after the manager endpoint is available on harlahotel.com.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists harla_private;
revoke all on schema harla_private from public,anon,authenticated;

do $$ declare secret_value text; begin
  if not exists(select 1 from vault.secrets where name='harla_manager_scheduler') then
    secret_value := encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(secret_value,'harla_manager_scheduler','Private authorization for Harla management report scheduler');
  else select decrypted_secret into secret_value from vault.decrypted_secrets where name='harla_manager_scheduler'; end if;
  insert into public.manager_scheduler_auth(id,token_hash) values('default',encode(extensions.digest(secret_value,'sha256'),'hex'))
  on conflict(id) do update set token_hash=excluded.token_hash;
end $$;
create or replace function harla_private.run_manager_report_schedule() returns bigint
language plpgsql security definer set search_path='' as $$
declare request_id bigint; secret_value text;
begin
  if not exists(select 1 from public.manager_report_settings where enabled and recipient_email is not null
    and (next_report_at<=now() or (summary_frequency!='off' and next_summary_at<=now()))) then return null; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where name='harla_manager_scheduler';
  if secret_value is null then raise exception 'Manager report scheduler authorization is missing'; end if;
  select net.http_post(url:='https://harlahotel.com/api/room-admin',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret_value),
    body:='{"scope":"manager","action":"scheduled_reports"}'::jsonb,timeout_milliseconds:=60000) into request_id;
  return request_id;
end $$;
revoke all on function harla_private.run_manager_report_schedule() from public,anon,authenticated,service_role;
select cron.schedule('harla-manager-reports','*/5 * * * *','select harla_private.run_manager_report_schedule();');
