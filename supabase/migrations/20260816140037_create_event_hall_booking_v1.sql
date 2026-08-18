-- Harla Hotel V1 event hall booking migration.
-- Apply after the base schema. It is additive and keeps public.event_requests intact.

create extension if not exists pgcrypto;
create extension if not exists btree_gist with schema extensions;

do $$
begin
  if to_regprocedure('public.is_harla_admin()') is null then
    raise exception 'public.is_harla_admin() is required. Run supabase/schema.sql first.';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'public.set_updated_at() is required. Run supabase/schema.sql first.';
  end if;
  if not exists (
    select 1 from storage.buckets where id = 'payment-screenshots'
  ) then
    raise exception 'The existing private payment-screenshots bucket is required. Run supabase/schema.sql first.';
  end if;
end;
$$;

create sequence if not exists public.event_hall_booking_number_seq;

create table if not exists public.event_halls (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  hall_type text not null,
  description text,
  capacity integer check (capacity is null or capacity > 0),
  price_note text,
  image_paths jsonb not null default '[]'::jsonb,
  facilities jsonb not null default '[]'::jsonb,
  features jsonb not null default '[]'::jsonb,
  seating_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_halls_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint event_halls_name_length check (length(btrim(name)) between 2 and 160),
  constraint event_halls_type_length check (length(btrim(hall_type)) between 2 and 100),
  constraint event_halls_image_paths_array check (jsonb_typeof(image_paths) = 'array'),
  constraint event_halls_facilities_array check (jsonb_typeof(facilities) = 'array'),
  constraint event_halls_features_array check (jsonb_typeof(features) = 'array')
);

