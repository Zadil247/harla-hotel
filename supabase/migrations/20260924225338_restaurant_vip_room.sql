-- One restaurant VIP majlis. Requests do not reserve it until staff occupy it.
create table public.restaurant_vip_requests (
  id uuid primary key,
  booking_reference text not null unique,
  full_name text not null check(length(btrim(full_name)) between 1 and 160),
  phone text not null check(length(phone) between 7 and 40),
  guests integer check(guests between 1 and 999),
  preferred_date date, preferred_time time,
  status text not null default 'pending' check(status in ('pending','contacted','occupied','completed','declined')),
  version integer not null default 1,
  request_series integer, request_number bigint,
  contacted_at timestamptz, occupied_at timestamptz, released_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(request_series,request_number)
);
create index restaurant_vip_requests_created_idx on public.restaurant_vip_requests(created_at desc);
create index restaurant_vip_requests_phone_idx on public.restaurant_vip_requests(phone,created_at desc);
create table public.restaurant_vip_room (
  id text primary key default 'default' check(id='default'),
  status text not null default 'available' check(status in ('available','occupied')),
  active_request_id uuid references public.restaurant_vip_requests(id),
  version integer not null default 1,
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  check(status='occupied' or active_request_id is null)
);
insert into public.restaurant_vip_room(id) values('default');
alter table public.restaurant_vip_requests enable row level security;
alter table public.restaurant_vip_room enable row level security;
revoke all on public.restaurant_vip_requests, public.restaurant_vip_room from public,anon,authenticated;
grant select,insert,update on public.restaurant_vip_requests to service_role;
grant select,update on public.restaurant_vip_room to service_role;
alter table public.request_number_counters drop constraint request_number_counters_service_check;
alter table public.request_number_counters add constraint request_number_counters_service_check check(service in ('rooms','restaurant','events','tours','tables','event_enquiries','vip'));
insert into public.request_number_counters(service) values('vip');
create trigger assign_request_number before insert or update on public.restaurant_vip_requests
  for each row execute function harla_private.assign_request_number('vip');
create trigger master_activity_vip after insert or update on public.restaurant_vip_requests
  for each row execute function public.capture_harla_admin_activity('VIP dining');

create function public.create_restaurant_vip_request(p_id uuid,p_name text,p_phone text,p_guests integer,p_date date,p_time time)
returns public.restaurant_vip_requests language plpgsql security invoker set search_path='' as $$
declare room public.restaurant_vip_room; existing public.restaurant_vip_requests; saved public.restaurant_vip_requests;
begin
  -- This lock serializes requests with occupancy changes, closing the stale-page race.
  select * into strict room from public.restaurant_vip_room where id='default' for update;
  select * into existing from public.restaurant_vip_requests where id=p_id;
  if found then
    if existing.full_name<>p_name or existing.phone<>p_phone then raise exception 'Reference already used' using errcode='23505'; end if;
    return existing;
  end if;
  if room.status='occupied' then raise exception 'VIP room occupied' using errcode='P0001'; end if;
  if (select count(*) from public.restaurant_vip_requests where phone=p_phone and created_at>now()-interval '1 minute')>=3 then
    raise exception 'Too many requests' using errcode='P0002';
  end if;
  insert into public.restaurant_vip_requests(id,booking_reference,full_name,phone,guests,preferred_date,preferred_time)
  values(p_id,'VIP-'||replace(p_id::text,'-',''),p_name,p_phone,p_guests,p_date,p_time) returning * into saved;
  return saved;
end $$;
revoke all on function public.create_restaurant_vip_request(uuid,text,text,integer,date,time) from public,anon,authenticated;
grant execute on function public.create_restaurant_vip_request(uuid,text,text,integer,date,time) to service_role;

create function public.transition_restaurant_vip(p_action text,p_request_id uuid,p_expected_version integer,p_room_version integer,p_actor uuid)
returns public.restaurant_vip_room language plpgsql security invoker set search_path='' as $$
declare room public.restaurant_vip_room; req public.restaurant_vip_requests; actor_email text;
begin
  select email into actor_email from public.master_admin_users where user_id=p_actor and active;
  if not found then select email into actor_email from public.admin_users where user_id=p_actor and active; end if;
  if actor_email is null then raise exception 'Restaurant staff required' using errcode='42501'; end if;
  select * into strict room from public.restaurant_vip_room where id='default' for update;
  if p_room_version is null or room.version<>p_room_version then raise exception 'Room changed' using errcode='40001'; end if;
  if p_request_id is not null then
    select * into req from public.restaurant_vip_requests where id=p_request_id for update;
    if not found or p_expected_version is null or req.version<>p_expected_version then raise exception 'Request changed' using errcode='40001'; end if;
  end if;
  if p_action='contact' then
    if req.id is null or req.status<>'pending' then raise exception 'Invalid contact action' using errcode='22023'; end if;
    update public.restaurant_vip_requests set status='contacted',contacted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=req.id;
  elsif p_action='decline' then
    if req.id is null or req.status not in ('pending','contacted') then raise exception 'Invalid decline action' using errcode='22023'; end if;
    update public.restaurant_vip_requests set status='declined',version=version+1,updated_at=clock_timestamp() where id=req.id;
  elsif p_action='occupy' then
    if room.status<>'available' then raise exception 'VIP room occupied' using errcode='P0001'; end if;
    if p_request_id is not null and req.status<>'contacted' then raise exception 'Contact the guest first' using errcode='22023'; end if;
    if req.id is not null then
      update public.restaurant_vip_requests set status='occupied',occupied_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=req.id;
    end if;
    update public.restaurant_vip_room set status='occupied',active_request_id=req.id,version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id='default' returning * into room;
  elsif p_action='release' then
    if room.status<>'occupied' then raise exception 'Room is already available' using errcode='22023'; end if;
    if room.active_request_id is not null then
      update public.restaurant_vip_requests set status='completed',released_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=room.active_request_id;
    end if;
    update public.restaurant_vip_room set status='available',active_request_id=null,version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id='default' returning * into room;
  else raise exception 'Invalid VIP action' using errcode='22023';
  end if;
  if p_action in ('occupy','release') then
    insert into public.admin_activity(service,record_id,reference,customer_name,action,status,actor_id,actor_email,details)
    values('VIP room','default',coalesce(req.booking_reference,'VIP Majlis'),req.full_name,
      case when p_action='release' then 'room_released' else 'room_occupied' end,room.status,p_actor,actor_email,
      jsonb_build_object('active_request_id',room.active_request_id));
  end if;
  return room;
end $$;
revoke all on function public.transition_restaurant_vip(text,uuid,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.transition_restaurant_vip(text,uuid,integer,integer,uuid) to service_role;
