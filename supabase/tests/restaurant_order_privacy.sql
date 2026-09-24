-- Run after restaurant_server_only_submissions. Synthetic data is rolled back.
begin;
set local role service_role;
insert into public.restaurant_orders
  (order_number, customer_name, phone, order_type, items, payment_method, payment_status)
values
  ('HARLA-PRIVACY-REGRESSION', 'Synthetic rollback test', '0000000000', 'Dine In',
   '[{"name":"Test item","quantity":1,"price":30,"line_total":30}]', 'cash_at_hotel', 'pay_at_hotel');
set local role anon;
do $$
begin
  if has_table_privilege(current_user, 'public.restaurant_orders', 'SELECT') then
    raise exception 'Anonymous direct order reads must be denied';
  end if;
  if has_table_privilege(current_user, 'public.restaurant_orders', 'INSERT')
    or has_table_privilege('authenticated', 'public.restaurant_orders', 'INSERT') then
    raise exception 'Direct client order creation must be denied';
  end if;
  if (select count(*) from public.get_restaurant_order_status('HARLA-PRIVACY-REGRESSION', '0000000000')) <> 1 then
    raise exception 'Matching customer lookup must return the order';
  end if;
  if (select count(*) from public.get_restaurant_order_status('HARLA-PRIVACY-REGRESSION', '1111111111')) <> 0 then
    raise exception 'Mismatched customer lookup must not return the order';
  end if;
  begin
    insert into public.restaurant_orders
      (order_number, customer_name, phone, order_type, items, payment_method, payment_status)
    values
      ('HARLA-PRIVACY-REJECTED', 'Synthetic rollback test', '0000000000', 'Dine In',
       '[{"name":"Spoofed item","quantity":1,"price":0}]', 'cash_at_hotel', 'pay_at_hotel');
    raise exception 'Anonymous users must not bypass server pricing';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select 'restaurant privacy regression passed' as result;
rollback;
