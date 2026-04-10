import { createClient } from '@supabase/supabase-js'

/* ─── Supabase client ─── */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/* ─── Date helpers ─── */

// Get the Sunday that starts the week containing `dateStr` (YYYY-MM-DD)
export function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0 = Sunday
  d.setDate(d.getDate() - day)
  return d.toISOString().split('T')[0]
}

// Get all 7 dates (Sun–Sat) for a week starting on `sundayStr`
export function getWeekDates(sundayStr) {
  const dates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sundayStr + 'T00:00:00')
    d.setDate(d.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

// Format YYYY-MM-DD as "Mon 3/20"
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${DAY_ABBR[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`
}

// Format YYYY-MM-DD as "March 20, 2026"
export function formatDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Today as YYYY-MM-DD in local time
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ─── Auth helpers ─── */

export async function fetchUsers() {
  const { data, error } = await supabase
    .from('det_users')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export async function loginUser(userId, pin) {
  const { data, error } = await supabase
    .from('det_users')
    .select('*')
    .eq('id', userId)
    .eq('pin', pin)
    .single()
  if (error) return null
  return data
}

/* ─── Entry CRUD ─── */

// Fetch a single entry for a user on a specific date
export async function fetchEntry(userId, entryDate) {
  const { data, error } = await supabase
    .from('det_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('entry_date', entryDate)
    .maybeSingle()
  if (error) throw error
  return data
}

// Upsert (insert or update) a daily entry
export async function upsertEntry(entry) {
  const { data, error } = await supabase
    .from('det_entries')
    .upsert(entry, { onConflict: 'user_id,entry_date' })
    .select()
    .single()
  if (error) throw error
  return data
}

// Fetch entries for a user within a date range
export async function fetchEntriesRange(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('det_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('entry_date', startDate)
    .lte('entry_date', endDate)
    .order('entry_date')
  if (error) throw error
  return data
}

// Fetch all entries for a user (for history)
export async function fetchUserEntries(userId) {
  const { data, error } = await supabase
    .from('det_entries')
    .select('*')
    .eq('user_id', userId)
    .order('entry_date', { ascending: false })
  if (error) throw error
  return data
}

// Fetch all entries (for supervisor dashboard) with optional filters
export async function fetchAllEntries(filters = {}) {
  let query = supabase
    .from('det_entries')
    .select('*')
    .order('entry_date', { ascending: false })

  if (filters.unit) query = query.eq('unit', filters.unit)
  if (filters.user_id) query = query.eq('user_id', filters.user_id)
  if (filters.month) query = query.eq('month', filters.month)
  if (filters.year) query = query.eq('year', filters.year)

  const { data, error } = await query
  if (error) throw error
  return data
}

/* ─── Pay period helper ─── */

// Compute the Sunday that starts the 14-day pay period for a given date,
// anchored to the 2026-01-04 cadence used by PAY_PERIODS in App.jsx.
export function getPayPeriodStart(dateStr) {
  const anchor = new Date('2026-01-04T00:00:00')
  const d = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.floor((d - anchor) / (1000 * 60 * 60 * 24))
  const periodIndex = Math.floor(diffDays / 14)
  const start = new Date(anchor)
  start.setDate(start.getDate() + periodIndex * 14)
  return start.toISOString().split('T')[0]
}

/* ─── Auto-flow / rollback helpers (Phase 5d) ─── */

const TIME_OFF_CODE_MAP = { vacation: 'VT', sick: 'ST', personal: 'PL', comp: 'CT' }
const OT_CODE_MAP = { payment: 'SO', comp: 'CC' }

// Append a code_rows entry to a single timesheet_entries row (upsert)
async function autoFlowToTimesheet(userId, dateStr, code, hours, sourceRequestId) {
  const ppStart = getPayPeriodStart(dateStr)
  const newEntry = { code, hours, source_request_id: sourceRequestId }

  const { data: existing } = await supabase
    .from('timesheet_entries')
    .select('id, code_rows, reg_hours')
    .eq('user_id', userId)
    .eq('pay_period_start', ppStart)
    .eq('day_date', dateStr)
    .maybeSingle()

  if (existing) {
    const updatedCodeRows = [...(existing.code_rows || []), newEntry]
    await supabase
      .from('timesheet_entries')
      .update({ code_rows: updatedCodeRows })
      .eq('id', existing.id)
  } else {
    await supabase
      .from('timesheet_entries')
      .insert({
        user_id: userId,
        pay_period_start: ppStart,
        day_date: dateStr,
        reg_hours: 0,
        ot_hours: 0,
        code_rows: [newEntry],
        auto_populated: false,
      })
  }
}

// Remove all code_rows entries with a given source_request_id from timesheet_entries
async function rollbackTimesheetEntries(requestId) {
  const { data: rows } = await supabase
    .from('timesheet_entries')
    .select('id, code_rows, reg_hours')
    .contains('code_rows', [{ source_request_id: requestId }])

  for (const row of (rows || [])) {
    const filtered = (row.code_rows || []).filter(cr => cr.source_request_id !== requestId)
    if (filtered.length === 0 && (!row.reg_hours || Number(row.reg_hours) === 0)) {
      await supabase.from('timesheet_entries').delete().eq('id', row.id)
    } else {
      await supabase.from('timesheet_entries').update({ code_rows: filtered }).eq('id', row.id)
    }
  }
}

/* ─── Time Off Requests ─── */

export async function fetchTimeOffRequestsForUser(userId) {
  const { data, error } = await supabase
    .from('time_off_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createTimeOffRequest(payload) {
  const { data, error } = await supabase
    .from('time_off_requests')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTimeOffRequest(id, payload) {
  const { data, error } = await supabase
    .from('time_off_requests')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTimeOffRequest(id) {
  // Check if request was approved — if so, rollback timesheet entries
  const { data: request } = await supabase
    .from('time_off_requests')
    .select('status')
    .eq('id', id)
    .single()
  if (request?.status === 'approved') {
    await rollbackTimesheetEntries(id)
  }

  const { error } = await supabase
    .from('time_off_requests')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/* ─── Overtime Requests ─── */

export async function fetchOvertimeRequestsForUser(userId) {
  const { data, error } = await supabase
    .from('overtime_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createOvertimeRequest(payload) {
  const { data, error } = await supabase
    .from('overtime_requests')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateOvertimeRequest(id, payload) {
  const { data, error } = await supabase
    .from('overtime_requests')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteOvertimeRequest(id) {
  // Check if request was approved — if so, rollback timesheet entries
  const { data: request } = await supabase
    .from('overtime_requests')
    .select('status')
    .eq('id', id)
    .single()
  if (request?.status === 'approved') {
    await rollbackTimesheetEntries(id)
  }

  const { error } = await supabase
    .from('overtime_requests')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/* ─── Other Leave (Payroll banner) ─── */

// Fetch approved time_off_requests where type='other' and any date_picked
// falls within the given pay period range [periodStart .. periodEnd].
export async function fetchOtherLeaveForPeriod(periodStart, periodEnd) {
  const { data, error } = await supabase
    .from('time_off_requests')
    .select('*')
    .eq('type', 'other')
    .eq('status', 'approved')
    .eq('deleted', false)

  if (error) throw error

  // Filter client-side: keep requests where at least one dates_picked entry
  // falls within the pay period
  return (data || []).filter(r =>
    (r.dates_picked || []).some(d => d >= periodStart && d <= periodEnd)
  )
}

/* ─── Signature ─── */

// Update the signature PNG (full data URL) for a user
export async function updateUserSignature(userId, signaturePng) {
  const { data, error } = await supabase
    .from('det_users')
    .update({ signature_png: signaturePng })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Fetch entries for a specific month/year, or all months in a year if month is null
export async function fetchMonthEntries(month, year) {
  let query = supabase
    .from('det_entries')
    .select('*')
    .eq('year', year)
    .order('entry_date')
  if (month) query = query.eq('month', month)
  const { data, error } = await query
  if (error) throw error
  return data
}

/* ─── Pending Requests (Supervisor approval queue) ─── */

export async function fetchPendingRequests() {
  const [timeOffRes, otRes] = await Promise.all([
    supabase
      .from('time_off_requests')
      .select('*')
      .eq('status', 'pending')
      .eq('deleted', false)
      .order('created_at', { ascending: true }),
    supabase
      .from('overtime_requests')
      .select('*')
      .eq('status', 'pending')
      .eq('deleted', false)
      .order('created_at', { ascending: true }),
  ])
  if (timeOffRes.error) throw timeOffRes.error
  if (otRes.error) throw otRes.error

  // Collect unique user_ids and fetch submitter info
  const userIds = [...new Set([
    ...timeOffRes.data.map(r => r.user_id),
    ...otRes.data.map(r => r.user_id),
  ])]

  let usersMap = {}
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('det_users')
      .select('id, name, role, is_captain')
      .in('id', userIds)
    if (usersError) throw usersError
    for (const u of users) usersMap[u.id] = u
  }

  const combined = [
    ...timeOffRes.data.map(r => ({ ...r, _type: 'timeoff', submitter: usersMap[r.user_id] || null })),
    ...otRes.data.map(r => ({ ...r, _type: 'ot', submitter: usersMap[r.user_id] || null })),
  ]
    .filter(r => r.submitter?.is_captain !== true)   // captain slips not approved in-app
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  return combined
}

export async function fetchPendingCount() {
  const { data: nonCaptains, error: ncErr } = await supabase
    .from('det_users')
    .select('id')
    .not('is_captain', 'eq', true)
  if (ncErr) throw ncErr
  const ids = nonCaptains.map(u => u.id)
  if (ids.length === 0) return 0
  const [toRes, otRes] = await Promise.all([
    supabase.from('time_off_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending').eq('deleted', false).in('user_id', ids),
    supabase.from('overtime_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending').eq('deleted', false).in('user_id', ids),
  ])
  return (toRes.count || 0) + (otRes.count || 0)
}

export async function approveTimeOffRequest(requestId, supervisorUserId) {
  const { data, error } = await supabase
    .from('time_off_requests')
    .update({
      status: 'approved',
      supervisor_signed_at: new Date().toISOString(),
      supervisor_user_id: supervisorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error

  // Auto-flow to timesheet (skip 'other' type)
  const code = TIME_OFF_CODE_MAP[data.type?.toLowerCase()]
  if (code && data.dates_picked?.length > 0) {
    const hoursPerDay = data.hours / data.dates_picked.length
    for (const dateStr of data.dates_picked) {
      await autoFlowToTimesheet(data.user_id, dateStr, code, hoursPerDay, data.id)
    }
  }

  return data
}

export async function approveOvertimeRequest(requestId, { staffOfficerUserId, deptHeadUserId }) {
  const payload = {
    status: 'approved',
    updated_at: new Date().toISOString(),
  }
  if (staffOfficerUserId) {
    payload.staff_officer_signed_at = new Date().toISOString()
    payload.staff_officer_user_id = staffOfficerUserId
  }
  if (deptHeadUserId) {
    payload.dept_head_signed_at = new Date().toISOString()
    payload.dept_head_user_id = deptHeadUserId
  }
  const { data, error } = await supabase
    .from('overtime_requests')
    .update(payload)
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error

  // Auto-flow to timesheet
  const code = OT_CODE_MAP[data.payment_or_comp?.toLowerCase()]
  if (code && data.date_worked) {
    await autoFlowToTimesheet(data.user_id, data.date_worked, code, Number(data.hours_worked) || 0, data.id)
  }

  return data
}

export async function denyTimeOffRequest(requestId, reason) {
  const { data, error } = await supabase
    .from('time_off_requests')
    .update({
      status: 'denied',
      deny_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function denyOvertimeRequest(requestId, reason) {
  const { data, error } = await supabase
    .from('overtime_requests')
    .update({
      status: 'denied',
      deny_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error
  return data
}