create table if not exists public.event_hall_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  submission_token uuid not null unique,
  booking_source text not null default 'WEBSITE'
    check (booking_source in ('WEBSITE', 'ADMIN')),
  hall_id uuid not null references public.event_halls(id) on delete restrict,
  hall_name text not null,
  hall_type text not null,
  client_full_name text not null,
  organization text,
  email text,
  phone text not null,
  address text,
  event_type text not null,
  custom_event_type text,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  attendees integer not null check (attendees between 1 and 10000),
  refreshments_services jsonb not null default '[]'::jsonb,
  special_requests text,
  payment_method text not null default 'payment_arranged_later'
    check (payment_method in ('payment_arranged_later', 'cbe', 'telebirr', 'ebirr', 'bank_transfer')),
  payment_reference text,
  payment_screenshot_path text,
  payment_status text not null default 'not_submitted'
    check (payment_status in ('not_submitted', 'pending_payment_confirmation', 'verified', 'declined')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  decline_reason text,
  confirmation_pdf_path text,
  confirmation_pdf_generated_at timestamptz,
  confirmation_pdf_sha256 text,
  email_status text not null default 'not_requested'
    check (email_status in ('not_requested', 'pending', 'sending', 'sent', 'failed', 'not_configured', 'no_email')),
  email_attempted_at timestamptz,
  email_sent_at timestamptz,
  email_message_id text,
  email_error text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_hall_booking_reference_format check (
    booking_reference ~ '^HARLA-HALL-[0-9]{4}-[0-9]{4,}$'
  ),
  constraint event_hall_booking_client_length check (length(btrim(client_full_name)) between 2 and 160),
  constraint event_hall_booking_organization_length check (
    organization is null or length(btrim(organization)) between 1 and 180
  ),
  constraint event_hall_booking_email_length check (
    email is null or length(btrim(email)) between 3 and 254
  ),
  constraint event_hall_booking_phone_length check (length(btrim(phone)) between 7 and 40),
  constraint event_hall_booking_address_length check (
    address is null or length(btrim(address)) between 1 and 240
  ),
  constraint event_hall_booking_event_type_length check (length(btrim(event_type)) between 2 and 80),
  constraint event_hall_booking_custom_type_length check (
    custom_event_type is null or length(btrim(custom_event_type)) between 1 and 120
  ),
  constraint event_hall_booking_special_requests_length check (
    special_requests is null or length(btrim(special_requests)) between 1 and 1500
  ),
  constraint event_hall_booking_payment_reference_length check (
    payment_reference is null or length(btrim(payment_reference)) between 1 and 160
  ),
  constraint event_hall_booking_payment_path check (
    payment_screenshot_path is null or payment_screenshot_path like 'event-hall-bookings/%'
  ),
  constraint event_hall_booking_confirmation_path check (
    confirmation_pdf_path is null
    or confirmation_pdf_path = lower(booking_source) || '/' || booking_reference || '.pdf'
  ),
  constraint event_hall_booking_confirmation_sha256 check (
    confirmation_pdf_sha256 is null or confirmation_pdf_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint event_hall_booking_valid_time check (end_time > start_time),
  constraint event_hall_booking_services_array check (jsonb_typeof(refreshments_services) = 'array'),
  constraint event_hall_booking_other_type check (
    lower(event_type) <> 'other' or nullif(btrim(custom_event_type), '') is not null
  )
);

create index if not exists event_halls_active_idx
  on public.event_halls (is_active, name);
create index if not exists event_hall_bookings_event_idx
  on public.event_hall_bookings (hall_id, event_date, start_time, end_time);
create index if not exists event_hall_bookings_status_idx
  on public.event_hall_bookings (status, event_date, created_at desc);
create index if not exists event_hall_bookings_client_idx
  on public.event_hall_bookings (lower(client_full_name), created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_hall_bookings_no_overlap'
      and conrelid = 'public.event_hall_bookings'::regclass
  ) then
    alter table public.event_hall_bookings
      add constraint event_hall_bookings_no_overlap
      exclude using gist (
        hall_id with =,
        tsrange(event_date + start_time, event_date + end_time, '[)') with &&
      )
      where (status = 'confirmed');
  end if;
end;
$$;

drop trigger if exists event_halls_set_updated_at on public.event_halls;
create trigger event_halls_set_updated_at
before update on public.event_halls
for each row execute function public.set_updated_at();

drop trigger if exists event_hall_bookings_set_updated_at on public.event_hall_bookings;
create trigger event_hall_bookings_set_updated_at
before update on public.event_hall_bookings
for each row execute function public.set_updated_at();

-- These are the only two rentable event spaces already documented in the website.
-- Capacity and final pricing remain null/on request until Harla Hotel supplies them.
insert into public.event_halls (
  slug,
  name,
  hall_type,
  description,
  capacity,
  price_note,
  image_paths,
  facilities,
  features,
  seating_notes
)
values
  (
    'harla-event-hall',
    'Harla Hotel Event Hall',
    'Event Hall',
    'A flexible venue for conferences, government and corporate meetings, workshops, weddings, receptions, and private celebrations.',
    null,
    'Price confirmed after event requirements are reviewed',
    '["./assets/events/harla-event-hall.jpeg", "./assets/events/harla-event-wedding-stage.jpeg"]'::jsonb,
    '["Flexible seating", "Presentation support", "Buffet service", "Refreshment service"]'::jsonb,
    '["Corporate and government events", "Weddings and receptions", "Training and seminars", "Private celebrations"]'::jsonb,
    'Final seating arrangement and capacity are confirmed with Harla Hotel.'
  ),
  (
    'cultural-photo-lunch-room',
    'Cultural Photo & Lunch Room',
    'Cultural Event Room',
    'A spacious Harari cultural room for wedding photography, cultural photo sessions, lunch gatherings, family photos, and small private events.',
    null,
    'Price confirmed after event requirements are reviewed',
    '["./assets/events/harla-cultural-photo-lunch-room.jpeg"]'::jsonb,
    '["Harari cultural decor", "Photography setting", "Lunch gatherings", "Private group use"]'::jsonb,
    '["Wedding photography", "Cultural photo sessions", "Family meals", "Small private gatherings"]'::jsonb,
    'Final seating arrangement and capacity are confirmed with Harla Hotel.'
  )
on conflict (slug) do nothing;

alter table public.event_halls enable row level security;
alter table public.event_hall_bookings enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.event_halls to anon, authenticated;
grant insert, update, delete on public.event_halls to authenticated;
revoke all on public.event_hall_bookings from anon, authenticated;
grant select, update on public.event_hall_bookings to authenticated;
revoke all on sequence public.event_hall_booking_number_seq from anon, authenticated;

drop policy if exists "Public can view active event halls" on public.event_halls;
create policy "Public can view active event halls"
on public.event_halls for select
to anon, authenticated
using (is_active = true or public.is_harla_admin());

drop policy if exists "Admins can manage event halls" on public.event_halls;
create policy "Admins can manage event halls"
on public.event_halls for all
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

drop policy if exists "Admins can read event hall bookings" on public.event_hall_bookings;
create policy "Admins can read event hall bookings"
on public.event_hall_bookings for select
to authenticated
using (public.is_harla_admin());

drop policy if exists "Admins can update event hall bookings" on public.event_hall_bookings;
create policy "Admins can update event hall bookings"
on public.event_hall_bookings for update
to authenticated
using (public.is_harla_admin())
with check (public.is_harla_admin());

create or replace function public.create_event_hall_booking(
  p_submission_token uuid,
  p_hall_id uuid,
  p_client_full_name text,
  p_organization text,
  p_email text,
  p_phone text,
  p_address text,
  p_event_type text,
  p_custom_event_type text,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_attendees integer,
  p_refreshments_services jsonb,
  p_special_requests text,
  p_payment_method text,
  p_payment_reference text,
  p_payment_screenshot_path text,
  p_admin_status text default 'pending',
  p_admin_payment_status text default null
)
returns table (
  booking_id uuid,
  booking_reference text,
  booking_source text,
  hall_name text,
  hall_type text,
  client_full_name text,
  organization text,
  email text,
  phone text,
  event_type text,
  custom_event_type text,
  event_date date,
  start_time time,
  end_time time,
  attendees integer,
  refreshments_services jsonb,
  special_requests text,
  payment_method text,
  payment_status text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_record public.event_hall_bookings%rowtype;
  hall_record public.event_halls%rowtype;
  created_record public.event_hall_bookings%rowtype;
  caller_is_admin boolean := public.is_harla_admin();
  resolved_source text;
  resolved_status text;
  resolved_payment_status text;
  resolved_reference text;
  clean_payment_method text := lower(btrim(coalesce(p_payment_method, 'payment_arranged_later')));
begin
  if p_submission_token is null then
    raise exception using message = 'A valid submission token is required.';
  end if;

  select * into existing_record
  from public.event_hall_bookings
  where submission_token = p_submission_token;

  if found then
    return query
    select
      existing_record.id,
      existing_record.booking_reference,
      existing_record.booking_source,
      existing_record.hall_name,
      existing_record.hall_type,
      existing_record.client_full_name,
      existing_record.organization,
      existing_record.email,
      existing_record.phone,
      existing_record.event_type,
      existing_record.custom_event_type,
      existing_record.event_date,
      existing_record.start_time,
      existing_record.end_time,
      existing_record.attendees,
      existing_record.refreshments_services,
      existing_record.special_requests,
      existing_record.payment_method,
      existing_record.payment_status,
      existing_record.status,
      existing_record.created_at;
    return;
  end if;

  select * into hall_record
  from public.event_halls
  where id = p_hall_id
    and is_active = true;

  if not found then
    raise exception using message = 'The selected event hall is not available.';
  end if;

  if nullif(btrim(p_client_full_name), '') is null or length(btrim(p_client_full_name)) > 160 then
    raise exception using message = 'Please enter a valid full name.';
  end if;
  if nullif(btrim(p_phone), '') is null or length(btrim(p_phone)) > 40 then
    raise exception using message = 'Please enter a valid phone number.';
  end if;
  if nullif(btrim(p_organization), '') is not null and length(btrim(p_organization)) > 180 then
    raise exception using message = 'Organization must be 180 characters or fewer.';
  end if;
  if nullif(btrim(p_email), '') is not null and (
    length(btrim(p_email)) > 254
    or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception using message = 'Please enter a valid email address.';
  end if;
  if nullif(btrim(p_address), '') is not null and length(btrim(p_address)) > 240 then
    raise exception using message = 'Address must be 240 characters or fewer.';
  end if;
  if nullif(btrim(p_event_type), '') is null then
    raise exception using message = 'Please choose an event type.';
  end if;
  if length(btrim(p_event_type)) > 80 then
    raise exception using message = 'Event type must be 80 characters or fewer.';
  end if;
  if lower(btrim(p_event_type)) = 'other' and nullif(btrim(p_custom_event_type), '') is null then
    raise exception using message = 'Please describe the event type.';
  end if;
  if nullif(btrim(p_custom_event_type), '') is not null and length(btrim(p_custom_event_type)) > 120 then
    raise exception using message = 'Custom event type must be 120 characters or fewer.';
  end if;
  if p_event_date is null or p_event_date < current_date then
    raise exception using message = 'Please choose today or a future event date.';
  end if;
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    raise exception using message = 'End time must be later than start time.';
  end if;
  if p_attendees is null or p_attendees < 1 or p_attendees > 10000 then
    raise exception using message = 'Please enter a valid number of attendees.';
  end if;
  if hall_record.capacity is not null and p_attendees > hall_record.capacity then
    raise exception using message = 'The number of attendees exceeds this hall capacity.';
  end if;
  if p_refreshments_services is null or jsonb_typeof(p_refreshments_services) <> 'array' then
    raise exception using message = 'Refreshments and services must be a list.';
  end if;
  if nullif(btrim(p_special_requests), '') is not null and length(btrim(p_special_requests)) > 1500 then
    raise exception using message = 'Additional requests must be 1500 characters or fewer.';
  end if;
  if clean_payment_method not in ('payment_arranged_later', 'cbe', 'telebirr', 'ebirr', 'bank_transfer') then
    raise exception using message = 'Please choose a valid payment method.';
  end if;
  if p_payment_screenshot_path is not null and p_payment_screenshot_path not like
    ('event-hall-bookings/' || p_submission_token::text || '/%') then
    raise exception using message = 'The payment confirmation path is invalid.';
  end if;
  if nullif(btrim(p_payment_reference), '') is not null and length(btrim(p_payment_reference)) > 160 then
    raise exception using message = 'Payment reference must be 160 characters or fewer.';
  end if;
  if not caller_is_admin and clean_payment_method <> 'payment_arranged_later' then
    if nullif(btrim(p_payment_reference), '') is null or p_payment_screenshot_path is null then
      raise exception using message = 'Payment reference and payment confirmation are required for the selected payment method.';
    end if;
  end if;
  if exists (
    select 1
    from public.event_hall_bookings existing_booking
    where existing_booking.hall_id = hall_record.id
      and existing_booking.status = 'confirmed'
      and tsrange(
        existing_booking.event_date + existing_booking.start_time,
        existing_booking.event_date + existing_booking.end_time,
        '[)'
      ) && tsrange(p_event_date + p_start_time, p_event_date + p_end_time, '[)')
  ) then
    raise exception using
      message = 'This hall is already reserved during the selected time.',
      errcode = 'P0001';
  end if;

  resolved_source := case when caller_is_admin then 'ADMIN' else 'WEBSITE' end;
  resolved_status := case
    when caller_is_admin and lower(p_admin_status) in ('pending', 'confirmed') then lower(p_admin_status)
    else 'pending'
  end;
  resolved_payment_status := case
    when caller_is_admin and lower(coalesce(p_admin_payment_status, '')) in
      ('not_submitted', 'pending_payment_confirmation', 'verified', 'declined')
      then lower(p_admin_payment_status)
    when clean_payment_method = 'payment_arranged_later' then 'not_submitted'
    else 'pending_payment_confirmation'
  end;
  resolved_reference := 'HARLA-HALL-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.event_hall_booking_number_seq')::text, 4, '0');

  begin
    insert into public.event_hall_bookings (
      booking_reference,
      submission_token,
      booking_source,
      hall_id,
      hall_name,
      hall_type,
      client_full_name,
      organization,
      email,
      phone,
      address,
      event_type,
      custom_event_type,
      event_date,
      start_time,
      end_time,
      attendees,
      refreshments_services,
      special_requests,
      payment_method,
      payment_reference,
      payment_screenshot_path,
      payment_status,
      status,
      email_status,
      confirmed_at,
      created_by
    ) values (
      resolved_reference,
      p_submission_token,
      resolved_source,
      hall_record.id,
      hall_record.name,
      hall_record.hall_type,
      btrim(p_client_full_name),
      nullif(btrim(p_organization), ''),
      lower(nullif(btrim(p_email), '')),
      btrim(p_phone),
      nullif(btrim(p_address), ''),
      btrim(p_event_type),
      case when lower(btrim(p_event_type)) = 'other' then nullif(btrim(p_custom_event_type), '') else null end,
      p_event_date,
      p_start_time,
      p_end_time,
      p_attendees,
      p_refreshments_services,
      nullif(btrim(p_special_requests), ''),
      clean_payment_method,
      nullif(btrim(p_payment_reference), ''),
      p_payment_screenshot_path,
      resolved_payment_status,
      resolved_status,
      case when nullif(btrim(p_email), '') is null then 'no_email' else 'pending' end,
      case when resolved_status = 'confirmed' then now() else null end,
      case when caller_is_admin then auth.uid() else null end
    )
    returning * into created_record;
  exception
    when exclusion_violation then
      raise exception using
        message = 'This hall is already reserved during the selected time.',
        errcode = 'P0001';
  end;

  return query
  select
    created_record.id,
    created_record.booking_reference,
    created_record.booking_source,
    created_record.hall_name,
    created_record.hall_type,
    created_record.client_full_name,
    created_record.organization,
    created_record.email,
    created_record.phone,
    created_record.event_type,
    created_record.custom_event_type,
    created_record.event_date,
    created_record.start_time,
    created_record.end_time,
    created_record.attendees,
    created_record.refreshments_services,
    created_record.special_requests,
    created_record.payment_method,
    created_record.payment_status,
    created_record.status,
    created_record.created_at;
end;
$$;

revoke execute on function public.create_event_hall_booking(
  uuid, uuid, text, text, text, text, text, text, text, date, time, time,
  integer, jsonb, text, text, text, text, text, text
) from public;
grant execute on function public.create_event_hall_booking(
  uuid, uuid, text, text, text, text, text, text, text, date, time, time,
  integer, jsonb, text, text, text, text, text, text
) to anon, authenticated;

-- Official confirmation documents are generated, uploaded, and attached by the
-- trusted server route using SUPABASE_SERVICE_ROLE_KEY. No public attachment RPC
-- is exposed, and any legacy version is removed before this migration completes.
drop function if exists public.attach_event_hall_confirmation_pdf(uuid, uuid, text);

create or replace function public.update_event_hall_booking_status(
  p_booking_id uuid,
  p_status text,
  p_payment_status text,
  p_decline_reason text default null
)
returns public.event_hall_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_booking public.event_hall_bookings%rowtype;
  clean_status text := lower(btrim(coalesce(p_status, '')));
  clean_payment_status text := lower(btrim(coalesce(p_payment_status, '')));
begin
  if not public.is_harla_admin() then
    raise exception using message = 'Only active Harla Hotel admins can update hall bookings.';
  end if;
  if clean_status not in ('pending', 'confirmed', 'completed', 'cancelled') then
    raise exception using message = 'Choose a valid hall booking status.';
  end if;
  if clean_payment_status not in ('not_submitted', 'pending_payment_confirmation', 'verified', 'declined') then
    raise exception using message = 'Choose a valid payment status.';
  end if;

  begin
    update public.event_hall_bookings
    set status = clean_status,
        payment_status = clean_payment_status,
        decline_reason = case
          when clean_status = 'cancelled' or clean_payment_status = 'declined'
            then nullif(btrim(p_decline_reason), '')
          else null
        end,
        confirmed_at = case when clean_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
        completed_at = case when clean_status = 'completed' then now() else null end,
        cancelled_at = case when clean_status = 'cancelled' then now() else null end,
        updated_at = now()
    where id = p_booking_id
    returning * into updated_booking;
  exception
    when exclusion_violation then
      raise exception using
        message = 'This hall is already reserved during the selected time.',
        errcode = 'P0001';
  end;

  if updated_booking.id is null then
    raise exception using message = 'Event hall booking was not found.';
  end if;
  return updated_booking;
end;
$$;

revoke execute on function public.update_event_hall_booking_status(uuid, text, text, text) from public, anon;
grant execute on function public.update_event_hall_booking_status(uuid, text, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-confirmations',
  'event-confirmations',
  false,
  5242880,
  array['application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The official stamp is kept in a separate private bucket with no browser
-- policies. Upload the real stamp through the Supabase dashboard and configure
-- HARLA_EVENT_STAMP_PATH on the trusted server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hotel-private-assets',
  'hotel-private-assets',
  false,
  1048576,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Remove every legacy browser upload policy for official confirmations. The
-- service-role server route bypasses RLS and is the only writer to this bucket.
drop policy if exists "Public can upload event confirmation PDFs" on storage.objects;
drop policy if exists "Public can view event confirmation PDFs" on storage.objects;
drop policy if exists "Public can update event confirmation PDFs" on storage.objects;
drop policy if exists "Public can delete event confirmation PDFs" on storage.objects;
drop policy if exists "Admins can upload event confirmation PDFs" on storage.objects;
drop policy if exists "Admins can update event confirmation PDFs" on storage.objects;
drop policy if exists "Admins can delete event confirmation PDFs" on storage.objects;
drop policy if exists "Protect official event asset reads" on storage.objects;
drop policy if exists "Block browser inserts into official event assets" on storage.objects;
drop policy if exists "Block browser updates to official event assets" on storage.objects;
drop policy if exists "Block browser deletes from official event assets" on storage.objects;

-- These restrictive policies are deny guards. They prevent any broad Storage
-- policy elsewhere in the project from accidentally granting browser access to
-- an official confirmation or the private stamp. Service-role requests bypass
-- RLS and remain the only way to write either bucket.
create policy "Protect official event asset reads"
on storage.objects as restrictive for select
to anon, authenticated
using (
  bucket_id not in ('event-confirmations', 'hotel-private-assets')
  or (bucket_id = 'event-confirmations' and public.is_harla_admin())
);

create policy "Block browser inserts into official event assets"
on storage.objects as restrictive for insert
to anon, authenticated
with check (bucket_id not in ('event-confirmations', 'hotel-private-assets'));

create policy "Block browser updates to official event assets"
on storage.objects as restrictive for update
to anon, authenticated
using (bucket_id not in ('event-confirmations', 'hotel-private-assets'))
with check (bucket_id not in ('event-confirmations', 'hotel-private-assets'));

create policy "Block browser deletes from official event assets"
on storage.objects as restrictive for delete
to anon, authenticated
using (bucket_id not in ('event-confirmations', 'hotel-private-assets'));

drop policy if exists "Admins can view event confirmation PDFs" on storage.objects;
create policy "Admins can view event confirmation PDFs"
on storage.objects for select
to authenticated
using (bucket_id = 'event-confirmations' and public.is_harla_admin());

drop policy if exists "Public can upload event payment proofs" on storage.objects;
create policy "Public can upload event payment proofs"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'payment-screenshots'
  and (storage.foldername(name))[1] = 'event-hall-bookings'
);

grant insert on storage.objects to anon, authenticated;
grant select on storage.objects to authenticated;

-- Verification queries (safe to run after the migration):
-- select slug, name, hall_type, capacity, price_note, is_active from public.event_halls order by name;
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'event_hall_bookings' order by ordinal_position;
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.event_hall_bookings'::regclass;
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets
--   where id in ('payment-screenshots', 'event-confirmations', 'hotel-private-assets');
-- select routine_name from information_schema.routines
--   where routine_schema = 'public' and routine_name like '%event_hall%';
-- select schemaname, tablename, policyname, roles, cmd
--   from pg_policies
--   where (schemaname, tablename) in (('public', 'event_halls'), ('public', 'event_hall_bookings'))
--      or (schemaname, tablename) = ('storage', 'objects')
--   order by schemaname, tablename, policyname;
-- select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('event_halls', 'event_hall_bookings')
--     and grantee in ('anon', 'authenticated')
--   order by table_name, grantee, privilege_type;
-- This must return the restrictive browser guards plus the authenticated admin
-- SELECT policy. No permissive INSERT, UPDATE, or DELETE policy may reference
-- event-confirmations or hotel-private-assets:
-- select policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'storage'
--     and tablename = 'objects'
--     and (coalesce(qual, '') || coalesce(with_check, '')) ~
--       '(event-confirmations|hotel-private-assets)'
--   order by policyname;
