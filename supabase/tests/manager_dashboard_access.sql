-- Read-only regression: execute the dashboard/report projections with the actual server role.
-- Deliberately no SECURITY DEFINER or elevated-role fallback.
begin;
set local role service_role;
select 'rooms' as service, count(*) as readable_rows from (select id,booking_number,full_name,phone,email,room_type,check_in,check_out,number_of_rooms,status,payment_status,total_price_etb,total_price,created_at,updated_at from public.room_bookings order by created_at desc limit 40) records;
select 'restaurant' as service, count(*) as readable_rows from (select id,order_number,customer_name,phone,order_type,items,status,payment_method,payment_status,odoo_status,created_at,updated_at from public.restaurant_orders order by created_at desc limit 40) records;
select 'events' as service, count(*) as readable_rows from (select id,booking_reference,client_full_name,phone,email,hall_name,event_date,start_time,end_time,attendees,status,payment_status,quoted_amount,quoted_currency,created_at,updated_at from public.event_hall_bookings order by created_at desc limit 40) records;
select 'tours' as service, count(*) as readable_rows from (select id,package_name,full_name,phone,email,check_in,check_out,guests,message,status,created_at,updated_at from public.package_bookings order by created_at desc limit 40) records;
select 'tables' as service, count(*) as readable_rows from (select id,full_name,phone,email,reservation_date,reservation_time,guests,message,status,created_at,updated_at from public.restaurant_requests order by created_at desc limit 40) records;
select 'event_enquiries' as service, count(*) as readable_rows from (select id,full_name,phone,email,event_type,event_date,guests,message,status,created_at,updated_at from public.event_requests order by created_at desc limit 40) records;
select 'activity' as service, count(*) as readable_rows from (select id,service,record_id,reference,customer_name,action,previous_status,status,actor_email,amount,currency,details,created_at from public.admin_activity order by created_at desc, id desc limit 100) records;
select 'master_profile' as service, count(*) as readable_rows from (select user_id,email,full_name,active from public.master_admin_users where active) profiles;
select 'report_settings' as service, count(*) as readable_rows from public.manager_report_settings;
select 'report_history' as service, count(*) as readable_rows from (select id,kind,period_start,period_end,recipient_email,status,attempts,file_path,error,created_at,sent_at from public.manager_report_runs order by created_at desc limit 30) reports;
select 'All manager dashboard/report projections passed as service_role.' as result;
rollback;
