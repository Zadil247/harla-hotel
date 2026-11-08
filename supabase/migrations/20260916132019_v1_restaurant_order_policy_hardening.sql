-- Remove legacy policies that bypass the intended private lookup and pending-only inserts.
-- Customer status continues through get_restaurant_order_status(order number, phone).
-- Existing admin policies and order records are preserved.
drop policy if exists anon_select_restaurant_order_status on public.restaurant_orders;
drop policy if exists anon_insert_restaurant_orders on public.restaurant_orders;
revoke select on public.restaurant_orders from anon;
