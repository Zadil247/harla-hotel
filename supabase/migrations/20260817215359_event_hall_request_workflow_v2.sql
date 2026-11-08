-- Harla Hotel Event Hall request, quote, secure portal, and Events Team admin workflow.
-- Additive migration applied after 20260816140037_create_event_hall_booking_v1.sql.
-- Existing Event Hall rows and the legacy public.event_requests table are preserved.

do $$
begin
  if to_regclass('public.event_hall_bookings') is null then
    raise exception 'public.event_hall_bookings is required. Apply the Event Hall V1 migration first.';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'public.set_updated_at() is required. Apply supabase/schema.sql first.';
  end if;
end;
$$;

create table if not exists public.event_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'event_admin'
    check (role in ('event_admin', 'event_manager')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists event_admin_users_set_updated_at on public.event_admin_users;
create trigger event_admin_users_set_updated_at
before update on public.event_admin_users
for each row execute function public.set_updated_at();

alter table public.event_admin_users enable row level security;

create or replace function public.is_harla_event_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_admin_users
    where user_id = (select auth.uid())
      and active = true
  );
$$;

revoke execute on function public.is_harla_event_admin() from public;
grant execute on function public.is_harla_event_admin() to anon, authenticated, service_role;

alter table public.event_hall_bookings
  add column if not exists portal_token_hash text,
  add column if not exists portal_token_issued_at timestamptz,
  add column if not exists portal_token_rotated_at timestamptz,
  add column if not exists quoted_amount numeric(12, 2),
  add column if not exists quoted_currency text not null default 'ETB',
  add column if not exists quoted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists payment_instructions text,
  add column if not exists payment_deadline timestamptz,
  add column if not exists quote_sent_at timestamptz,
  add column if not exists needs_information_message text,
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists payment_rejection_reason text,
  add column if not exists last_email_type text;

alter table public.event_hall_bookings
  drop constraint if exists event_hall_bookings_status_check,
  drop constraint if exists event_hall_bookings_booking_source_check,
  drop constraint if exists event_hall_booking_valid_time,
  drop constraint if exists event_hall_booking_confirmation_path,
  drop constraint if exists event_hall_booking_portal_token_hash,
  drop constraint if exists event_hall_booking_quote_amount,
  drop constraint if exists event_hall_booking_quote_currency,
  drop constraint if exists event_hall_booking_payment_instructions_length,
  drop constraint if exists event_hall_booking_needs_information_length,
  drop constraint if exists event_hall_booking_payment_rejection_length,
  drop constraint if exists event_hall_booking_last_email_type;

-- Legacy V1 pending rows remain intact and become request-first records.
update public.event_hall_bookings
set status = 'pending_review'
where status = 'pending';

alter table public.event_hall_bookings
  add constraint event_hall_booking_valid_time check (end_time <> start_time),
  add constraint event_hall_bookings_status_check check (
    status in (
      'pending_review',
      'needs_information',
      'approved_awaiting_payment',
      'payment_submitted',
      'confirmed',
      'completed',
      'rejected',
      'cancelled'
    )
  ),
  add constraint event_hall_bookings_booking_source_check check (
    booking_source in ('WEBSITE', 'ADMIN', 'WALK_IN', 'PHONE', 'ADMIN_OTHER')
  ),
  add constraint event_hall_booking_confirmation_path check (
    confirmation_pdf_path is null
    or (
      booking_source = 'WEBSITE'
      and confirmation_pdf_path = 'website/' || booking_reference || '.pdf'
    )
    or (
      booking_source <> 'WEBSITE'
      and confirmation_pdf_path = 'admin/' || booking_reference || '.pdf'
    )
  ),
  add constraint event_hall_booking_portal_token_hash check (
    portal_token_hash is null or portal_token_hash ~ '^[a-f0-9]{64}$'
  ),
  add constraint event_hall_booking_quote_amount check (
    quoted_amount is null or quoted_amount > 0
  ),
  add constraint event_hall_booking_quote_currency check (
    quoted_currency ~ '^[A-Z]{3}$'
  ),
  add constraint event_hall_booking_payment_instructions_length check (
    payment_instructions is null or length(btrim(payment_instructions)) between 1 and 3000
  ),
  add constraint event_hall_booking_needs_information_length check (
    needs_information_message is null or length(btrim(needs_information_message)) between 1 and 1500
  ),
  add constraint event_hall_booking_payment_rejection_length check (
    payment_rejection_reason is null or length(btrim(payment_rejection_reason)) between 1 and 1500
  ),
  add constraint event_hall_booking_last_email_type check (
    last_email_type is null or last_email_type in (
      'request_received',
      'needs_information',
      'payment_request',
      'payment_submitted',
      'confirmed',
      'status_update'
    )
  );

