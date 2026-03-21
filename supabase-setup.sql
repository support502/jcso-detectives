-- ============================================================
-- JCSO Detective Activity Tracker — Supabase Setup
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Create the det_users table
create table if not exists det_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null check (unit in ('UC', 'Uniform', 'Interdiction', 'Supervisor')),
  pin text not null default '1234',
  role text not null check (role in ('detective', 'supervisor'))
);

-- 2. Create the det_submissions table
create table if not exists det_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references det_users(id) on delete cascade,
  user_name text not null,
  unit text not null,
  week_start date not null,
  week_number int not null,
  month int not null,
  year int not null,
  case_numbers text,
  notes text,
  submitted_at timestamp with time zone default now(),
  stats jsonb not null default '{}'::jsonb
);

-- 3. Seed det_users with the full roster
insert into det_users (name, unit, pin, role) values
  ('Colton Lowe',     'UC',           '1234', 'detective'),
  ('Layne Verdine',   'UC',           '1234', 'detective'),
  ('Ryan Golmon',     'UC',           '1234', 'detective'),
  ('Matthew Flowers', 'UC',           '1234', 'detective'),
  ('Brian Chowns',    'Uniform',      '1234', 'detective'),
  ('Scott Weaver',    'Uniform',      '1234', 'detective'),
  ('Tamara Spikes',   'Uniform',      '1234', 'detective'),
  ('William Crain',   'Uniform',      '1234', 'detective'),
  ('Jake Droddy',     'Interdiction', '1234', 'detective'),
  ('Brigitte Morse',  'Interdiction', '1234', 'detective'),
  ('Caleb Mitchell',  'Supervisor',   '1234', 'supervisor'),
  ('Ryan Hargrove',   'Supervisor',   '1234', 'supervisor');

-- 4. Enable Row Level Security (RLS) and allow all operations for anon key
-- This keeps things simple for an internal app. Tighten later if needed.
alter table det_users enable row level security;
alter table det_submissions enable row level security;

create policy "Allow all reads on det_users"
  on det_users for select using (true);

create policy "Allow all reads on det_submissions"
  on det_submissions for select using (true);

create policy "Allow inserts on det_submissions"
  on det_submissions for insert with check (true);

create policy "Allow updates on det_submissions"
  on det_submissions for update using (true);

create policy "Allow deletes on det_submissions"
  on det_submissions for delete using (true);
