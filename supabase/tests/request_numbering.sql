-- Transactional regression: no records or counter changes remain afterwards.
begin;
set local role service_role;
do $$
declare first_row public.restaurant_orders; second_row public.restaurant_orders; third_row public.restaurant_orders;
  counter public.request_number_counters; actor uuid;
begin
  select user_id into strict actor from public.master_admin_users where active order by created_at limit 1;
  select * into strict counter from public.request_number_counters where service='restaurant';
  insert into public.restaurant_orders(order_number,customer_name,phone,order_type,items,payment_method,payment_status,request_number,request_series)
  values('NUMBERING-ROLLBACK-1','Synthetic rollback test','0000000000','Dine In','[{"name":"Test item","quantity":1,"price":30,"line_total":30}]','cash_at_hotel','pay_at_hotel',999999,999999) returning * into first_row;
  if first_row.request_number<>counter.next_number or first_row.request_series<>counter.series then raise exception 'Server must assign the number and ignore client spoofing'; end if;
  insert into public.restaurant_orders(order_number,customer_name,phone,order_type,items,payment_method,payment_status)
  values('NUMBERING-ROLLBACK-2','Synthetic rollback test','0000000000','Dine In','[{"name":"Test item","quantity":1,"price":30,"line_total":30}]','cash_at_hotel','pay_at_hotel') returning * into second_row;
  if second_row.request_number<>first_row.request_number+1 then raise exception 'Numbers must increase'; end if;
  update public.restaurant_orders set request_number=999999,request_series=999999 where id=first_row.id returning * into third_row;
  if third_row.request_number<>first_row.request_number or third_row.request_series<>first_row.request_series then raise exception 'Existing numbering must be immutable'; end if;
  begin
    perform public.reset_request_numbering('restaurant',counter.series,'00000000-0000-0000-0000-000000000000');
    raise exception 'Non-master reset must fail';
  exception when insufficient_privilege then null; end;
  perform public.reset_request_numbering('restaurant',counter.series,actor);
  begin
    perform public.reset_request_numbering('restaurant',counter.series,actor);
    raise exception 'A duplicate/stale reset must fail';
  exception when serialization_failure then null; end;
  insert into public.restaurant_orders(order_number,customer_name,phone,order_type,items,payment_method,payment_status)
  values('NUMBERING-ROLLBACK-3','Synthetic rollback test','0000000000','Dine In','[{"name":"Test item","quantity":1,"price":30,"line_total":30}]','cash_at_hotel','pay_at_hotel') returning * into third_row;
  if third_row.request_number<>1 or third_row.request_series<>counter.series+1 then raise exception 'Reset must restart at 1 in the new series'; end if;
  if not exists(select 1 from public.restaurant_orders where id=first_row.id and request_number=first_row.request_number and order_number='NUMBERING-ROLLBACK-1') then raise exception 'Reset must preserve old bookings and references'; end if;
  if not exists(select 1 from public.admin_activity where action='numbering_reset' and actor_id=actor and details->>'new_series'=(counter.series+1)::text) then raise exception 'Reset must be audited'; end if;
end $$;
set local role anon;
do $$ begin
  if has_table_privilege(current_user,'public.request_number_counters','SELECT') or has_table_privilege('authenticated','public.request_number_counters','UPDATE')
    or has_function_privilege(current_user,'public.reset_request_numbering(text,integer,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.reset_request_numbering(text,integer,uuid)','EXECUTE') then raise exception 'Clients must not read or reset counters directly'; end if;
end $$;
rollback;
select 'Request numbering passed: spoofing, sequential assignment, immutability, reset, retained history, stale reset, authorization and audit.' as result;
