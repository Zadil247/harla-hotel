-- Display numbers are separate from permanent customer/payment references.
-- Existing records retain their original references and no display number.
-- Account edits run only after server-side role and current-password checks.
grant insert,update on public.admin_users,public.room_admin_users,public.event_admin_users to service_role;
create table public.request_number_counters (
  service text primary key check(service in ('rooms','restaurant','events','tours','tables','event_enquiries')),
  series integer not null default 1 check(series > 0),
  next_number bigint not null default 1 check(next_number > 0),
  started_at timestamptz not null default now(),
  reset_by uuid references auth.users(id)
);
alter table public.request_number_counters enable row level security;
revoke all on public.request_number_counters from public,anon,authenticated;
grant select,update on public.request_number_counters to service_role;
insert into public.request_number_counters(service) values
  ('rooms'),('restaurant'),('events'),('tours'),('tables'),('event_enquiries');

create schema if not exists harla_private;
create function harla_private.assign_request_number() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Trigger-only internal helper. INSERT permission/RLS on each source table
  -- remains authoritative, including public enquiry forms without auth.uid().
  if tg_op='UPDATE' then
    new.request_series := old.request_series;
    new.request_number := old.request_number;
    return new;
  end if;
  update public.request_number_counters set next_number=next_number+1
    where service=tg_argv[0]
    returning series,next_number-1 into strict new.request_series,new.request_number;
  return new;
end $$;
revoke all on function harla_private.assign_request_number() from public,anon,authenticated,service_role;

do $$ declare entry record; begin
  for entry in select * from (values
    ('room_bookings','rooms'),('restaurant_orders','restaurant'),('event_hall_bookings','events'),
    ('package_bookings','tours'),('restaurant_requests','tables'),('event_requests','event_enquiries')
  ) as sources(table_name,service) loop
    execute format('alter table public.%I add column request_series integer, add column request_number bigint',entry.table_name);
    execute format('create unique index %I on public.%I(request_series,request_number)',entry.table_name||'_request_number_idx',entry.table_name);
    execute format('create trigger assign_request_number before insert or update on public.%I for each row execute function harla_private.assign_request_number(%L)',entry.table_name,entry.service);
  end loop;
end $$;

create function public.reset_request_numbering(p_service text,p_expected_series integer,p_actor uuid)
returns public.request_number_counters language plpgsql security invoker set search_path='' as $$
declare result public.request_number_counters; actor_email text;
begin
  select email into actor_email from public.master_admin_users where user_id=p_actor and active;
  if not found then raise exception 'Active Master Admin access is required' using errcode='42501'; end if;
  update public.request_number_counters set series=series+1,next_number=1,started_at=clock_timestamp(),reset_by=p_actor
    where service=p_service and series=p_expected_series returning * into result;
  if not found then raise exception 'Numbering changed. Refresh before resetting' using errcode='40001'; end if;
  insert into public.admin_activity(service,record_id,reference,action,actor_id,actor_email,details)
  values('Request numbering',p_service,'Series '||result.series,'numbering_reset',p_actor,actor_email,
    jsonb_build_object('service',p_service,'previous_series',p_expected_series,'new_series',result.series,'next_number',1));
  return result;
end $$;
revoke all on function public.reset_request_numbering(text,integer,uuid) from public,anon,authenticated;
grant execute on function public.reset_request_numbering(text,integer,uuid) to service_role;
