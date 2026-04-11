-- Phase 6b: Add archived_at column to time_off_requests and overtime_requests
-- Run in Supabase SQL Editor. Safe to run multiple times (uses IF NOT EXISTS logic).

alter table time_off_requests
  add column if not exists archived_at timestamptz default null;

alter table overtime_requests
  add column if not exists archived_at timestamptz default null;
