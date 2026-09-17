-- Separate management authority. No client can grant roles or read business reports.
create table public.master_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, full_name text not null default 'Hotel Management',
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.manager_report_settings (
  id text primary key default 'default' check(id='default'),
  enabled boolean not null default false, recipient_email text,
  frequency text not null default 'daily' check(frequency in ('daily','weekly','monthly')),
  send_time text not null default '08:00' check(send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekday integer not null default 1 check(weekday between 0 and 6),
  month_day integer not null default 1 check(month_day between 1 and 31),
  summary_frequency text not null default 'weekly' check(summary_frequency in ('off','weekly','monthly')),
  next_report_at timestamptz, next_summary_at timestamptz,
  revision uuid not null default gen_random_uuid(), updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check(not enabled or (recipient_email is not null and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
);
insert into public.manager_report_settings(id) values('default');
create table public.admin_activity (
  id bigint generated always as identity primary key, service text not null,
  record_id text not null, reference text, customer_name text,
  action text not null, previous_status text, status text,
  actor_id uuid, actor_email text, amount numeric, currency text,
  details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index admin_activity_created_idx on public.admin_activity(created_at desc);
create index admin_activity_record_idx on public.admin_activity(service,record_id);
create table public.manager_report_runs (
  id uuid primary key default gen_random_uuid(), idempotency_key text not null unique,
  kind text not null check(kind in ('report','summary')),
  period_start timestamptz not null, period_end timestamptz not null,
  recipient_email text not null, status text not null default 'processing' check(status in ('processing','sent','failed')),
  attempts integer not null default 1, lease_expires_at timestamptz not null default now()+interval '3 minutes',
  file_path text, summary jsonb, message_id text, error text,
  created_at timestamptz not null default now(), sent_at timestamptz,
  check(period_start < period_end)
);
create index manager_report_runs_created_idx on public.manager_report_runs(created_at desc);
create table public.manager_scheduler_auth (id text primary key check(id='default'), token_hash text not null);

do $$ declare t text; begin
  foreach t in array array['master_admin_users','manager_report_settings','admin_activity','manager_report_runs','manager_scheduler_auth'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage, select on sequence public.admin_activity_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('manager-reports','manager-reports',false,15728640,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false;

-- The actor header is accepted only on verified server requests using service_role.
create or replace function public.capture_harla_admin_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  n jsonb := to_jsonb(new); o jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  actor uuid; actor_email_value text; action_value text; amount_value numeric;
  tracked text[] := array['status','payment_status','odoo_status','inventory_hold_active','customer_contacted','quoted_amount','ordering_available','custom_message','total_rooms','sellable_rooms'];
  changed jsonb := '{}'; k text;
begin
  foreach k in array tracked loop
    if n ? k and n->k is distinct from o->k then changed := changed || jsonb_build_object(k,n->k); end if;
  end loop;
  if tg_op='UPDATE' and changed='{}'::jsonb then return new; end if;
  if claims->>'role'='service_role' and coalesce(headers->>'x-harla-actor','') ~ '^[0-9a-fA-F-]{36}$' then
    actor := (headers->>'x-harla-actor')::uuid;
  elsif claims->>'role'='authenticated' then actor := auth.uid(); end if;
  if actor is not null then select email into actor_email_value from auth.users where id=actor; end if;
  action_value := case when tg_op='INSERT' then 'created'
    when n->>'status' is distinct from o->>'status' then n->>'status'
    when n->>'odoo_status'='entered' and n->>'odoo_status' is distinct from o->>'odoo_status' then 'sent_to_kitchen'
    when n->>'payment_status' is distinct from o->>'payment_status' then 'payment_updated'
    when n->>'inventory_hold_active' is distinct from o->>'inventory_hold_active' then 'inventory_hold_updated'
    else 'updated' end;
  if tg_table_name='restaurant_orders' then
    select coalesce(sum((item->>'line_total')::numeric),0) into amount_value from jsonb_array_elements(coalesce(n->'items','[]')) item;
  else amount_value := coalesce(nullif(n->>'total_price_etb','')::numeric,nullif(n->>'total_price','')::numeric,nullif(n->>'quoted_amount','')::numeric); end if;
  insert into public.admin_activity(service,record_id,reference,customer_name,action,previous_status,status,actor_id,actor_email,amount,currency,details)
  values(tg_argv[0],n->>'id',coalesce(n->>'booking_number',n->>'order_number',n->>'booking_reference',n->>'id'),
    coalesce(n->>'full_name',n->>'customer_name',n->>'client_full_name',n->>'room_type','Restaurant settings'),
    action_value,o->>'status',n->>'status',actor,actor_email_value,amount_value,
    case when tg_table_name='event_hall_bookings' then coalesce(n->>'quoted_currency','ETB') else 'ETB' end,changed);
  return new;
end $$;
revoke all on function public.capture_harla_admin_activity() from public,anon,authenticated;
create trigger master_activity_room after insert or update on public.room_bookings for each row execute function public.capture_harla_admin_activity('Rooms');
create trigger master_activity_restaurant after insert or update on public.restaurant_orders for each row execute function public.capture_harla_admin_activity('Restaurant');
create trigger master_activity_events after insert or update on public.event_hall_bookings for each row execute function public.capture_harla_admin_activity('Events');
create trigger master_activity_event_inquiry after insert or update on public.event_requests for each row execute function public.capture_harla_admin_activity('Event enquiries');
create trigger master_activity_table_inquiry after insert or update on public.restaurant_requests for each row execute function public.capture_harla_admin_activity('Table enquiries');
create trigger master_activity_package after insert or update on public.package_bookings for each row execute function public.capture_harla_admin_activity('Tours');
create trigger master_activity_inventory after update on public.room_inventory for each row execute function public.capture_harla_admin_activity('Room inventory');
create trigger master_activity_ordering after update on public.restaurant_settings for each row execute function public.capture_harla_admin_activity('Restaurant settings');

create or replace function public.claim_manager_report(p_key text,p_kind text,p_start timestamptz,p_end timestamptz,p_recipient text)
returns setof public.manager_report_runs language sql set search_path='' as $$
  insert into public.manager_report_runs(idempotency_key,kind,period_start,period_end,recipient_email)
  values(p_key,p_kind,p_start,p_end,p_recipient)
  on conflict(idempotency_key) do update set status='processing',attempts=manager_report_runs.attempts+1,
    lease_expires_at=now()+interval '3 minutes',error=null
  where manager_report_runs.status!='sent' and manager_report_runs.attempts<5
    and (manager_report_runs.status='failed' or manager_report_runs.lease_expires_at<now())
  returning *;
$$;
revoke all on function public.claim_manager_report(text,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.claim_manager_report(text,text,timestamptz,timestamptz,text) to service_role;

-- Master authority uses the same inventory locks and transitions.
create or replace function public.transition_room_booking_inventory_authority_v1(
  p_booking_id uuid,
  p_expected_status text,
  p_action text,
  p_reason text,
  p_actor_user_id uuid
)
returns public.room_bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  booking_record public.room_bookings%rowtype;
  updated_record public.room_bookings%rowtype;
  inventory_record public.room_inventory%rowtype;
  actor_record public.room_admin_users%rowtype;
  held_capacity integer;
  clean_action text := lower(btrim(coalesce(p_action, '')));
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  now_value timestamptz := now();
  local_today date := (now() at time zone 'Africa/Addis_Ababa')::date;
  release_type_value text;
  release_reason_value text;
begin
  select user_id, email, full_name, 'master_admin'::text, active, created_at, updated_at
  into actor_record from public.master_admin_users
  where user_id=p_actor_user_id and active=true;
  if not found then
  select * into actor_record
  from public.room_admin_users room_admin
  where room_admin.user_id = p_actor_user_id
    and room_admin.active = true
    and room_admin.role in ('room_admin', 'room_manager', 'hotel_manager', 'master_admin');

  end if;

  if not found then
    raise exception using errcode = '42501', message = 'Active Harla Hotel Room Admin access is required.';
  end if;

  select * into booking_record
  from public.room_bookings booking
  where booking.id = p_booking_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Room booking was not found.';
  end if;
  if booking_record.status is distinct from p_expected_status then
    raise exception using
      errcode = '40001',
      message = 'This booking changed while you were reviewing it. Refresh and try again.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('harla-room:' || lower(btrim(booking_record.room_type)), 0)
  );

  if clean_action = 'confirm' then
    if booking_record.status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved'
    ) then
      raise exception using errcode = '22023', message = 'Only an active pending room booking can be confirmed.';
    end if;
    if not booking_record.inventory_hold_active then
      raise exception using errcode = 'P0001', message = 'Restore this booking inventory hold before confirming it.';
    end if;
    update public.room_bookings
    set status = 'confirmed',
        confirmed_at = now_value,
        declined_at = null,
        decline_reason = null,
        payment_status = case
          when payment_status in (
            'pending', 'pending_verification', 'pending_payment_review',
            'pending_payment_confirmation', 'submitted_for_verification'
          ) then 'verified'
          else payment_status
        end,
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'decline' then
    if booking_record.status not in (
      'pending', 'pending_review', 'pending_payment_review',
      'pending_payment_confirmation', 'approved'
    ) then
      raise exception using errcode = '22023', message = 'Only an active pending room booking can be declined.';
    end if;
    release_reason_value := coalesce(clean_reason, 'Harla Hotel could not approve this room request.');
    update public.room_bookings
    set status = 'declined',
        confirmed_at = null,
        declined_at = now_value,
        decline_reason = release_reason_value,
        inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = release_reason_value,
        inventory_release_type = 'declined',
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'cancel' then
    if booking_record.status in ('declined', 'rejected', 'cancelled', 'checked_out') then
      raise exception using errcode = '22023', message = 'This booking is already inactive.';
    end if;
    release_reason_value := coalesce(clean_reason, 'This booking was cancelled by Harla Hotel.');
    update public.room_bookings
    set status = 'cancelled',
        decline_reason = release_reason_value,
        inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = release_reason_value,
        inventory_release_type = 'cancelled',
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'check_in' then
    if booking_record.status not in ('approved', 'confirmed') then
      raise exception using errcode = '22023', message = 'Only an approved or confirmed booking can be checked in.';
    end if;
    if not booking_record.inventory_hold_active then
      raise exception using errcode = 'P0001', message = 'Restore this booking inventory hold before checking in the guest.';
    end if;
    update public.room_bookings
    set status = 'checked_in',
        actual_check_in_at = coalesce(actual_check_in_at, now_value),
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'check_out' then
    if booking_record.status not in ('approved', 'confirmed', 'checked_in') then
      raise exception using errcode = '22023', message = 'Only an approved, confirmed, or checked-in booking can be checked out.';
    end if;
    release_type_value := case when local_today < booking_record.check_out then 'early_checkout' else 'checkout' end;
    release_reason_value := coalesce(
      clean_reason,
      case when release_type_value = 'early_checkout' then 'Guest checked out early.' else 'Guest checked out.' end
    );
    update public.room_bookings
    set status = 'checked_out',
        actual_check_out_at = now_value,
        inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = release_reason_value,
        inventory_release_type = release_type_value,
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'force_release' then
    if not public.room_booking_status_blocks_inventory(booking_record.status) then
      raise exception using errcode = '22023', message = 'This booking status does not hold room inventory.';
    end if;
    if not booking_record.inventory_hold_active then
      raise exception using errcode = '22023', message = 'This booking inventory is already released.';
    end if;
    if clean_reason is null then
      raise exception using errcode = '22023', message = 'A management reason is required to force-release inventory.';
    end if;
    update public.room_bookings
    set inventory_hold_active = false,
        inventory_released_at = now_value,
        inventory_released_by = p_actor_user_id,
        inventory_released_by_email = actor_record.email,
        inventory_released_by_role = actor_record.role,
        inventory_release_reason = clean_reason,
        inventory_release_type = 'manual_override',
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  elsif clean_action = 'restore_hold' then
    if not public.room_booking_status_blocks_inventory(booking_record.status) then
      raise exception using errcode = '22023', message = 'Only an active booking can restore an inventory hold.';
    end if;
    if booking_record.inventory_hold_active then
      raise exception using errcode = '22023', message = 'This booking is already holding room inventory.';
    end if;
    if clean_reason is null then
      raise exception using errcode = '22023', message = 'A reason is required to restore inventory.';
    end if;

    select * into inventory_record
    from public.room_inventory inventory
    where lower(btrim(inventory.room_type)) = lower(btrim(booking_record.room_type))
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'The selected room type is not configured.';
    end if;

    select coalesce(sum(coalesce(booking.number_of_rooms, 1)), 0)::integer
    into held_capacity
    from public.room_bookings booking
    where lower(btrim(booking.room_type)) = lower(btrim(booking_record.room_type))
      and public.room_booking_status_blocks_inventory(booking.status)
      and booking.inventory_hold_active = true
      and booking.check_in < booking_record.check_out
      and booking_record.check_in < booking.check_out
      and booking.id <> booking_record.id;

    if held_capacity + coalesce(booking_record.number_of_rooms, 1) > inventory_record.sellable_rooms then
      raise exception using
        errcode = 'P0001',
        message = 'Inventory cannot be restored because the room capacity is already committed for these dates.';
    end if;

    update public.room_bookings
    set inventory_hold_active = true,
        inventory_released_at = null,
        inventory_released_by = null,
        inventory_released_by_email = null,
        inventory_released_by_role = null,
        inventory_release_reason = null,
        inventory_release_type = null,
        updated_at = now_value
    where id = booking_record.id and status = p_expected_status
    returning * into updated_record;

  else
    raise exception using errcode = '22023', message = 'Choose a valid Room Admin booking action.';
  end if;

  if updated_record.id is null then
    raise exception using
      errcode = '40001',
      message = 'This booking changed while you were reviewing it. Refresh and try again.';
  end if;

  if clean_action in ('decline', 'cancel', 'check_in', 'check_out', 'force_release', 'restore_hold') then
    insert into public.room_inventory_hold_audit (
      booking_id, booking_number, action,
      booking_status_before, booking_status_after,
      previous_hold_active, new_hold_active,
      release_type, reason,
      actor_user_id, actor_email, actor_role
    ) values (
      booking_record.id, booking_record.booking_number, clean_action,
      booking_record.status, updated_record.status,
      booking_record.inventory_hold_active, updated_record.inventory_hold_active,
      case
        when clean_action = 'restore_hold' then booking_record.inventory_release_type
        else updated_record.inventory_release_type
      end,
      case when clean_action = 'restore_hold' then clean_reason else updated_record.inventory_release_reason end,
      actor_record.user_id, actor_record.email, actor_record.role
    );
  end if;

  return updated_record;
end;
$$;
