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
  const { error } = await supabase
    .from('overtime_requests')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
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
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  return combined
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
