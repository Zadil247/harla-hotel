-- One-time owner-authorized cleanup, NOT an automatic migration or reset feature.
-- On 25 September the owner confirmed all existing service records were tests.
-- Preserve anything created after the reviewed cutoff. Never reset numbering.
-- Full original rows stay in the restricted recovery archive, not in source control.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.room_bookings, public.restaurant_orders,
  public.event_hall_bookings, public.event_requests,
  public.room_inventory_hold_audit, public.admin_activity
  in share row exclusive mode;

do $cleanup$
declare
  cutoff constant timestamptz := '2026-09-25T11:47:59Z';
  marker constant text := 'Owner-confirmed prelaunch test cleanup 2026-09-25';
  source record;
  found_count integer;
  changed_count integer;
  counters_before jsonb;
  counters_after jsonb;
begin
  select jsonb_agg(to_jsonb(c) order by service) into counters_before
    from public.request_number_counters c;

  for source in select * from (values
    ('room_bookings', 9), ('restaurant_orders', 5),
    ('event_hall_bookings', 2), ('event_requests', 8)
  ) as reviewed(table_name, expected_count)
  loop
    execute format('select count(*) from public.%I where created_at < $1', source.table_name)
      into found_count using cutoff;
    if found_count <> source.expected_count then
      raise exception 'Cleanup stopped: % has % reviewed rows, expected %',
        source.table_name, found_count, source.expected_count;
    end if;
    execute format('insert into harla_private.test_record_archive(source_table,record_id,row_data,reason)
      select $1,id::text,to_jsonb(r),$2 from public.%I r where created_at < $3
      on conflict do nothing', source.table_name)
      using source.table_name,marker,cutoff;
    get diagnostics changed_count = row_count;
    if changed_count <> source.expected_count then
      raise exception 'Cleanup stopped: archive conflict in %', source.table_name;
    end if;
  end loop;

  insert into harla_private.test_record_archive(source_table,record_id,row_data,reason)
  select 'room_inventory_hold_audit',a.id::text,to_jsonb(a),marker
  from public.room_inventory_hold_audit a
  where exists(select 1 from harla_private.test_record_archive r
    where r.source_table='room_bookings' and r.reason=marker and r.record_id=a.booking_id::text);

  insert into harla_private.test_record_archive(source_table,record_id,row_data,reason)
  select 'admin_activity',a.id::text,to_jsonb(a),marker from public.admin_activity a
  where exists(select 1 from harla_private.test_record_archive r where r.reason=marker
    and r.record_id=a.record_id and (
      (a.service='Rooms' and r.source_table='room_bookings') or
      (a.service='Restaurant' and r.source_table='restaurant_orders') or
      (a.service='Events' and r.source_table in ('event_hall_bookings','event_requests'))
    ));

  delete from public.room_inventory_hold_audit a using harla_private.test_record_archive r
    where r.source_table='room_inventory_hold_audit' and r.reason=marker and r.record_id=a.id::text;
  delete from public.admin_activity a using harla_private.test_record_archive r
    where r.source_table='admin_activity' and r.reason=marker and r.record_id=a.id::text;

  for source in select * from (values
    ('room_bookings', 9), ('restaurant_orders', 5),
    ('event_hall_bookings', 2), ('event_requests', 8)
  ) as reviewed(table_name, expected_count)
  loop
    execute format('delete from public.%I a using harla_private.test_record_archive r
      where r.source_table=$1 and r.reason=$2 and r.record_id=a.id::text and a.created_at < $3', source.table_name)
      using source.table_name,marker,cutoff;
    get diagnostics changed_count = row_count;
    if changed_count <> source.expected_count then
      raise exception 'Cleanup stopped: deletion count mismatch in %', source.table_name;
    end if;
  end loop;

  select jsonb_agg(to_jsonb(c) order by service) into counters_after
    from public.request_number_counters c;
  if counters_before is distinct from counters_after then
    raise exception 'Cleanup stopped: numbering changed';
  end if;
end $cleanup$;
commit;

-- Recovery is an explicit maintenance action: insert archived row_data using
-- jsonb_populate_record(null::public.<source_table>, row_data), primary booking
-- rows first, then hold audit/activity. Review insert triggers before restoring;
-- never expose the archive or this operation through a public/client endpoint.
