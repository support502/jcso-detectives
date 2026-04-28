-- Ops Plans: JCSO operational planning documents
-- Run in Supabase SQL Editor. Safe to run multiple times.

create table if not exists ops_plans (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references det_users(id),
  status text default 'draft' check (status in ('draft', 'submitted', 'approved')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Case identification
  case_number text,
  deconfliction text,
  case_agent text,
  operation_type text,
  city_county text,
  briefing_datetime text,
  operation_datetime text,

  -- Narrative
  background_info text,
  synopsis text,

  -- Briefing location
  briefing_address text,
  briefing_city_state text,
  briefing_zip text,
  briefing_other text,

  -- Operation location
  operation_address text,
  operation_city_state text,
  operation_zip text,
  operation_other text,

  -- Repeating sections
  suspects jsonb default '[]'::jsonb,
  residents jsonb default '[]'::jsonb,
  ci_uc_vehicles jsonb default '[]'::jsonb,
  personnel jsonb default '[]'::jsonb,

  -- UC signals
  uc_arrest_signal text,
  uc_no_response text,
  uc_full_response text,
  uc_audible text,
  uc_visual text,

  -- Communications
  comms_radios boolean default false,
  comms_channels text,
  comms_cell_phones boolean default false,
  comms_other text,

  -- Monitoring
  monitoring_callyo boolean default false,
  monitoring_1021 boolean default false,
  monitoring_active boolean default false,
  monitoring_active_channel text,

  -- Agent / CI contacts
  agent_ci_contacts jsonb default '[]'::jsonb,

  -- Arrest plan
  arrest_tbd boolean default false,
  arrest_anticipated boolean default false,
  arrest_charge text,
  arrest_not_anticipated boolean default false,
  arrest_other text,

  -- Medical
  medical_name text,
  medical_address text,
  medical_city_state text,
  medical_zip text,
  medical_phone text,

  -- Command
  captain text,
  lt_sergeant text,
  contact_numbers text,

  -- Media contacts
  media_contact_1 jsonb default '{}'::jsonb,
  media_contact_2 jsonb default '{}'::jsonb,

  -- Supervisor approval
  supervisor_signature text,
  supervisor_signed_at timestamptz,
  supervisor_rank text
);

-- Enable RLS with permissive policies (same pattern as det_submissions)
alter table ops_plans enable row level security;

create policy "Allow all reads on ops_plans"
  on ops_plans for select using (true);

create policy "Allow inserts on ops_plans"
  on ops_plans for insert with check (true);

create policy "Allow updates on ops_plans"
  on ops_plans for update using (true);

create policy "Allow deletes on ops_plans"
  on ops_plans for delete using (true);