create unique index if not exists event_hall_bookings_portal_token_hash_uidx
  on public.event_hall_bookings (portal_token_hash)
  where portal_token_hash is not null;
create index if not exists event_hall_bookings_workflow_status_idx
  on public.event_hall_bookings (status, event_date, start_time, created_at desc);
create index if not exists event_hall_bookings_payment_deadline_idx
  on public.event_hall_bookings (payment_deadline)
  where status = 'approved_awaiting_payment';

alter table public.event_hall_bookings
  drop constraint if exists event_hall_bookings_no_overlap;

alter table public.event_hall_bookings
  add constraint event_hall_bookings_no_overlap
  exclude using gist (
    hall_id with =,
    tsrange(
      event_date + start_time,
      event_date + end_time
        + case
            when end_time < start_time then interval '1 day'
            else interval '0 days'
          end,
      '[)'
    ) with &&
  )
  where (status in ('approved_awaiting_payment', 'payment_submitted', 'confirmed'));

create or replace function public.event_hall_slot_is_available(
  p_hall_id uuid,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_exclude_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_hall_id is null
    or p_event_date is null
    or p_start_time is null
    or p_end_time is null
    or p_end_time = p_start_time then
    return false;
  end if;

  return not exists (
    select 1
    from public.event_hall_bookings booking
    where booking.hall_id = p_hall_id
      and booking.id is distinct from p_exclude_booking_id
      and booking.status in ('approved_awaiting_payment', 'payment_submitted', 'confirmed')
      and tsrange(
        booking.event_date + booking.start_time,
        booking.event_date + booking.end_time
          + case
              when booking.end_time < booking.start_time then interval '1 day'
              else interval '0 days'
            end,
        '[)'
      ) && tsrange(
        p_event_date + p_start_time,
        p_event_date + p_end_time
          + case
              when p_end_time < p_start_time then interval '1 day'
              else interval '0 days'
            end,
        '[)'
      )
  );
end;
$$;

revoke execute on function public.event_hall_slot_is_available(uuid, date, time, time, uuid) from public;
grant execute on function public.event_hall_slot_is_available(uuid, date, time, time, uuid)
  to anon, authenticated, service_role;

create or replace function public.next_event_hall_booking_reference()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'HARLA-HALL-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.event_hall_booking_number_seq')::text, 4, '0');
$$;

revoke execute on function public.next_event_hall_booking_reference() from public, anon, authenticated;
grant execute on function public.next_event_hall_booking_reference() to service_role;

