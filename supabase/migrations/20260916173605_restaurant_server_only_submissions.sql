-- Apply only after the website uses /api/restaurant for submissions.
-- Prices and payment uploads must pass through the trusted server workflow.
revoke insert on public.restaurant_orders from anon, authenticated, public;
