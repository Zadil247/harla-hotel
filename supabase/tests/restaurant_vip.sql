-- All guest records, room occupancy and counters are rolled back.
begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare actor uuid; other_staff uuid; room public.restaurant_vip_room; a public.restaurant_vip_requests; b public.restaurant_vip_requests; repeated public.restaurant_vip_requests;
begin
  select user_id into strict actor from public.master_admin_users where active order by created_at limit 1;
  perform set_config('request.headers',jsonb_build_object('x-harla-actor',actor)::text,true);
  select * into room from public.restaurant_vip_room where id='default';
  if room.status<>'available' then raise exception 'Do not test over an occupied real room'; end if;
  a:=public.create_restaurant_vip_request(gen_random_uuid(),'VIP rollback test','0000000011',null,null,null);
  if a.guests is not null or a.preferred_date is not null or a.preferred_time is not null or a.request_number is null then raise exception 'Optional fields and numbering must work'; end if;
  repeated:=public.create_restaurant_vip_request(a.id,a.full_name,a.phone,null,null,null);
  if repeated.id<>a.id or repeated.request_number<>a.request_number then raise exception 'Retry must return the original receipt'; end if;
  b:=public.create_restaurant_vip_request(gen_random_uuid(),'VIP rollback test','0000000012',6,current_date+1,'18:30');
  begin
    perform public.transition_restaurant_vip('contact',a.id,a.version,room.version,'00000000-0000-0000-0000-000000000000');
    raise exception 'Unknown staff must be rejected';
  exception when insufficient_privilege then null; end;
  select user_id into other_staff from public.room_admin_users where active and user_id not in(select user_id from public.master_admin_users where active) and user_id not in(select user_id from public.admin_users where active) limit 1;
  if other_staff is not null then
    begin
      perform public.transition_restaurant_vip('contact',a.id,a.version,room.version,other_staff);
      raise exception 'Room-only staff must not control VIP dining';
    exception when insufficient_privilege then null; end;
  end if;
  begin
    perform public.transition_restaurant_vip('occupy',a.id,a.version,room.version,actor);
    raise exception 'Contact must happen first';
  exception when invalid_parameter_value then null; end;
  perform public.transition_restaurant_vip('contact',a.id,a.version,room.version,actor);
  begin
    perform public.transition_restaurant_vip('contact',a.id,a.version,room.version,actor);
    raise exception 'Stale request must be rejected';
  exception when serialization_failure then null; end;
  select * into a from public.restaurant_vip_requests where id=a.id;
  room:=public.transition_restaurant_vip('occupy',a.id,a.version,room.version,actor);
  if room.status<>'occupied' or room.active_request_id<>a.id then raise exception 'Room must become occupied'; end if;
  begin
    perform public.create_restaurant_vip_request(gen_random_uuid(),'Blocked rollback test','0000000013',null,null,null);
    raise exception 'Occupied room must reject new public requests' using errcode='23514';
  exception when sqlstate 'P0001' then null; end;
  perform public.transition_restaurant_vip('contact',b.id,b.version,room.version,actor);
  select * into b from public.restaurant_vip_requests where id=b.id;
  begin
    perform public.transition_restaurant_vip('occupy',b.id,b.version,room.version,actor);
    raise exception 'A second occupancy must fail' using errcode='23514';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.transition_restaurant_vip('release',null,null,room.version-1,actor);
    raise exception 'Stale release must fail';
  exception when serialization_failure then null; end;
  room:=public.transition_restaurant_vip('release',null,null,room.version,actor);
  if room.status<>'available' or room.active_request_id is not null then raise exception 'Release must reopen the room'; end if;
  if (select status from public.restaurant_vip_requests where id=a.id)<>'completed' then raise exception 'Release must complete the occupied request'; end if;
  perform public.create_restaurant_vip_request(gen_random_uuid(),'Reopened rollback test','0000000014',null,null,null);
  perform public.transition_restaurant_vip('decline',b.id,b.version,room.version,actor);
  if not exists(select 1 from public.admin_activity where service='VIP dining' and record_id=a.id::text and actor_id=actor and action='contacted') then raise exception 'Staff actions must be attributed'; end if;
  room:=public.transition_restaurant_vip('occupy',null,null,room.version,actor);
  if room.status<>'occupied' then raise exception 'Phone/walk-in occupancy must work'; end if;
  perform public.transition_restaurant_vip('release',null,null,room.version,actor);
end $$;
set local role anon;
do $$ begin
  if has_table_privilege(current_user,'public.restaurant_vip_requests','SELECT') or has_table_privilege(current_user,'public.restaurant_vip_requests','INSERT')
    or has_table_privilege('authenticated','public.restaurant_vip_room','UPDATE')
    or has_function_privilege(current_user,'public.create_restaurant_vip_request(uuid,text,text,integer,date,time)','EXECUTE')
    or has_function_privilege('authenticated','public.transition_restaurant_vip(text,uuid,integer,integer,uuid)','EXECUTE') then raise exception 'VIP records and actions must be server-only'; end if;
end $$;
rollback;
select 'VIP workflow passed: optional fields, retries, roles, contact, occupancy lock, reopen, stale requests, audit and privacy.' as result;
