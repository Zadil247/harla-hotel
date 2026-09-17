-- Owner requested test cleanup. Archive explicit test names only; preserve ambiguous guests.
create schema if not exists harla_private;
revoke all on schema harla_private from public,anon,authenticated;
create table if not exists harla_private.test_record_archive (
  source_table text not null, record_id text not null, row_data jsonb not null,
  archived_at timestamptz not null default now(), reason text not null default 'Owner-requested cleanup of explicitly identified synthetic tests',
  primary key(source_table,record_id)
);
alter table harla_private.test_record_archive enable row level security;
revoke all on harla_private.test_record_archive from public,anon,authenticated,service_role;

-- Names must be explicit and must have been created before this reviewed cutoff.
insert into harla_private.test_record_archive(source_table,record_id,row_data)
select 'room_bookings',id::text,to_jsonb(r) from public.room_bookings r
where created_at<'2026-09-17T21:00:00Z' and (
 full_name in ('Stage A Test Guest','Harla QA Ethiopian 20260728','Harla QA International 20260728','Adil test','HARLA QA 20260916 TEST ONLY')
) on conflict do nothing;
insert into harla_private.test_record_archive(source_table,record_id,row_data)
select 'restaurant_orders',id::text,to_jsonb(r) from public.restaurant_orders r
where created_at<'2026-09-17T21:00:00Z' and customer_name in ('HARLA QA 20260916 DO NOT PREPARE','test 123')
on conflict do nothing;
insert into harla_private.test_record_archive(source_table,record_id,row_data)
select 'event_hall_bookings',id::text,to_jsonb(r) from public.event_hall_bookings r
where created_at<'2026-09-17T21:00:00Z' and client_full_name in ('Adil test','Adil test event','HARLA QA EVENT 20260916 TEST ONLY')
on conflict do nothing;
insert into harla_private.test_record_archive(source_table,record_id,row_data)
select 'room_inventory_hold_audit',id::text,to_jsonb(a) from public.room_inventory_hold_audit a
where booking_id::text in (select record_id from harla_private.test_record_archive where source_table='room_bookings')
on conflict do nothing;
insert into harla_private.test_record_archive(source_table,record_id,row_data)
select 'admin_activity',id::text,to_jsonb(a) from public.admin_activity a
where (service='Rooms' and record_id in(select record_id from harla_private.test_record_archive where source_table='room_bookings'))
 or (service='Restaurant' and record_id in(select record_id from harla_private.test_record_archive where source_table='restaurant_orders'))
 or (service='Events' and record_id in(select record_id from harla_private.test_record_archive where source_table='event_hall_bookings'))
on conflict do nothing;

delete from public.room_inventory_hold_audit where id::text in(select record_id from harla_private.test_record_archive where source_table='room_inventory_hold_audit');
delete from public.admin_activity where id::text in(select record_id from harla_private.test_record_archive where source_table='admin_activity');
delete from public.room_bookings where id::text in(select record_id from harla_private.test_record_archive where source_table='room_bookings');
delete from public.restaurant_orders where id::text in(select record_id from harla_private.test_record_archive where source_table='restaurant_orders');
delete from public.event_hall_bookings where id::text in(select record_id from harla_private.test_record_archive where source_table='event_hall_bookings');
-- Private test uploads remain referenced in the recovery archive, never exposed by staff dashboards.