-- V2 public requests are created through trusted server code. Disable the V1
-- browser-callable creation and room-admin update functions without dropping them.
revoke execute on function public.create_event_hall_booking(
  uuid, uuid, text, text, text, text, text, text, text, date, time, time,
  integer, jsonb, text, text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.update_event_hall_booking_status(uuid, text, text, text)
  from public, anon, authenticated;

-- Trusted Event Hall APIs use the server-only service role directly. RLS bypass
-- does not replace SQL table privileges, so grant only the operations those APIs
-- actually perform. No Event Hall server workflow deletes rows.
revoke all on table public.event_admin_users from service_role;
grant select on table public.event_admin_users to service_role;

revoke all on table public.event_hall_bookings from service_role;
grant select, insert, update on table public.event_hall_bookings to service_role;

revoke all on table public.event_halls from service_role;
grant select on table public.event_halls to service_role;

revoke all on table public.event_requests from service_role;
grant select on table public.event_requests to service_role;

revoke all on public.event_admin_users from anon, authenticated;
grant select on public.event_admin_users to authenticated;

drop policy if exists "Event admins can read their profile" on public.event_admin_users;
create policy "Event admins can read their profile"
on public.event_admin_users for select
to authenticated
using (user_id = (select auth.uid()) and active = true);

-- Room admins no longer have Event Hall table access. Events Team authorization
-- is independent and is enforced by RLS as well as server endpoint checks.
drop policy if exists "Admins can read event hall bookings" on public.event_hall_bookings;
drop policy if exists "Admins can update event hall bookings" on public.event_hall_bookings;
drop policy if exists "Event admins can read event hall bookings" on public.event_hall_bookings;
create policy "Event admins can read event hall bookings"
on public.event_hall_bookings for select
to authenticated
using (public.is_harla_event_admin());

drop policy if exists "Event admins can update event hall bookings" on public.event_hall_bookings;
create policy "Event admins can update event hall bookings"
on public.event_hall_bookings for update
to authenticated
using (public.is_harla_event_admin())
with check (public.is_harla_event_admin());

revoke all on public.event_hall_bookings from anon, authenticated;
grant select, update on public.event_hall_bookings to authenticated;

drop policy if exists "Public can view active event halls" on public.event_halls;
create policy "Public can view active event halls"
on public.event_halls for select
to anon, authenticated
using (is_active = true or public.is_harla_event_admin());

drop policy if exists "Admins can manage event halls" on public.event_halls;
drop policy if exists "Event admins can manage event halls" on public.event_halls;
create policy "Event admins can manage event halls"
on public.event_halls for all
to authenticated
using (public.is_harla_event_admin())
with check (public.is_harla_event_admin());

-- Preserve legacy inquiry rows but move their management to the Events Team.
drop policy if exists "Admins can read event requests" on public.event_requests;
drop policy if exists "Admins can update event requests" on public.event_requests;
drop policy if exists "Event admins can read event requests" on public.event_requests;
create policy "Event admins can read event requests"
on public.event_requests for select
to authenticated
using (public.is_harla_event_admin());
drop policy if exists "Event admins can update event requests" on public.event_requests;
create policy "Event admins can update event requests"
on public.event_requests for update
to authenticated
using (public.is_harla_event_admin())
with check (public.is_harla_event_admin());

-- Official confirmation PDFs remain private. Only Events Team admins can read
-- them through signed URLs. All writes continue through trusted service-role code.
drop policy if exists "Protect official event asset reads" on storage.objects;
create policy "Protect official event asset reads"
on storage.objects as restrictive for select
to anon, authenticated
using (
  bucket_id not in ('event-confirmations', 'hotel-private-assets')
  or (bucket_id = 'event-confirmations' and public.is_harla_event_admin())
);

drop policy if exists "Admins can view event confirmation PDFs" on storage.objects;
drop policy if exists "Event admins can view event confirmation PDFs" on storage.objects;
create policy "Event admins can view event confirmation PDFs"
on storage.objects for select
to authenticated
using (bucket_id = 'event-confirmations' and public.is_harla_event_admin());

-- Event payment proofs use the existing private payment-screenshots bucket, but
-- browser writes to event-hall-bookings/* are denied. The secure customer portal
-- validates its token and uploads with the server-only service role.
drop policy if exists "Public can upload event payment proofs" on storage.objects;
drop policy if exists "Block browser event payment proof inserts" on storage.objects;
create policy "Block browser event payment proof inserts"
on storage.objects as restrictive for insert
to anon, authenticated
with check (
  bucket_id <> 'payment-screenshots'
  or coalesce((storage.foldername(name))[1], '') <> 'event-hall-bookings'
);

drop policy if exists "Block browser event payment proof updates" on storage.objects;
create policy "Block browser event payment proof updates"
on storage.objects as restrictive for update
to anon, authenticated
using (
  bucket_id <> 'payment-screenshots'
  or coalesce((storage.foldername(name))[1], '') <> 'event-hall-bookings'
)
with check (
  bucket_id <> 'payment-screenshots'
  or coalesce((storage.foldername(name))[1], '') <> 'event-hall-bookings'
);

drop policy if exists "Block browser event payment proof deletes" on storage.objects;
create policy "Block browser event payment proof deletes"
on storage.objects as restrictive for delete
to anon, authenticated
using (
  bucket_id <> 'payment-screenshots'
  or coalesce((storage.foldername(name))[1], '') <> 'event-hall-bookings'
);

drop policy if exists "Restrict event payment proof reads to event admins" on storage.objects;
create policy "Restrict event payment proof reads to event admins"
on storage.objects as restrictive for select
to authenticated
using (
  bucket_id <> 'payment-screenshots'
  or coalesce((storage.foldername(name))[1], '') <> 'event-hall-bookings'
  or public.is_harla_event_admin()
);

drop policy if exists "Event admins can view event payment proofs" on storage.objects;
create policy "Event admins can view event payment proofs"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-screenshots'
  and (storage.foldername(name))[1] = 'event-hall-bookings'
  and public.is_harla_event_admin()
);

-- Add the first Events Team administrator manually after this migration:
-- insert into public.event_admin_users (user_id, email, full_name, role)
-- select id, email, 'Events Team Admin', 'event_manager'
-- from auth.users
-- where email = 'events-admin@harlahotel.com'
-- on conflict (user_id) do update set active = true, email = excluded.email;

-- Verification queries:
-- select user_id, email, full_name, role, active from public.event_admin_users;
-- select status, count(*) from public.event_hall_bookings group by status order by status;
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.event_hall_bookings'::regclass order by conname;
-- select policyname, roles, cmd, qual, with_check from pg_policies
--   where (schemaname, tablename) in (
--     ('public', 'event_admin_users'),
--     ('public', 'event_hall_bookings'),
--     ('public', 'event_requests'),
--     ('storage', 'objects')
--   ) order by schemaname, tablename, policyname;
-- select has_function_privilege('anon', 'public.create_event_hall_booking(uuid,uuid,text,text,text,text,text,text,text,date,time,time,integer,jsonb,text,text,text,text,text,text)', 'EXECUTE');
-- select has_function_privilege('service_role', 'public.next_event_hall_booking_reference()', 'EXECUTE');
-- select
--   has_table_privilege('service_role', 'public.event_admin_users', 'SELECT') as event_admin_users_select,
--   has_table_privilege('service_role', 'public.event_hall_bookings', 'SELECT') as event_bookings_select,
--   has_table_privilege('service_role', 'public.event_hall_bookings', 'INSERT') as event_bookings_insert,
--   has_table_privilege('service_role', 'public.event_hall_bookings', 'UPDATE') as event_bookings_update,
--   has_table_privilege('service_role', 'public.event_halls', 'SELECT') as event_halls_select,
--   has_table_privilege('service_role', 'public.event_requests', 'SELECT') as legacy_event_requests_select;
-- select
--   has_table_privilege('service_role', 'public.event_admin_users', 'DELETE') as event_admin_users_delete_must_be_false,
--   has_table_privilege('service_role', 'public.event_hall_bookings', 'DELETE') as event_bookings_delete_must_be_false,
--   has_table_privilege('service_role', 'public.event_halls', 'DELETE') as event_halls_delete_must_be_false,
--   has_table_privilege('service_role', 'public.event_requests', 'DELETE') as legacy_event_requests_delete_must_be_false;
