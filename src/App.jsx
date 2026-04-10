import { useState, useEffect, useMemo, useRef } from 'react'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import {
  supabase, getWeekStart, getWeekDates, formatDate, formatDateLong,
  todayStr, fetchUsers, loginUser, fetchEntry, upsertEntry,
  fetchUserEntries, fetchAllEntries, fetchMonthEntries, fetchEntriesRange,
  updateUserSignature,
  fetchTimeOffRequestsForUser, createTimeOffRequest, updateTimeOffRequest, deleteTimeOffRequest,
  fetchOvertimeRequestsForUser, createOvertimeRequest, updateOvertimeRequest, deleteOvertimeRequest,
  fetchPendingRequests, fetchPendingCount,
  approveTimeOffRequest, approveOvertimeRequest,
  denyTimeOffRequest, denyOvertimeRequest,
  fetchOtherLeaveForPeriod,
} from './supabase'

/* ═══════════════════════════════════════════════════════════════════
   1. CONSTANTS — unit field definitions and detective roster
   ═══════════════════════════════════════════════════════════════════ */

const UC_FIELDS = [
  { key: 'hours_worked', label: 'Hours Worked' },
  { key: 'attempted_operations', label: 'Attempted Operations' },
  { key: 'uc_ci_cases', label: 'UC/CI Cases' },
  { key: 'tno_cases', label: 'TNO Cases' },
  { key: 'sw_cases', label: 'SW Cases' },
  { key: 'surv_hours', label: 'Surv Hours' },
  { key: 'patrol_jail_cases', label: 'Patrol/Jail Cases' },
  { key: 'pc_arrests', label: 'PC Arrests' },
  { key: 'warrant_arrests', label: 'Warrant Arrests' },
  { key: 'training_hours', label: 'Training Hours' },
  { key: 'detective_agency_assist', label: 'Detective/Agency Assist' },
]

const UNIFORM_FIELDS = [
  { key: 'hours_worked', label: 'Hours Worked' },
  { key: 'time_off', label: 'Time Off' },
  { key: 'k9_deploy', label: 'K9 Deploy' },
  { key: 'training_hours', label: 'Training Hours' },
  { key: 'surv_hours', label: 'Surv Hours' },
  { key: 'directed_cases', label: 'Directed Cases' },
  { key: 'self_made_cases', label: 'Self-Made' },
  { key: 'traffic_stops', label: 'Traffic Stops' },
  { key: 'warrant_arrests', label: 'Warrant Arrests' },
  { key: 'vehicle_searches', label: 'Veh. Search' },
  { key: 'supp_reports', label: 'Supp Reports' },
]

const DRUG_FIELDS = [
  { key: 'meth_g', label: 'Meth (g)' },
  { key: 'cocaine_g', label: 'Cocaine (g)' },
  { key: 'heroin_g', label: 'Heroin (g)' },
  { key: 'fentanyl_g', label: 'Fentanyl (g)' },
  { key: 'marijuana_oz', label: 'Marijuana (oz)' },
  { key: 'promethazine_codeine_oz', label: 'Promethazine/Codeine (oz)' },
  { key: 'rx_pills', label: 'RX Pills (#)' },
]

const INTERDICTION_FIELDS = [
  { key: 'hours_worked', label: 'Hours Worked' },
  { key: 'drug_seizures', label: 'Drug Seizures' },
  { key: 'criminal_seizures', label: 'Criminal Seizures' },
  { key: 'currency_seizures', label: 'Currency Seizures' },
  { key: 'training_hours', label: 'Training Hours' },
  { key: 'vehicle_searches', label: 'Vehicle Searches' },
  { key: 'assist_narc_ops', label: 'Assist Narc-Ops' },
  { key: 'traffic_stops', label: 'Traffic Stops' },
  { key: 'warrant_arrests', label: 'Warrant Arrests' },
  { key: 'pc_arrests', label: 'PC Arrests' },
  { key: 'agency_assist', label: 'Agency Assist' },
]

// Map unit name → field definitions
const UNIT_FIELDS = {
  UC: UC_FIELDS,
  Uniform: UNIFORM_FIELDS,
  Interdiction: INTERDICTION_FIELDS,
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/* ═══════════════════════════════════════════════════════════════════
   2. HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════════════ */

// Sum stats objects across an array of entries
function sumStats(entries, fields) {
  const totals = {}
  for (const f of fields) totals[f.key] = 0
  for (const e of entries) {
    if (!e.stats) continue
    for (const f of fields) {
      totals[f.key] += Number(e.stats[f.key]) || 0
    }
  }
  return totals
}

// Build an empty stats object for a unit
function emptyStats(unit) {
  const stats = {}
  for (const f of UNIT_FIELDS[unit]) stats[f.key] = ''
  // All units get drug seizure fields in their own section
  for (const f of DRUG_FIELDS) stats[f.key] = ''
  return stats
}


/* ═══════════════════════════════════════════════════════════════════
   3. STYLES
   ═══════════════════════════════════════════════════════════════════ */

const s = {
  // Colors
  navy: '#0f1e3c',
  amber: '#f59e0b',
  amberLight: '#fef3c7',
  amberHover: '#d97706',
  bg: '#f1f5f9',
  white: '#ffffff',
  gray100: '#f8fafc',
  gray200: '#e2e8f0',
  gray300: '#cbd5e1',
  gray500: '#64748b',
  gray700: '#334155',
  gray900: '#0f172a',
  red: '#ef4444',
  green: '#22c55e',

  // Layout
  font: "'DM Sans', sans-serif",
  radius: 8,
  shadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
  shadowLg: '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',
}

const card = {
  background: s.white,
  borderRadius: s.radius,
  boxShadow: s.shadow,
  padding: 24,
  marginBottom: 16,
}

const btn = {
  padding: '10px 20px',
  borderRadius: s.radius,
  border: 'none',
  fontFamily: s.font,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.15s',
}

const btnPrimary = {
  ...btn,
  background: s.amber,
  color: s.navy,
}

const btnSecondary = {
  ...btn,
  background: s.gray200,
  color: s.gray700,
}

const btnNav = (active) => ({
  ...btn,
  background: active ? s.amber : 'transparent',
  color: active ? s.navy : s.white,
  padding: '8px 16px',
  fontSize: 13,
})

const input = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: s.radius,
  border: `1px solid ${s.gray300}`,
  fontFamily: s.font,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

const label = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: s.gray500,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const th = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: s.gray500,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: `2px solid ${s.gray200}`,
  whiteSpace: 'nowrap',
}

const td = {
  padding: '10px 12px',
  fontSize: 14,
  borderBottom: `1px solid ${s.gray100}`,
  whiteSpace: 'nowrap',
}

// Inject keyframe CSS for the pending-requests tab pulse animation
;(() => {
  if (typeof document === 'undefined') return
  const id = 'jcso-pulse-kf'
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = '@keyframes jcsoPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.45)}60%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}.jcso-pulse{animation:jcsoPulse 1.5s ease-out 3}'
  document.head.appendChild(el)
})()

/* ═══════════════════════════════════════════════════════════════════
   4. LOGIN SCREEN
   ═══════════════════════════════════════════════════════════════════ */

function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchUsers().then(u => {
      setUsers(u)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!selectedId || !pin) { setError('Select your name and enter your PIN.'); return }
    const user = await loginUser(selectedId, pin)
    if (!user) { setError('Invalid PIN. Try again.'); return }
    onLogin(user)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80, fontFamily: s.font }}>Loading...</div>

  return (
    <div style={{ minHeight: '100vh', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: s.font }}>
      <div style={{ ...card, width: 380, maxWidth: '90vw', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>🔍</div>
        <h1 style={{ fontSize: 22, color: s.navy, margin: '0 0 4px' }}>JCSO Detective MicroManager</h1>
        <p style={{ color: s.gray500, fontSize: 14, margin: '0 0 24px' }}>Sign in to continue</p>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16, textAlign: 'left' }}>
            <label style={label}>Name</label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              style={{ ...input, cursor: 'pointer' }}
            >
              <option value="">Select your name...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} — {u.unit || u.role}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 20, textAlign: 'left' }}>
            <label style={label}>PIN</label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="Enter PIN"
              style={input}
              maxLength={10}
            />
          </div>

          {error && <p style={{ color: s.red, fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

          <button type="submit" style={{ ...btnPrimary, width: '100%' }}>Sign In</button>
        </form>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   5. ENTRY FORM — daily entry for a detective
   ═══════════════════════════════════════════════════════════════════ */

function EntryForm({ user }) {
  const fields = UNIT_FIELDS[user.unit]
  const today = todayStr()

  // Week navigation — start on the current week's Sunday
  const [weekStart, setWeekStart] = useState(getWeekStart(today))
  // Day tab — default to today's index (0=Sun … 6=Sat)
  const [dayIndex, setDayIndex] = useState(new Date(today + 'T00:00:00').getDay())

  // The actual selected date is derived from weekStart + dayIndex
  const weekDates = getWeekDates(weekStart)
  const selectedDate = weekDates[dayIndex]

  const [stats, setStats] = useState(emptyStats(user.unit))
  const [caseNumbers, setCaseNumbers] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [existingId, setExistingId] = useState(null)

  // Load existing entry whenever selected date changes
  useEffect(() => {
    let cancelled = false
    setMessage('')
    fetchEntry(user.id, selectedDate).then(entry => {
      if (cancelled) return
      if (entry) {
        setStats(entry.stats || emptyStats(user.unit))
        setCaseNumbers(entry.case_numbers || '')
        setNotes(entry.notes || '')
        setExistingId(entry.id)
      } else {
        setStats(emptyStats(user.unit))
        setCaseNumbers('')
        setNotes('')
        setExistingId(null)
      }
    })
    return () => { cancelled = true }
  }, [selectedDate, user.id, user.unit])

  function shiftWeek(delta) {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(d.toISOString().split('T')[0])
  }

  // When navigating to a different week, keep dayIndex but don't force today
  function goToToday() {
    setWeekStart(getWeekStart(today))
    setDayIndex(new Date(today + 'T00:00:00').getDay())
  }

  function updateStat(key, value) {
    setStats(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    try {
      const d = new Date(selectedDate + 'T00:00:00')
      const entry = {
        user_id: user.id,
        user_name: user.name,
        unit: user.unit,
        entry_date: selectedDate,
        week_start: weekStart,
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        stats,
        case_numbers: caseNumbers,
        notes,
        submitted_at: new Date().toISOString(),
      }
      await upsertEntry(entry)
      setMessage('Saved!')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage('Error: ' + err.message)
    }
    setSaving(false)
  }

  async function handleExportMyWeekly() {
    setExporting(true)
    try {
      const weekEntries = await fetchEntriesRange(user.id, weekStart, weekDates[6])
      const payload = {
        unit: user.unit,
        detective_name: user.name,
        week_start: weekStart,
        entries: weekEntries.map(e => ({
          entry_date: e.entry_date,
          stats: e.stats || {},
          notes: e.notes || '',
          case_numbers: e.case_numbers || '',
        })),
      }
      const res = await fetch('/api/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const blob = await res.blob()
      const lastName = user.name.split(' ').pop()
      const fileName = `${lastName}Week${weekStart.replace(/-/g, '')}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
    setExporting(false)
  }

  // Short day labels for tabs
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // End of week date string for the header
  const weekEndStr = weekDates[6]
  const isCurrentWeek = weekStart === getWeekStart(today)

  return (
    <div>
      {/* ── Week navigator ── */}
      <div style={{ ...card, padding: '16px 20px' }}>
        {/* Week label + prev/next arrows */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => shiftWeek(-1)} style={{ ...btnSecondary, padding: '6px 14px' }}>←</button>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15, color: s.navy, minWidth: 200 }}>
            {formatDateLong(weekStart)} – {formatDateLong(weekEndStr)}
          </span>
          <button onClick={() => shiftWeek(1)} style={{ ...btnSecondary, padding: '6px 14px' }}>→</button>
          {!isCurrentWeek && (
            <button onClick={goToToday} style={{ ...btnPrimary, padding: '6px 14px', fontSize: 13 }}>
              Today
            </button>
          )}
          <button onClick={handleExportMyWeekly} disabled={exporting} style={{ ...btnPrimary, padding: '6px 14px', fontSize: 13 }}>
            {exporting ? 'Exporting...' : 'Export Weekly'}
          </button>
        </div>

        {/* Day tabs — 7 buttons across, scrollable on small screens */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {DAY_SHORT.map((name, i) => {
            const date = weekDates[i]
            const isToday = date === today
            const isActive = i === dayIndex
            return (
              <button
                key={i}
                onClick={() => setDayIndex(i)}
                style={{
                  flex: '1 0 auto',
                  minWidth: 48,
                  padding: '8px 4px',
                  borderRadius: s.radius,
                  border: isToday ? `2px solid ${s.amber}` : '2px solid transparent',
                  background: isActive ? s.amber : s.gray100,
                  color: isActive ? s.navy : s.gray700,
                  fontFamily: s.font,
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'center',
                  lineHeight: 1.3,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <div>{name}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>{date.slice(5)}</div>
              </button>
            )
          })}
        </div>

        {/* Current day label */}
        <p style={{ margin: '10px 0 0', fontSize: 13, color: s.gray500 }}>
          <strong style={{ color: s.gray700 }}>{DAY_NAMES[dayIndex]}, {formatDateLong(selectedDate)}</strong>
          {' — '}
          {existingId ? 'editing existing entry' : 'new entry'}
        </p>
      </div>

      {/* Stat fields in a responsive grid */}
      <div style={card}>
        <h3 style={{ margin: '0 0 16px', color: s.navy, fontSize: 16 }}>
          {user.unit} Daily Stats
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {fields.map(f => (
            <div key={f.key}>
              <label style={label}>{f.label}</label>
              <input
                type="number"
                step="any"
                value={stats[f.key] ?? ''}
                onChange={e => updateStat(f.key, e.target.value)}
                style={input}
                placeholder="0"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Drug seizure fields — shown for all units */}
      <div style={card}>
        <h3 style={{ margin: '0 0 16px', color: s.navy, fontSize: 16 }}>
          Drug Seizures
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {DRUG_FIELDS.map(f => (
            <div key={f.key}>
              <label style={label}>{f.label}</label>
              <input
                type="number"
                step="any"
                value={stats[f.key] ?? ''}
                onChange={e => updateStat(f.key, e.target.value)}
                style={input}
                placeholder="0"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Case numbers & notes */}
      <div style={card}>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Case Numbers</label>
          <textarea
            value={caseNumbers}
            onChange={e => setCaseNumbers(e.target.value)}
            style={{ ...input, minHeight: 60, resize: 'vertical' }}
            placeholder="Enter case numbers..."
          />
        </div>
        <div>
          <label style={label}>Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ ...input, minHeight: 60, resize: 'vertical' }}
            placeholder="Any notes for today..."
          />
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={handleSave} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving...' : existingId ? 'Update Entry' : 'Save Entry'}
        </button>
        {message && (
          <span style={{ fontSize: 14, color: message.startsWith('Error') ? s.red : s.green, fontWeight: 600 }}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   6. HISTORY VIEW — past entries grouped by week
   ═══════════════════════════════════════════════════════════════════ */

function HistoryView({ user }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchUserEntries(user.id).then(data => {
      setEntries(data)
      setLoading(false)
    })
  }, [user.id])

  // Group entries by week_start
  const weeks = useMemo(() => {
    const map = {}
    for (const e of entries) {
      const ws = e.week_start
      if (!map[ws]) map[ws] = []
      map[ws].push(e)
    }
    // Sort weeks descending
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries])

  const fields = UNIT_FIELDS[user.unit]

  if (loading) return <p style={{ color: s.gray500 }}>Loading history...</p>
  if (entries.length === 0) return <p style={{ color: s.gray500 }}>No entries yet.</p>

  return (
    <div>
      {weeks.map(([weekStart, weekEntries]) => {
        const totals = sumStats(weekEntries, fields)
        const endDate = new Date(weekStart + 'T00:00:00')
        endDate.setDate(endDate.getDate() + 6)
        const endStr = endDate.toISOString().split('T')[0]

        // Local cell styles scoped to this history table
        const hTh = {
          padding: '11px 14px',
          textAlign: 'left',
          fontSize: 13,
          fontWeight: 700,
          color: s.white,
          background: s.navy,
          border: `1px solid #1e3560`,
          whiteSpace: 'nowrap',
        }
        const hTd = (rowIndex) => ({
          padding: '10px 14px',
          fontSize: 15,
          border: `1px solid ${s.gray300}`,
          whiteSpace: 'nowrap',
          background: rowIndex % 2 === 0 ? s.white : '#f0f4f8',
        })

        const sortedEntries = [...weekEntries].sort((a, b) => a.entry_date.localeCompare(b.entry_date))

        return (
          <div key={weekStart} style={{ ...card, overflow: 'auto', padding: 0 }}>
            {/* Card header */}
            <div style={{ padding: '14px 20px', borderBottom: `2px solid ${s.gray200}` }}>
              <h3 style={{ margin: 0, color: s.navy, fontSize: 16, fontWeight: 700 }}>
                Week of {formatDateLong(weekStart)} – {formatDateLong(endStr)}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: s.gray500 }}>
                {weekEntries.length} {weekEntries.length === 1 ? 'entry' : 'entries'} submitted
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...hTh, textAlign: 'left' }}>Day</th>
                    {fields.map(f => <th key={f.key} style={{ ...hTh, textAlign: 'right' }}>{f.label}</th>)}
                    <th style={{ ...hTh, textAlign: 'left' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((e, rowIndex) => (
                    <tr key={e.entry_date}>
                      <td style={{ ...hTd(rowIndex), fontWeight: 700, color: s.navy }}>
                        {formatDate(e.entry_date)}
                      </td>
                      {fields.map(f => (
                        <td key={f.key} style={{ ...hTd(rowIndex), textAlign: 'right', color: s.gray700 }}>
                          {Number(e.stats?.[f.key]) || '—'}
                        </td>
                      ))}
                      <td style={{ ...hTd(rowIndex), maxWidth: 220, whiteSpace: 'normal', fontSize: 13, color: s.gray500 }}>
                        {e.notes || '—'}
                      </td>
                    </tr>
                  ))}
                  {/* Weekly totals row */}
                  <tr>
                    <td style={{ padding: '11px 14px', fontWeight: 800, fontSize: 14, color: s.navy, background: s.amberLight, border: `1px solid ${s.amber}` }}>
                      WEEKLY TOTAL
                    </td>
                    {fields.map(f => (
                      <td key={f.key} style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: s.navy, background: s.amberLight, border: `1px solid ${s.amber}` }}>
                        {totals[f.key] || '—'}
                      </td>
                    ))}
                    <td style={{ background: s.amberLight, border: `1px solid ${s.amber}` }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   6b. TIME SLIPS — detective request submission (time off + overtime)
   ═══════════════════════════════════════════════════════════════════ */

const TIME_OFF_TYPES = ['Vacation', 'Comp Time', 'Sick Time', 'Personal Time', 'Other']

// Convert a local Date to YYYY-MM-DD without timezone shift
function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtShortDate(str) {
  if (!str) return ''
  return new Date(str + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STATUS_BADGE = {
  pending:  { background: '#fef3c7', color: '#92400e' },
  approved: { background: '#dcfce7', color: '#166534' },
  denied:   { background: '#fee2e2', color: '#991b1b' },
}

// Scrollable overlay wrapper shared by both form modals
function ModalWrap({ children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      overflowY: 'auto', zIndex: 1000,
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 16px', minHeight: '100%' }}>
        <div style={{
          background: s.white, borderRadius: s.radius * 1.5,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          width: '100%', maxWidth: 540, padding: 28,
          fontFamily: s.font, height: 'fit-content',
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function TimeOffForm({ user, onClose, onSaved, requireSignature, editRow }) {
  const [requestDate, setRequestDate] = useState(editRow?.request_date || todayStr())
  const [type, setType] = useState(editRow?.type || '')
  const [otherCode, setOtherCode] = useState(editRow?.other_code || '')
  const [hours, setHours] = useState(editRow?.hours != null ? String(editRow.hours) : '')
  const [selectedDays, setSelectedDays] = useState(
    editRow?.dates_picked?.length
      ? editRow.dates_picked.map(str => new Date(str + 'T00:00:00'))
      : []
  )
  const [datesNotes, setDatesNotes] = useState(editRow?.dates_notes || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setError('')
    if (!type) { setError('Please select a time off type.'); return }
    if (!hours || Number(hours) <= 0) { setError('Please enter a positive number of hours.'); return }
    if (selectedDays.length === 0) { setError('Please select at least one date.'); return }
    if (type === 'Other' && !otherCode.trim()) { setError('Please describe the reason for "Other".'); return }
    try { await requireSignature() } catch { return }
    setSubmitting(true)
    try {
      const payload = {
        user_id: user.id,
        request_date: requestDate,
        type,
        other_code: type === 'Other' ? otherCode.trim() : null,
        hours: Number(hours),
        dates_picked: [...selectedDays].sort((a, b) => a - b).map(toLocalDateStr),
        dates_notes: datesNotes.trim() || null,
        status: 'pending',
        person_signed_at: new Date().toISOString(),
      }
      if (editRow) {
        await updateTimeOffRequest(editRow.id, { ...payload, updated_at: new Date().toISOString() })
      } else {
        await createTimeOffRequest(payload)
      }
      onSaved()
    } catch (e) {
      setError('Failed to submit: ' + (e.message || 'Unknown error'))
      setSubmitting(false)
    }
  }

  return (
    <ModalWrap>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, color: s.navy }}>
        {editRow ? 'Edit Time Off Request' : 'Request Time Off'}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: s.gray500 }}>
        Fields marked * are required.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={label}>Date of Request</label>
        <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)}
          style={{ ...input, width: 'auto' }} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={label}>Type *</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {TIME_OFF_TYPES.map(t => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: s.gray700, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              <input type="radio" name="timeoff_type" value={t} checked={type === t} onChange={() => setType(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>

      {type === 'Other' && (
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Reason *</label>
          <input type="text" value={otherCode} onChange={e => setOtherCode(e.target.value)}
            placeholder="e.g., Bereavement - family funeral" style={input} />
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={label}>Number of Hours *</label>
        <input type="number" min="0" step="0.5" value={hours} onChange={e => setHours(e.target.value)}
          style={{ ...input, width: 120 }} placeholder="e.g., 8" />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={label}>
          Dates *{selectedDays.length > 0 && (
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: s.navy, marginLeft: 6 }}>
              ({selectedDays.length} selected)
            </span>
          )}
        </label>
        <div style={{ border: `1px solid ${s.gray200}`, borderRadius: s.radius, display: 'inline-block', padding: '4px 8px', marginTop: 4 }}>
          <DayPicker mode="multiple" selected={selectedDays} onSelect={days => setSelectedDays(days || [])} />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ ...label, textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: s.gray500 }}>
          Notes about Dates <span style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <input type="text" value={datesNotes} onChange={e => setDatesNotes(e.target.value)}
          placeholder="e.g., morning only" style={input} />
      </div>

      {error && <p style={{ margin: '0 0 12px', fontSize: 13, color: s.red }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSecondary} disabled={submitting}>Cancel</button>
        <button onClick={handleSubmit} disabled={submitting}
          style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>
          {submitting ? 'Submitting…' : 'Sign and Submit'}
        </button>
      </div>
    </ModalWrap>
  )
}

function OvertimeForm({ user, onClose, onSaved, requireSignature, editRow }) {
  const [dateWorked, setDateWorked] = useState(editRow?.date_worked || todayStr())
  const [timeWorked, setTimeWorked] = useState(editRow?.time_worked || '')
  const [regularShift, setRegularShift] = useState(editRow?.reg_shift_time || '')
  const [hoursWorked, setHoursWorked] = useState(editRow?.hours_worked != null ? String(editRow.hours_worked) : '')
  const [caseNumbers, setCaseNumbers] = useState(editRow?.case_numbers || '')
  const [purpose, setPurpose] = useState(editRow?.purpose || '')
  const [request, setRequest] = useState(editRow?.payment_or_comp || '')
  const [grade, setGrade] = useState(editRow?.grade || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setError('')
    if (!dateWorked) { setError('Date worked is required.'); return }
    if (!hoursWorked || Number(hoursWorked) <= 0) { setError('Please enter a positive number of hours worked.'); return }
    try { await requireSignature() } catch { return }
    setSubmitting(true)
    try {
      const payload = {
        user_id: user.id,
        date_worked: dateWorked,
        time_worked: timeWorked.trim() || null,
        reg_shift_time: regularShift.trim() || null,
        hours_worked: Number(hoursWorked),
        case_numbers: caseNumbers.trim() || null,
        purpose: purpose.trim() || null,
        payment_or_comp: request || null,
        grade: grade.trim() || null,
        status: 'pending',
        person_signed_at: new Date().toISOString(),
      }
      if (editRow) {
        await updateOvertimeRequest(editRow.id, { ...payload, updated_at: new Date().toISOString() })
      } else {
        await createOvertimeRequest(payload)
      }
      onSaved()
    } catch (e) {
      setError('Failed to submit: ' + (e.message || 'Unknown error'))
      setSubmitting(false)
    }
  }

  const row = { marginBottom: 16 }

  return (
    <ModalWrap>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, color: s.navy }}>
        {editRow ? 'Edit Overtime Request' : 'Submit Overtime'}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: s.gray500 }}>
        Fields marked * are required.
      </p>

      <div style={row}>
        <label style={label}>Date Worked *</label>
        <input type="date" value={dateWorked} onChange={e => setDateWorked(e.target.value)}
          style={{ ...input, width: 'auto' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={label}>Time Worked</label>
          <input type="text" value={timeWorked} onChange={e => setTimeWorked(e.target.value)}
            placeholder="e.g., 1800-0200" style={input} />
        </div>
        <div>
          <label style={label}>Regular Shift</label>
          <input type="text" value={regularShift} onChange={e => setRegularShift(e.target.value)}
            placeholder="e.g., 0800-1600" style={input} />
        </div>
      </div>

      <div style={row}>
        <label style={label}>Hours Worked *</label>
        <input type="number" min="0" step="0.5" value={hoursWorked} onChange={e => setHoursWorked(e.target.value)}
          style={{ ...input, width: 120 }} placeholder="e.g., 4" />
      </div>

      <div style={row}>
        <label style={label}>Case Number(s)</label>
        <input type="text" value={caseNumbers} onChange={e => setCaseNumbers(e.target.value)}
          placeholder="e.g., 25-1234" style={input} />
      </div>

      <div style={row}>
        <label style={label}>Purpose of Overtime</label>
        <textarea value={purpose} onChange={e => setPurpose(e.target.value)}
          placeholder="Describe the reason for this overtime…"
          style={{ ...input, height: 80, resize: 'vertical' }} />
      </div>

      <div style={row}>
        <label style={label}>Request</label>
        <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
          {['Payment', 'Comp Time'].map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: s.gray700, fontWeight: 400 }}>
              <input type="radio" name="ot_request" value={opt} checked={request === opt} onChange={() => setRequest(opt)} />
              {opt}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={label}>Grade</label>
        <input type="text" value={grade} onChange={e => setGrade(e.target.value)}
          placeholder="e.g., LE3" style={{ ...input, width: 120 }} />
      </div>

      {error && <p style={{ margin: '0 0 12px', fontSize: 13, color: s.red }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnSecondary} disabled={submitting}>Cancel</button>
        <button onClick={handleSubmit} disabled={submitting}
          style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>
          {submitting ? 'Submitting…' : 'Sign and Submit'}
        </button>
      </div>
    </ModalWrap>
  )
}

function TimeSlipsView({ user, requireSignature }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(null) // null | 'timeoff' | 'ot'
  const [editRow, setEditRow] = useState(null)

  useEffect(() => { loadRequests() }, [user.id])

  async function loadRequests() {
    setLoading(true)
    try {
      const [timeOff, ot] = await Promise.all([
        fetchTimeOffRequestsForUser(user.id),
        fetchOvertimeRequestsForUser(user.id),
      ])
      const combined = [
        ...timeOff.map(r => ({ ...r, _type: 'timeoff' })),
        ...ot.map(r => ({ ...r, _type: 'ot' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      setRequests(combined)
    } catch { /* ignore */ }
    setLoading(false)
  }

  function closeForm() { setShowForm(null); setEditRow(null) }

  async function handleDelete(row) {
    if (!confirm('Permanently delete this request?')) return
    try {
      if (row._type === 'timeoff') await deleteTimeOffRequest(row.id)
      else await deleteOvertimeRequest(row.id)
      loadRequests()
    } catch { alert('Failed to delete request. Please try again.') }
  }

  function handleEdit(row) {
    setEditRow(row)
    setShowForm(row._type === 'timeoff' ? 'timeoff' : 'ot')
  }

  return (
    <>
      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={() => { setEditRow(null); setShowForm('timeoff') }} style={btnPrimary}>
          Request Time Off
        </button>
        <button onClick={() => { setEditRow(null); setShowForm('ot') }}
          style={{ ...btnPrimary, background: s.navy, color: s.white }}>
          Submit Overtime
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ color: s.gray500, fontSize: 14, padding: 8 }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: s.gray500, padding: 40 }}>
          No requests yet. Click a button above to submit your first one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map(row => {
            const isTO = row._type === 'timeoff'
            const stStyle = STATUS_BADGE[row.status] || STATUS_BADGE.pending
            return (
              <div key={`${row._type}-${row.id}`} style={{ ...card, marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  {/* Type badge */}
                  <span style={{
                    background: isTO ? '#dbeafe' : '#ede9fe',
                    color: isTO ? '#1e40af' : '#5b21b6',
                    padding: '2px 8px', borderRadius: 4,
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    {isTO ? 'Time Off' : 'Overtime'}
                  </span>

                  {/* Status badge */}
                  <span style={{
                    ...stStyle,
                    padding: '2px 8px', borderRadius: 4,
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    {row.status}
                  </span>

                  {/* Summary */}
                  <div style={{ flex: 1, minWidth: 160 }}>
                    {isTO ? (
                      <div style={{ fontSize: 14, color: s.gray900 }}>
                        <strong>{row.type}</strong>
                        {row.type === 'Other' && row.other_code ? ` — ${row.other_code}` : ''}
                        {' · '}
                        <strong>{row.hours}</strong> {row.hours === 1 ? 'hr' : 'hrs'}
                        {row.dates_picked?.length > 0
                          ? ` · ${fmtShortDate(row.dates_picked[0])}${row.dates_picked.length > 1 ? ` +${row.dates_picked.length - 1}` : ''}`
                          : ''}
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, color: s.gray900 }}>
                        <strong>{fmtShortDate(row.date_worked)}</strong>
                        {' · '}
                        <strong>{row.hours_worked}</strong> {row.hours_worked === 1 ? 'hr' : 'hrs'}
                        {row.purpose
                          ? <span style={{ color: s.gray500 }}> · {row.purpose.length > 50 ? row.purpose.slice(0, 50) + '…' : row.purpose}</span>
                          : ''}
                      </div>
                    )}
                    {row.status === 'denied' && row.deny_reason && (
                      <div style={{ fontSize: 12, color: s.red, marginTop: 3 }}>
                        Denied: {row.deny_reason}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: s.gray500, marginTop: 3 }}>
                      Submitted {fmtDateTime(row.created_at)}
                    </div>
                  </div>

                  {/* Edit / Delete — pending rows only */}
                  {row.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <button onClick={() => handleEdit(row)}
                        style={{ ...btnSecondary, padding: '4px 12px', fontSize: 13 }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(row)}
                        style={{ ...btnSecondary, padding: '4px 12px', fontSize: 13, color: s.red }}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form modals */}
      {showForm === 'timeoff' && (
        <TimeOffForm
          user={user}
          requireSignature={requireSignature}
          editRow={editRow}
          onClose={closeForm}
          onSaved={() => { closeForm(); loadRequests() }}
        />
      )}
      {showForm === 'ot' && (
        <OvertimeForm
          user={user}
          requireSignature={requireSignature}
          editRow={editRow}
          onClose={closeForm}
          onSaved={() => { closeForm(); loadRequests() }}
        />
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   6c. PENDING REQUESTS — supervisor approval queue
   ═══════════════════════════════════════════════════════════════════ */

function PendingRequestsView({ user, requireSignature, onCountRefresh }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [approveTarget, setApproveTarget] = useState(null)
  const [denyTarget, setDenyTarget] = useState(null)
  const [denyReason, setDenyReason] = useState('')
  const [feedback, setFeedback] = useState('')
  const [processing, setProcessing] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

  useEffect(() => { loadPending() }, [])

  async function loadPending() {
    setLoading(true)
    try {
      const data = await fetchPendingRequests()
      setRequests(data)
      setSelectedIds(new Set())
    } catch { /* ignore */ }
    setLoading(false)
    onCountRefresh?.()
  }

  function showFeedback(msg) {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 3000)
  }

  // Approve a single request using role-based signature line selection
  async function approveOneRequest(row) {
    if (row._type === 'timeoff') {
      await approveTimeOffRequest(row.id, user.id)
    } else {
      // Captain signs the Department Head line; everyone else signs Staff Officer
      const staffOfficerUserId = user.is_captain ? null : user.id
      const deptHeadUserId = user.is_captain ? user.id : null
      await approveOvertimeRequest(row.id, { staffOfficerUserId, deptHeadUserId })
    }
  }

  async function handleConfirmApprove() {
    if (!approveTarget) return
    try { await requireSignature() } catch { return }
    setProcessing(true)
    try {
      await approveOneRequest(approveTarget)
      setApproveTarget(null)
      showFeedback('Approved')
      loadPending()
    } catch (e) {
      alert('Failed to approve: ' + (e.message || 'Unknown error'))
    }
    setProcessing(false)
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return
    try { await requireSignature() } catch { return }
    setProcessing(true)
    const selected = requests.filter(r => selectedIds.has(`${r._type}-${r.id}`))
    let successCount = 0
    for (const row of selected) {
      try { await approveOneRequest(row); successCount++ } catch { /* continue */ }
    }
    setProcessing(false)
    showFeedback(`Approved ${successCount} request${successCount !== 1 ? 's' : ''}`)
    loadPending()
  }

  function openDeny(row) { setDenyReason(''); setDenyTarget(row) }
  function closeDeny() { setDenyTarget(null); setDenyReason('') }

  async function handleConfirmDeny() {
    if (!denyTarget || !denyReason.trim()) return
    setProcessing(true)
    try {
      if (denyTarget._type === 'timeoff') {
        await denyTimeOffRequest(denyTarget.id, denyReason.trim())
      } else {
        await denyOvertimeRequest(denyTarget.id, denyReason.trim())
      }
      closeDeny()
      showFeedback('Denied')
      loadPending()
    } catch (e) {
      alert('Failed to deny: ' + (e.message || 'Unknown error'))
    }
    setProcessing(false)
  }

  async function handleDelete(row) {
    const msg = row.status !== 'pending'
      ? `This request has already been ${row.status}. Deleting will remove it and automatically roll back any related payroll entries. Continue?`
      : 'Permanently delete this request?'
    if (!confirm(msg)) return
    try {
      if (row._type === 'timeoff') await deleteTimeOffRequest(row.id)
      else await deleteOvertimeRequest(row.id)
      loadPending()
    } catch { alert('Failed to delete request.') }
  }

  function toggleRow(key) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // What signature line will the current user stamp on an OT request?
  const otSigLine = user.is_captain ? 'Department Head' : 'Staff Officer'

  return (
    <>
      {feedback && (
        <div style={{ ...card, background: '#dcfce7', border: '1px solid #86efac', textAlign: 'center', color: '#166534', fontWeight: 600, fontSize: 14 }}>
          {feedback}
        </div>
      )}

      {loading ? (
        <div style={{ color: s.gray500, fontSize: 14, padding: 8 }}>Loading...</div>
      ) : requests.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: s.gray500, padding: 40 }}>
          No pending requests.
        </div>
      ) : (
        <>
          {/* Bulk action bar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setSelectedIds(new Set(requests.map(r => `${r._type}-${r.id}`)))}
              style={{ ...btnSecondary, padding: '5px 14px', fontSize: 13 }}>
              Select All
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              style={{ ...btnSecondary, padding: '5px 14px', fontSize: 13 }}>
              Deselect All
            </button>
            <button
              onClick={handleBulkApprove}
              disabled={selectedIds.size === 0 || processing}
              style={{
                ...btnPrimary, padding: '5px 14px', fontSize: 13,
                opacity: (selectedIds.size === 0 || processing) ? 0.4 : 1,
                cursor: (selectedIds.size === 0 || processing) ? 'not-allowed' : 'pointer',
              }}
            >
              {processing ? 'Approving…' : `Approve Selected${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {requests.map(row => {
              const isTO = row._type === 'timeoff'
              const rowKey = `${row._type}-${row.id}`
              const isSelected = selectedIds.has(rowKey)

              return (
                <div key={rowKey} style={{
                  ...card, marginBottom: 0,
                  border: isSelected ? `2px solid ${s.amber}` : '2px solid transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    {/* Row checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(rowKey)}
                      style={{ marginTop: 3, flexShrink: 0, cursor: 'pointer' }}
                    />

                    {/* Submitter name */}
                    <div style={{ fontWeight: 700, fontSize: 15, color: s.navy, minWidth: 140 }}>
                      {row.submitter?.name || 'Unknown'}
                    </div>

                    {/* Type badge */}
                    <span style={{
                      background: isTO ? '#dbeafe' : '#ede9fe',
                      color: isTO ? '#1e40af' : '#5b21b6',
                      padding: '2px 8px', borderRadius: 4,
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>
                      {isTO ? 'Time Off' : 'Overtime'}
                    </span>

                    {/* Key fields */}
                    <div style={{ flex: 1, minWidth: 160 }}>
                      {isTO ? (
                        <div style={{ fontSize: 14, color: s.gray900 }}>
                          <strong>{row.type}</strong>
                          {row.type === 'Other' && row.other_code ? ` — ${row.other_code}` : ''}
                          {' · '}
                          <strong>{row.hours}</strong> {row.hours === 1 ? 'hr' : 'hrs'}
                          {row.dates_picked?.length > 0
                            ? ` · ${fmtShortDate(row.dates_picked[0])}${row.dates_picked.length > 1 ? ` +${row.dates_picked.length - 1}` : ''}`
                            : ''}
                          {row.dates_notes ? <span style={{ color: s.gray500 }}> · {row.dates_notes}</span> : ''}
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, color: s.gray900 }}>
                          <strong>{fmtShortDate(row.date_worked)}</strong>
                          {' · '}
                          <strong>{row.hours_worked}</strong> {row.hours_worked === 1 ? 'hr' : 'hrs'}
                          {row.purpose
                            ? <span style={{ color: s.gray500 }}> · {row.purpose.length > 50 ? row.purpose.slice(0, 50) + '…' : row.purpose}</span>
                            : ''}
                          {row.payment_or_comp
                            ? <span style={{ color: s.gray500 }}> · {row.payment_or_comp}</span>
                            : ''}
                          {row.grade
                            ? <span style={{ color: s.gray500 }}> · Grade: {row.grade}</span>
                            : ''}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: s.gray500, marginTop: 3 }}>
                        Submitted {fmtDateTime(row.created_at)}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <button
                        onClick={() => setApproveTarget(row)}
                        style={{ ...btnPrimary, padding: '4px 12px', fontSize: 13 }}
                      >
                        Approve
                      </button>
                      <button onClick={() => openDeny(row)}
                        style={{ ...btnSecondary, padding: '4px 12px', fontSize: 13, color: s.red }}>
                        Deny
                      </button>
                      <button onClick={() => handleDelete(row)}
                        style={{ ...btnSecondary, padding: '4px 12px', fontSize: 13 }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Approve Modal */}
      {approveTarget && (
        <ModalWrap>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, color: s.navy }}>Approve Request</h2>

          {/* Summary */}
          <div style={{ background: s.gray100, borderRadius: s.radius, padding: 16, marginBottom: 16, fontSize: 14, color: s.gray700 }}>
            <div><strong>Submitted by:</strong> {approveTarget.submitter?.name || 'Unknown'}</div>
            {approveTarget._type === 'timeoff' ? (
              <>
                <div><strong>Type:</strong> {approveTarget.type}{approveTarget.type === 'Other' && approveTarget.other_code ? ` — ${approveTarget.other_code}` : ''}</div>
                <div><strong>Hours:</strong> {approveTarget.hours}</div>
                {approveTarget.dates_picked?.length > 0 && (
                  <div><strong>Dates:</strong> {approveTarget.dates_picked.map(d => fmtShortDate(d)).join(', ')}</div>
                )}
                {approveTarget.dates_notes && <div><strong>Notes:</strong> {approveTarget.dates_notes}</div>}
              </>
            ) : (
              <>
                <div><strong>Date Worked:</strong> {fmtShortDate(approveTarget.date_worked)}</div>
                <div><strong>Hours Worked:</strong> {approveTarget.hours_worked}</div>
                {approveTarget.purpose && <div><strong>Purpose:</strong> {approveTarget.purpose}</div>}
                {approveTarget.payment_or_comp && <div><strong>Request:</strong> {approveTarget.payment_or_comp}</div>}
                {approveTarget.grade && <div><strong>Grade:</strong> {approveTarget.grade}</div>}
              </>
            )}
          </div>

          {/* Which signature line will be stamped */}
          <div style={{ marginBottom: 16, fontSize: 14, color: s.gray700 }}>
            <strong>Signing as:</strong>{' '}
            {approveTarget._type === 'timeoff' ? 'Supervisor' : otSigLine}
          </div>

          {/* Signature preview */}
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Your Signature</label>
            {user.signature_png ? (
              <div style={{ border: `1px solid ${s.gray200}`, borderRadius: s.radius, background: s.gray100, padding: 12, textAlign: 'center' }}>
                <img src={user.signature_png} alt="Your signature" style={{ maxWidth: '100%', maxHeight: 100, objectFit: 'contain' }} />
              </div>
            ) : (
              <div style={{ padding: 12, background: '#fef2f2', borderRadius: s.radius, border: '1px solid #fecaca' }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, color: s.red, fontWeight: 600 }}>
                  You need to set up your signature before approving.
                </p>
                <button onClick={async () => { try { await requireSignature() } catch { /* cancelled */ } }}
                  style={{ ...btnPrimary, padding: '6px 14px', fontSize: 13 }}>
                  Set Up Signature
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setApproveTarget(null)} style={btnSecondary} disabled={processing}>Cancel</button>
            <button
              onClick={handleConfirmApprove}
              disabled={processing || !user.signature_png}
              style={{
                ...btnPrimary,
                opacity: (processing || !user.signature_png) ? 0.6 : 1,
                cursor: (processing || !user.signature_png) ? 'not-allowed' : 'pointer',
              }}
            >
              {processing ? 'Approving…' : 'Confirm Approval'}
            </button>
          </div>
        </ModalWrap>
      )}

      {/* Deny Modal */}
      {denyTarget && (
        <ModalWrap>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, color: s.navy }}>Deny Request</h2>

          <div style={{ background: s.gray100, borderRadius: s.radius, padding: 16, marginBottom: 20, fontSize: 14, color: s.gray700 }}>
            <div><strong>Submitted by:</strong> {denyTarget.submitter?.name || 'Unknown'}</div>
            {denyTarget._type === 'timeoff' ? (
              <>
                <div><strong>Type:</strong> {denyTarget.type}{denyTarget.type === 'Other' && denyTarget.other_code ? ` — ${denyTarget.other_code}` : ''}</div>
                <div><strong>Hours:</strong> {denyTarget.hours}</div>
              </>
            ) : (
              <>
                <div><strong>Date Worked:</strong> {fmtShortDate(denyTarget.date_worked)}</div>
                <div><strong>Hours Worked:</strong> {denyTarget.hours_worked}</div>
                {denyTarget.purpose && <div><strong>Purpose:</strong> {denyTarget.purpose}</div>}
              </>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={label}>Reason for Denial *</label>
            <textarea
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              placeholder="Explain why this request is being denied…"
              style={{ ...input, height: 80, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={closeDeny} style={btnSecondary} disabled={processing}>Cancel</button>
            <button
              onClick={handleConfirmDeny}
              disabled={processing || !denyReason.trim()}
              style={{
                ...btn, background: s.red, color: s.white,
                opacity: (processing || !denyReason.trim()) ? 0.6 : 1,
                cursor: (processing || !denyReason.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              {processing ? 'Denying…' : 'Confirm Denial'}
            </button>
          </div>
        </ModalWrap>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   7. DETECTIVE VIEW — wraps entry form + history with tabs
   ═══════════════════════════════════════════════════════════════════ */

// Page-level tab style — renders on the light gray page background (not the navy header)
const btnTab = (active) => ({
  ...btn,
  background: active ? s.navy : s.white,
  color: active ? s.white : s.gray700,
  border: `1px solid ${active ? s.navy : s.gray300}`,
  padding: '8px 20px',
  fontSize: 14,
})

function DetectiveView({ user, requireSignature }) {
  const [tab, setTab] = useState('entry')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={btnTab(tab === 'entry')} onClick={() => setTab('entry')}>
          Today's Entry
        </button>
        <button style={btnTab(tab === 'history')} onClick={() => setTab('history')}>
          History
        </button>
        <button style={btnTab(tab === 'timeslips')} onClick={() => setTab('timeslips')}>
          Time Slips
        </button>
      </div>

      {tab === 'entry' && <EntryForm user={user} />}
      {tab === 'history' && <HistoryView user={user} />}
      {tab === 'timeslips' && <TimeSlipsView user={user} requireSignature={requireSignature} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   8. SUPERVISOR — Dashboard
   ═══════════════════════════════════════════════════════════════════ */

// Roster by unit — fixed order for the dashboard grid
const UNIT_ROSTER = {
  Uniform: ['Brian Chowns', 'Scott Weaver', 'Tamara Spikes', 'William Crain'],
  Interdiction: ['Jake Droddy', 'Brigitte Morse'],
  UC: ['Colton Lowe', 'Layne Verdine', 'Ryan Golmon', 'Matthew Flowers', 'Tyler Lewis'],
}

// Compute up to 5 week-start Sundays that overlap a given month
function getWeekStartsForMonth(month, year) {
  const first = new Date(year, month - 1, 1)
  // Sunday on or before the 1st
  const offset = first.getDay() // 0=Sun
  const start = new Date(first)
  start.setDate(start.getDate() - offset)

  const lastDay = new Date(year, month, 0) // last day of month
  const weeks = []
  const cur = new Date(start)
  while (weeks.length < 6) {
    const weekEnd = new Date(cur)
    weekEnd.setDate(weekEnd.getDate() + 6)
    if ((cur.getMonth() + 1 === month && cur.getFullYear() === year) ||
        (weekEnd.getMonth() + 1 === month && weekEnd.getFullYear() === year)) {
      weeks.push(cur.toISOString().split('T')[0])
    }
    cur.setDate(cur.getDate() + 7)
    if (cur > new Date(lastDay.getTime() + 7 * 86400000)) break
  }
  return weeks.slice(0, 5)
}

function SubmissionGrid({ title, names, weekStarts, entryMap }) {
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 16px', color: s.navy, fontSize: 16 }}>{title}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, minWidth: 140 }}>Detective</th>
              {weekStarts.map((_, i) => (
                <th key={i} style={{ ...th, textAlign: 'center', minWidth: 70 }}>Wk {i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((name, ri) => (
              <tr key={name} style={{ background: ri % 2 === 0 ? s.white : s.gray100 }}>
                <td style={{ ...td, fontWeight: 600, color: s.navy }}>{name}</td>
                {weekStarts.map((ws, wi) => {
                  const count = entryMap.get(`${name}::${ws}`) || 0
                  return (
                    <td key={wi} style={{ ...td, textAlign: 'center', fontSize: 18 }}>
                      {count >= 5
                        ? <span style={{ color: s.green }}>&#10003;</span>
                        : count > 0
                          ? <span style={{ color: '#F59E0B' }}>◐</span>
                          : <span style={{ color: s.gray300 }}>—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Dashboard() {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchMonthEntries(month, year).then(data => {
      setEntries(data)
      setLoading(false)
    })
  }, [month, year])

  const weekStarts = useMemo(() => getWeekStartsForMonth(month, year), [month, year])

  // Build a Map of "detective_name::week_start" → count of Mon–Fri entries
  const entryMap = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      const ws = e.week_start || getWeekStart(e.entry_date)
      if (!weekStarts.includes(ws)) continue
      // Only count weekday entries (Mon=1 .. Fri=5)
      const d = new Date(e.entry_date + 'T00:00:00')
      const day = d.getDay() // 0=Sun, 6=Sat
      if (day === 0 || day === 6) continue
      const key = `${e.user_name}::${ws}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [entries, weekStarts])

  return (
    <div>
      {/* Month/Year picker */}
      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={label}>Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...input, width: 150 }}>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Year</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...input, width: 100 }} />
        </div>
      </div>

      {loading ? (
        <p style={{ color: s.gray500, padding: 12 }}>Loading...</p>
      ) : (
        <>
          <SubmissionGrid title="Uniform Detectives" names={UNIT_ROSTER.Uniform} weekStarts={weekStarts} entryMap={entryMap} />
          <SubmissionGrid title="Interdiction" names={UNIT_ROSTER.Interdiction} weekStarts={weekStarts} entryMap={entryMap} />
          <SubmissionGrid title="Undercover Detectives" names={UNIT_ROSTER.UC} weekStarts={weekStarts} entryMap={entryMap} />
        </>
      )}

      {/* Monthly export cards */}
      <MonthlyReport />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   9. SUPERVISOR — Weekly Detail View
   ═══════════════════════════════════════════════════════════════════ */

function WeeklyDetailView({ detectives }) {
  const [selectedUser, setSelectedUser] = useState('')
  const [weekStart, setWeekStart] = useState(getWeekStart(todayStr()))
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [bulkExporting, setBulkExporting] = useState(null) // null | { unit, current, total, name }
  const [bulkErrors, setBulkErrors] = useState(null) // null | string[]

  const dets = detectives.filter(d => d.role !== 'supervisor')

  useEffect(() => {
    if (!selectedUser) { setEntries([]); return }
    setLoading(true)
    const dates = getWeekDates(weekStart)
    const endDate = dates[6]
    fetchEntriesRange(selectedUser, weekStart, endDate).then(data => {
      setEntries(data)
      setLoading(false)
    })
  }, [selectedUser, weekStart])

  const selectedDet = dets.find(d => String(d.id) === String(selectedUser))
  const fields = selectedDet ? UNIT_FIELDS[selectedDet.unit] : []
  const weekDates = getWeekDates(weekStart)

  // Build a map of entry_date -> entry for quick lookup
  const entryMap = {}
  for (const e of entries) entryMap[e.entry_date] = e

  const totals = sumStats(entries, fields)

  function shiftWeek(delta) {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(d.toISOString().split('T')[0])
  }

  async function handleExportWeekly() {
    if (!selectedDet) return

    // Build the payload: detective info + entries for this week
    const payload = {
      unit: selectedDet.unit,
      detective_name: selectedDet.name,
      week_start: weekStart,
      entries: entries.map(e => ({
        entry_date: e.entry_date,
        stats: e.stats || {},
        notes: e.notes || '',
        case_numbers: e.case_numbers || '',
      })),
    }

    try {
      const res = await fetch('/api/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }

      // Download the returned xlsx file
      const blob = await res.blob()
      const lastName = selectedDet.name.split(' ').pop()
      const fileName = `${lastName}Week${weekStart.replace(/-/g, '')}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
  }

  async function handleBulkExport(unit) {
    const unitDets = dets.filter(d => d.unit === unit)
    if (!unitDets.length) return

    setBulkErrors(null)
    const failures = []
    const weekDatesRange = getWeekDates(weekStart)
    const endDate = weekDatesRange[6]

    for (let idx = 0; idx < unitDets.length; idx++) {
      const det = unitDets[idx]
      setBulkExporting({ unit, current: idx + 1, total: unitDets.length, name: det.name })

      try {
        // Fetch this detective's entries for the selected week
        const detEntries = await fetchEntriesRange(det.id, weekStart, endDate)

        const payload = {
          unit: det.unit,
          detective_name: det.name,
          week_start: weekStart,
          entries: detEntries.map(e => ({
            entry_date: e.entry_date,
            stats: e.stats || {},
            notes: e.notes || '',
            case_numbers: e.case_numbers || '',
          })),
        }

        const res = await fetch('/api/weekly', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Server error ${res.status}`)
        }

        const blob = await res.blob()
        const lastName = det.name.split(' ').pop()
        const fileName = `${lastName}Week${weekStart.replace(/-/g, '')}.xlsx`

        // Download this file immediately
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)

        // Brief pause so the browser doesn't block rapid downloads
        if (idx < unitDets.length - 1) await new Promise(r => setTimeout(r, 500))
      } catch (err) {
        failures.push(`${det.name}: ${err.message}`)
      }
    }

    setBulkExporting(null)
    if (failures.length > 0) {
      setBulkErrors(failures)
    }
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={label}>Detective</label>
          <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)} style={{ ...input, width: 220 }}>
            <option value="">Select detective...</option>
            {dets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.unit})</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => shiftWeek(-1)} style={btnSecondary}>← Prev</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: s.navy, minWidth: 200, textAlign: 'center' }}>
            {formatDate(weekStart)} – {formatDate(weekDates[6])}
          </span>
          <button onClick={() => shiftWeek(1)} style={btnSecondary}>Next →</button>
        </div>
        {selectedDet && (
          <button onClick={handleExportWeekly} style={btnPrimary} disabled={!!bulkExporting}>Export Weekly</button>
        )}
      </div>

      {/* Bulk export buttons */}
      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {['UC', 'Uniform', 'Interdiction'].map(unit => (
          <button
            key={unit}
            onClick={() => handleBulkExport(unit)}
            disabled={!!bulkExporting}
            style={{
              ...btnPrimary,
              opacity: bulkExporting && bulkExporting.unit !== unit ? 0.5 : 1,
            }}
          >
            {bulkExporting && bulkExporting.unit === unit
              ? `Exporting ${bulkExporting.current} of ${bulkExporting.total}: ${bulkExporting.name}...`
              : `Export All ${unit} Weeklies`}
          </button>
        ))}
      </div>

      {bulkErrors && (
        <div style={{ ...card, background: '#fef2f2', border: '1px solid #fca5a5' }}>
          <strong style={{ color: '#991b1b' }}>Some exports failed:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#991b1b' }}>
            {bulkErrors.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
          <button onClick={() => setBulkErrors(null)} style={{ ...btnSecondary, marginTop: 8, fontSize: 12 }}>Dismiss</button>
        </div>
      )}

      {/* Weekly table */}
      {selectedDet && (
        <div style={{ ...card, overflow: 'auto' }}>
          {loading ? (
            <p style={{ color: s.gray500 }}>Loading...</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Day</th>
                  {fields.map(f => <th key={f.key} style={th}>{f.label}</th>)}
                  <th style={th}>Cases / Notes</th>
                </tr>
              </thead>
              <tbody>
                {weekDates.map((date, i) => {
                  const e = entryMap[date]
                  return (
                    <tr key={date} style={{ background: i % 2 === 0 ? s.white : s.gray100 }}>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {DAY_NAMES[i]} {date.slice(5)}
                      </td>
                      {fields.map(f => (
                        <td key={f.key} style={{ ...td, textAlign: 'right' }}>
                          {Number(e?.stats?.[f.key]) || ''}
                        </td>
                      ))}
                      <td style={{ ...td, maxWidth: 220, whiteSpace: 'normal', fontSize: 12, color: s.gray500 }}>
                        {e?.case_numbers && <div><strong>Cases:</strong> {e.case_numbers}</div>}
                        {e?.notes && <div>{e.notes}</div>}
                        {!e?.case_numbers && !e?.notes && '—'}
                      </td>
                    </tr>
                  )
                })}
                {/* Totals */}
                <tr style={{ background: s.amberLight, fontWeight: 700 }}>
                  <td style={td}>WEEKLY TOTAL</td>
                  {fields.map(f => (
                    <td key={f.key} style={{ ...td, textAlign: 'right' }}>{totals[f.key] || ''}</td>
                  ))}
                  <td style={td}></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   10. SUPERVISOR — Monthly Report (XLSX export)
   ═══════════════════════════════════════════════════════════════════ */

function MonthlyReport() {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [busy, setBusy] = useState(null) // null | string describing current op
  const [weeklyProgress, setWeeklyProgress] = useState(null) // null | { current, total, name, week }
  const [errors, setErrors] = useState(null) // null | string[]

  const anyBusy = !!busy

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportMonthly(unit) {
    setBusy(`monthly-${unit}`)
    setErrors(null)
    try {
      const entries = await fetchMonthEntries(month, year)
      const res = await fetch('/api/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year, unit, export_type: 'month', entries }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const blob = await res.blob()
      downloadBlob(blob, `${unit}_Monthly_${MONTH_NAMES[month]}_${year}.xlsx`)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
    setBusy(null)
  }

  // Compute week-start Sundays that overlap a given month
  function getWeekStartsForMonth(m, y) {
    const first = new Date(y, m - 1, 1)
    const start = new Date(first)
    start.setDate(start.getDate() - start.getDay()) // Sunday on or before the 1st
    const lastDay = new Date(m < 12 ? new Date(y, m, 1) : new Date(y + 1, 0, 1))
    lastDay.setDate(lastDay.getDate() - 1)
    const weeks = []
    const cur = new Date(start)
    while (weeks.length < 6) {
      const weekEnd = new Date(cur)
      weekEnd.setDate(weekEnd.getDate() + 6)
      if ((cur.getMonth() + 1 === m && cur.getFullYear() === y) ||
          (weekEnd.getMonth() + 1 === m && weekEnd.getFullYear() === y)) {
        weeks.push(cur.toISOString().split('T')[0])
      }
      cur.setDate(cur.getDate() + 7)
      if (cur > new Date(lastDay.getTime() + 7 * 86400000)) break
    }
    return weeks.slice(0, 5)
  }

  async function exportWeeklies(unit) {
    setBusy(`weeklies-${unit}`)
    setErrors(null)
    setWeeklyProgress(null)

    const roster = UNIT_ROSTER[unit] || []
    const weekStarts = getWeekStartsForMonth(month, year)
    const totalCalls = roster.length * weekStarts.length
    const failures = []
    const zip = new JSZip()
    let callNum = 0

    for (const detName of roster) {
      // Find this detective in the db users list (for their id)
      // We don't have the detectives prop here, so we fetch entries by name via fetchMonthEntries
      // Actually we need user_id for fetchEntriesRange. Let's look up from UNIT_ROSTER name.
      // We'll fetch entries for the whole month and filter by name + week.
      for (const ws of weekStarts) {
        callNum++
        const weekEnd = getWeekDates(ws)[6]
        const weekLabel = `Week of ${MONTH_NAMES[month].slice(0, 3)} ${new Date(ws + 'T00:00:00').getDate()}`
        setWeeklyProgress({ current: callNum, total: totalCalls, name: detName, week: weekLabel })

        try {
          // Fetch entries for this detective+week from Supabase by name
          const { data: detEntries, error } = await supabase
            .from('det_entries')
            .select('*')
            .eq('user_name', detName)
            .gte('entry_date', ws)
            .lte('entry_date', weekEnd)
            .order('entry_date')
          if (error) throw error

          const payload = {
            unit,
            detective_name: detName,
            week_start: ws,
            entries: (detEntries || []).map(e => ({
              entry_date: e.entry_date,
              stats: e.stats || {},
              notes: e.notes || '',
              case_numbers: e.case_numbers || '',
            })),
          }

          const res = await fetch('/api/weekly', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `Server error ${res.status}`)
          }

          const blob = await res.blob()
          const lastName = detName.split(' ').pop()
          const fileName = `${lastName}Week${ws.replace(/-/g, '')}.xlsx`
          zip.file(fileName, blob)
        } catch (err) {
          failures.push(`${detName} (${weekLabel}): ${err.message}`)
        }
      }
    }

    // Download zip
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, `${unit}_Weeklies_${MONTH_NAMES[month]}_${year}.zip`)

    setWeeklyProgress(null)
    setBusy(null)
    if (failures.length > 0) setErrors(failures)
  }

  const units = [
    { key: 'UC', label: 'UC' },
    { key: 'Uniform', label: 'Uniform' },
    { key: 'Interdiction', label: 'Interdiction' },
  ]

  return (
    <div>
      {/* Month/Year picker */}
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={label}>Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...input, width: 150 }}>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Year</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...input, width: 100 }} />
        </div>
      </div>

      {/* Unit export buttons — one row per unit */}
      {units.map(({ key, label: unitLabel }) => (
        <div key={key} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: s.navy, minWidth: 100, fontSize: 14 }}>{unitLabel}</span>
          <button
            onClick={() => exportMonthly(key)}
            disabled={anyBusy}
            style={{ ...btnPrimary, opacity: anyBusy && busy !== `monthly-${key}` ? 0.5 : 1 }}
          >
            {busy === `monthly-${key}` ? 'Exporting...' : `Export ${unitLabel} Monthly`}
          </button>
          <button
            onClick={() => exportWeeklies(key)}
            disabled={anyBusy}
            style={{ ...btnPrimary, opacity: anyBusy && busy !== `weeklies-${key}` ? 0.5 : 1 }}
          >
            {busy === `weeklies-${key}` && weeklyProgress
              ? `Exporting ${weeklyProgress.current} of ${weeklyProgress.total}: ${weeklyProgress.name} — ${weeklyProgress.week}...`
              : `Export ${unitLabel} Weeklies`}
          </button>
        </div>
      ))}

      {errors && (
        <div style={{ ...card, background: '#fef2f2', border: '1px solid #fca5a5' }}>
          <strong style={{ color: '#991b1b' }}>Some exports failed:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#991b1b' }}>
            {errors.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
          <button onClick={() => setErrors(null)} style={{ ...btnSecondary, marginTop: 8, fontSize: 12 }}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   11. PAYROLL VIEW — supervisor timesheet management
   ═══════════════════════════════════════════════════════════════════ */

const PAYROLL_CODES = new Set(['MP','RG','FL','PL','DL','ML','AW','CC','CS','FBI','FP','HL','HC','HS','HP','HW','OS','SO','SH','ST','UL','VT','CT','OE','CE','DF','LW','WC','AC','DP','EW','ET','EH','PT','EL','OT'])
const NUM_CODE_ROWS = 5

const PAY_PERIODS = (() => {
  const anchor = new Date('2026-01-04T00:00:00')
  const periods = []
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  for (let i = 0; i < 52; i++) {
    const start = new Date(anchor)
    start.setDate(start.getDate() + i * 14)
    const end = new Date(start)
    end.setDate(end.getDate() + 13)
    periods.push({
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      label: `${fmt(start)} - ${fmt(end)}, ${end.getFullYear()}`,
    })
  }
  return periods
})()

function findCurrentPayPeriod() {
  const today = todayStr()
  for (const p of PAY_PERIODS) {
    if (today >= p.start && today <= p.end) return p.start
  }
  return PAY_PERIODS[0]?.start || ''
}

function normalizeTimesheetGrid(rows) {
  // Collect all unique codes across all days, in order of first appearance
  const allCodes = []
  for (const r of rows) {
    for (const cr of (r.code_rows || [])) {
      if (cr.code && !allCodes.includes(cr.code)) allCodes.push(cr.code)
    }
  }
  return rows.map(r => {
    // Build per-code map preserving hours and source_request_id
    const codeMap = {}
    for (const cr of (r.code_rows || [])) {
      if (cr.code) {
        if (!codeMap[cr.code]) {
          codeMap[cr.code] = { hours: 0, source_request_id: null }
        }
        codeMap[cr.code].hours += Number(cr.hours) || 0
        if (cr.source_request_id) codeMap[cr.code].source_request_id = cr.source_request_id
      }
    }
    const normalizedCodes = []
    for (let i = 0; i < NUM_CODE_ROWS; i++) {
      const code = allCodes[i] || ''
      const entry = codeMap[code]
      normalizedCodes.push({
        code,
        hours: entry ? entry.hours : 0,
        source_request_id: entry?.source_request_id || null,
      })
    }
    return {
      ...r,
      reg_hours: Number(r.reg_hours) || 0,
      code_rows: normalizedCodes,
    }
  })
}

function PayrollView({ detectives }) {
  const [selectedPeriod, setSelectedPeriod] = useState(findCurrentPayPeriod)
  const [otherLeave, setOtherLeave] = useState([])

  const dets = useMemo(() => {
    return [...detectives].sort((a, b) => a.name.split(' ').pop().localeCompare(b.name.split(' ').pop()))
  }, [detectives])

  const [selectedDetId, setSelectedDetId] = useState('')
  const selectedDet = dets.find(d => String(d.id) === String(selectedDetId))

  useEffect(() => {
    if (dets.length > 0 && !selectedDetId) setSelectedDetId(String(dets[0].id))
  }, [dets])

  const [gridData, setGridData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const saveTimerRef = useRef(null)
  const saveStatusTimerRef = useRef(null)
  const gridDataRef = useRef(null)
  const selectedDetIdRef = useRef(selectedDetId)
  const selectedPeriodRef = useRef(selectedPeriod)

  useEffect(() => { gridDataRef.current = gridData }, [gridData])
  useEffect(() => { selectedDetIdRef.current = selectedDetId }, [selectedDetId])
  useEffect(() => { selectedPeriodRef.current = selectedPeriod }, [selectedPeriod])

  // Pull data when detective or period changes
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (!selectedDetId || !selectedPeriod) return
    setLoading(true)
    setGridData(null)
    setSaveStatus('')
    fetch('/api/timesheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pull', user_id: selectedDetId, pay_period_start: selectedPeriod }),
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setGridData(normalizeTimesheetGrid(data))
        else throw new Error(data.error || 'Failed to pull data')
      })
      .catch(err => alert('Failed to load timesheet: ' + err.message))
      .finally(() => setLoading(false))
  }, [selectedDetId, selectedPeriod])

  // Fetch approved "other" leave for the selected pay period (banner)
  useEffect(() => {
    if (!selectedPeriod) return
    const pp = PAY_PERIODS.find(p => p.start === selectedPeriod)
    if (!pp) return
    fetchOtherLeaveForPeriod(pp.start, pp.end)
      .then(setOtherLeave)
      .catch(() => setOtherLeave([]))
  }, [selectedPeriod])

  function updateCell(dayIndex, field, value, codeRowIndex) {
    setGridData(prev => {
      if (!prev) return prev
      return prev.map((d, i) => {
        if (i !== dayIndex) return d
        const day = { ...d }
        if (field === 'reg_hours') day.reg_hours = value
        else if (field === 'code') {
          day.code_rows = day.code_rows.map((cr, ci) => ci === codeRowIndex ? { ...cr, code: value } : cr)
        } else if (field === 'code_hours') {
          day.code_rows = day.code_rows.map((cr, ci) => ci === codeRowIndex ? { ...cr, hours: value } : cr)
        }
        return day
      })
    })
    scheduleSave()
  }

  function updateCodeName(codeRowIndex, value) {
    setGridData(prev => {
      if (!prev) return prev
      return prev.map(d => ({
        ...d,
        code_rows: d.code_rows.map((cr, ci) => ci === codeRowIndex ? { ...cr, code: value } : cr),
      }))
    })
    scheduleSave()
  }

  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(doSave, 500)
  }

  async function doSave() {
    const data = gridDataRef.current
    const detId = selectedDetIdRef.current
    const period = selectedPeriodRef.current
    if (!data || !detId || !period) return
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          user_id: detId,
          pay_period_start: period,
          days: data.map(d => ({
            day_date: d.day_date,
            reg_hours: Number(d.reg_hours) || 0,
            code_rows: d.code_rows.filter(cr => cr.code.trim() !== ''),
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      setSaveStatus('saved')
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current)
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000)
    } catch {
      setSaveStatus('error')
    }
  }

  async function handleReset() {
    if (!selectedDet || !selectedPeriod) return
    const period = PAY_PERIODS.find(p => p.start === selectedPeriod)
    const lastName = selectedDet.name.split(' ').pop()
    if (!confirm(`This will erase all your changes for ${lastName} in pay period ${period?.label || selectedPeriod} and re-pull fresh data. Are you sure?`)) return
    setLoading(true)
    try {
      const res = await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', user_id: selectedDetId, pay_period_start: selectedPeriod }),
      })
      const data = await res.json()
      if (Array.isArray(data)) setGridData(normalizeTimesheetGrid(data))
      else throw new Error(data.error || 'Reset failed')
    } catch (err) {
      alert('Reset failed: ' + err.message)
    }
    setLoading(false)
  }

  async function handleExport() {
    if (!selectedDet || !selectedPeriod) return
    try {
      const res = await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export', user_id: selectedDetId, pay_period_start: selectedPeriod, detective_name: selectedDet.name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Export failed')
      }
      const blob = await res.blob()
      const lastName = selectedDet.name.split(' ').pop()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${lastName}_Timesheet_${selectedPeriod}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
  }

  const [exportingAll, setExportingAll] = useState(false)

  async function handleExportAll() {
    if (!selectedPeriod || exportingAll) return
    setExportingAll(true)
    try {
      const res = await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export_all', pay_period_start: selectedPeriod }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `JCSO_Detectives_Payroll_${selectedPeriod}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + err.message)
    }
    setExportingAll(false)
  }

  const dayHeaders = gridData ? gridData.map(d => {
    const dt = new Date(d.day_date + 'T00:00:00')
    return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()]} ${dt.getMonth()+1}/${dt.getDate()}`
  }) : []

  const rowTotals = gridData ? {
    rg: gridData.reduce((sum, d) => sum + (Number(d.reg_hours) || 0), 0),
    codes: Array.from({ length: NUM_CODE_ROWS }, (_, ci) =>
      gridData.reduce((sum, d) => sum + (Number(d.code_rows[ci]?.hours) || 0), 0)
    ),
  } : null

  const colTotals = gridData ? gridData.map(d => {
    let t = (Number(d.reg_hours) || 0)
    for (const cr of d.code_rows) t += (Number(cr.hours) || 0)
    return t
  }) : null

  const grandTotal = colTotals ? colTotals.reduce((a, b) => a + b, 0) : 0

  const cellInput = {
    width: 50, padding: '4px 2px', borderRadius: 4, border: `1px solid ${s.gray300}`,
    fontFamily: s.font, fontSize: 13, textAlign: 'center', outline: 'none', boxSizing: 'border-box',
  }
  const codeInput = {
    width: 42, padding: '4px 2px', borderRadius: 4, border: `1px solid ${s.gray300}`,
    fontFamily: s.font, fontSize: 12, textAlign: 'center', outline: 'none', boxSizing: 'border-box',
    textTransform: 'uppercase',
  }
  const stickyTd = (bg) => ({
    ...td, fontWeight: 700, color: s.navy, position: 'sticky', left: 0, background: bg, zIndex: 1,
  })

  return (
    <div>
      {/* Header row */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, color: s.navy, fontSize: 20 }}>Payroll Timesheets</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {saveStatus === 'saved' && <span style={{ fontSize: 12, color: s.green, fontWeight: 600, transition: 'opacity 0.3s' }}>Saved</span>}
          {saveStatus === 'saving' && <span style={{ fontSize: 12, color: s.gray500 }}>Saving...</span>}
          {saveStatus === 'error' && <span style={{ fontSize: 12, color: s.red, fontWeight: 600 }}>Save failed</span>}
          <select value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} style={{ ...input, width: 240 }}>
            {PAY_PERIODS.map(p => <option key={p.start} value={p.start}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {/* Detective tabs */}
      <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {dets.map(d => {
          const isActive = String(d.id) === String(selectedDetId)
          return (
            <button key={d.id} onClick={() => setSelectedDetId(String(d.id))} style={{
              ...btn, padding: '6px 14px', fontSize: 13, whiteSpace: 'nowrap',
              background: isActive ? s.navy : s.gray100,
              color: isActive ? s.white : s.gray700,
              border: `1px solid ${isActive ? s.navy : s.gray300}`,
            }}>
              {d.name.split(' ').pop()}
            </button>
          )
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <p style={{ color: s.gray500 }}>Loading timesheet...</p>
        </div>
      ) : gridData ? (
        <>
          <div style={{ ...card, overflow: 'auto', padding: 16 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, minWidth: 54, position: 'sticky', left: 0, background: s.white, zIndex: 1 }}>Code</th>
                  {dayHeaders.map((h, i) => (
                    <th key={i} style={{ ...th, textAlign: 'center', minWidth: 56, padding: '6px 3px' }}>{h}</th>
                  ))}
                  <th style={{ ...th, textAlign: 'center', minWidth: 50 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {/* RG row */}
                <tr style={{ background: s.white }}>
                  <td style={stickyTd(s.white)}>RG</td>
                  {gridData.map((d, di) => (
                    <td key={di} style={{ ...td, textAlign: 'center', padding: '4px 2px' }}>
                      <input type="number" step="any"
                        value={d.reg_hours || ''}
                        onChange={e => updateCell(di, 'reg_hours', e.target.value === '' ? 0 : Number(e.target.value))}
                        style={cellInput}
                      />
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: s.navy }}>{rowTotals.rg || ''}</td>
                </tr>
                {/* Code rows */}
                {Array.from({ length: NUM_CODE_ROWS }, (_, ci) => {
                  const bg = ci % 2 === 0 ? s.white : s.gray100
                  const codeVal = gridData[0]?.code_rows[ci]?.code || ''
                  const codeInvalid = codeVal && !PAYROLL_CODES.has(codeVal.toUpperCase().trim())
                  return (
                    <tr key={`code-${ci}`} style={{ background: bg }}>
                      <td style={{ ...td, padding: '4px 2px', position: 'sticky', left: 0, background: bg, zIndex: 1 }}>
                        <input
                          value={codeVal}
                          onChange={e => updateCodeName(ci, e.target.value.toUpperCase())}
                          onBlur={e => updateCodeName(ci, e.target.value.toUpperCase().trim())}
                          style={{ ...codeInput, background: codeInvalid ? '#fef3c7' : s.white }}
                          maxLength={3}
                          placeholder="—"
                        />
                      </td>
                      {gridData.map((d, di) => (
                        <td key={di} style={{ ...td, textAlign: 'center', padding: '4px 2px' }}>
                          <input type="number" step="any"
                            value={d.code_rows[ci]?.hours || ''}
                            onChange={e => updateCell(di, 'code_hours', e.target.value === '' ? 0 : Number(e.target.value), ci)}
                            style={cellInput}
                          />
                        </td>
                      ))}
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: s.navy }}>{rowTotals.codes[ci] || ''}</td>
                    </tr>
                  )
                })}
                {/* Total row */}
                <tr style={{ background: s.amberLight, fontWeight: 700 }}>
                  <td style={stickyTd(s.amberLight)}>TOTAL</td>
                  {colTotals.map((t, i) => (
                    <td key={i} style={{ ...td, textAlign: 'center', fontWeight: 700, color: s.navy }}>{t || ''}</td>
                  ))}
                  <td style={{ ...td, textAlign: 'center', fontWeight: 800, color: s.navy }}>{grandTotal || ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={handleReset} style={btnSecondary}>Start Over</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleExport} style={btnSecondary}>Export to Excel</button>
              <button onClick={handleExportAll} disabled={exportingAll} style={{ ...btnPrimary, opacity: exportingAll ? 0.6 : 1, cursor: exportingAll ? 'not-allowed' : 'pointer' }}>
                {exportingAll ? 'Exporting...' : 'Export Full Pay Period'}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Other Leave banner — approved type='other' requests needing manual coding */}
      {otherLeave.length > 0 && (() => {
        const detMap = {}
        for (const d of detectives) detMap[d.id] = d.name
        const pp = PAY_PERIODS.find(p => p.start === selectedPeriod)
        return (
          <div style={{
            ...card,
            background: s.amberLight,
            border: `1px solid ${s.amber}`,
            padding: '14px 18px',
            marginTop: 12,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#92400e', marginBottom: 8 }}>
              ⚠️ Other leave this period needs manual coding:
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#78350f' }}>
              {otherLeave.map(r => {
                const name = detMap[r.user_id] || 'Unknown'
                const datesInPeriod = (r.dates_picked || []).filter(
                  d => pp && d >= pp.start && d <= pp.end
                )
                const dateStr = datesInPeriod.map(d => {
                  const dt = new Date(d + 'T00:00:00')
                  return `${dt.getMonth() + 1}/${dt.getDate()}`
                }).join(', ')
                return (
                  <li key={r.id} style={{ marginBottom: 4 }}>
                    {name} — {r.hours} hrs on {dateStr} — '{r.other_code || 'Other'}'
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })()}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   11b. PDF MERGER VIEW — client-side PDF merge tool (supervisor only)
   ═══════════════════════════════════════════════════════════════════ */

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

function PdfMergerView() {
  const [files, setFiles] = useState([]) // [{ id, file, name, size, pages, error }]
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  const doneTimerRef = useRef(null)
  const dragOverIdRef = useRef(null) // id of item being dragged over
  const dragItemIdRef = useRef(null) // id of item being dragged

  // Count pages in a PDF file
  async function readPdf(file) {
    try {
      const buf = await file.arrayBuffer()
      const doc = await PDFDocument.load(buf, { ignoreEncryption: false })
      return { pages: doc.getPageCount(), error: null }
    } catch (e) {
      const msg = e.message || ''
      if (msg.toLowerCase().includes('encrypt') || msg.toLowerCase().includes('password')) {
        return { pages: null, error: 'Password-protected PDF — cannot merge.' }
      }
      return { pages: null, error: 'Could not read PDF — file may be corrupted.' }
    }
  }

  async function addFiles(fileList) {
    const incoming = []
    for (const f of fileList) {
      const ext = f.name.split('.').pop().toLowerCase()
      const mime = f.type
      if (ext !== 'pdf' && mime !== 'application/pdf') {
        incoming.push({ id: crypto.randomUUID(), file: null, name: f.name, size: f.size, pages: null, error: 'Not a PDF file — skipped.' })
        continue
      }
      if (f.size > MAX_FILE_BYTES) {
        incoming.push({ id: crypto.randomUUID(), file: null, name: f.name, size: f.size, pages: null, error: `File exceeds 50 MB limit (${(f.size / 1024 / 1024).toFixed(1)} MB).` })
        continue
      }
      const { pages, error } = await readPdf(f)
      incoming.push({ id: crypto.randomUUID(), file: f, name: f.name, size: f.size, pages, error })
    }
    setFiles(prev => [...prev, ...incoming])
  }

  function handleDrop(e) {
    e.preventDefault()
    const dt = e.dataTransfer
    if (dt.files && dt.files.length > 0) addFiles(dt.files)
  }

  function handlePickerChange(e) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files)
      e.target.value = '' // reset so same file can be re-added after removal
    }
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  // List drag-to-reorder handlers
  function onDragStart(id) { dragItemIdRef.current = id }
  function onDragEnter(id) { dragOverIdRef.current = id }
  function onDragEnd() {
    const fromId = dragItemIdRef.current
    const toId = dragOverIdRef.current
    if (!fromId || !toId || fromId === toId) return
    setFiles(prev => {
      const arr = [...prev]
      const fromIdx = arr.findIndex(f => f.id === fromId)
      const toIdx = arr.findIndex(f => f.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const [item] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, item)
      return arr
    })
    dragItemIdRef.current = null
    dragOverIdRef.current = null
  }

  async function handleMerge() {
    const valid = files.filter(f => f.file && !f.error)
    if (valid.length < 2) return
    setMerging(true)
    setMergeError('')
    setDoneMsg('')
    try {
      const merged = await PDFDocument.create()
      for (const item of valid) {
        const buf = await item.file.arrayBuffer()
        const src = await PDFDocument.load(buf)
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }
      const bytes = await merged.save()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const a = document.createElement('a')
      a.href = url
      a.download = `Merged_${ts}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current)
      setDoneMsg('Merged successfully!')
      doneTimerRef.current = setTimeout(() => setDoneMsg(''), 4000)
    } catch (e) {
      setMergeError('Merge failed: ' + (e.message || 'Unknown error'))
    } finally {
      setMerging(false)
    }
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    return (bytes / 1024).toFixed(0) + ' KB'
  }

  const validCount = files.filter(f => f.file && !f.error).length
  const fileInputRef = useRef(null)

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${s.gray300}`,
          borderRadius: s.radius,
          background: s.white,
          padding: '40px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: 16,
          transition: 'border-color 0.15s',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
        <div style={{ fontWeight: 600, color: s.gray700, marginBottom: 4 }}>Drop PDF files here</div>
        <div style={{ fontSize: 13, color: s.gray500 }}>or click to browse — multi-select supported, max 50 MB per file</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={handlePickerChange}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          {files.map((item, idx) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => onDragStart(item.id)}
              onDragEnter={() => onDragEnter(item.id)}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 16px',
                borderBottom: idx < files.length - 1 ? `1px solid ${s.gray100}` : 'none',
                background: s.white,
                gap: 12,
              }}
            >
              {/* Drag handle */}
              <span style={{ cursor: 'grab', color: s.gray300, fontSize: 18, lineHeight: 1, userSelect: 'none' }}>⠿</span>

              {/* File info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: s.gray900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                {item.error ? (
                  <div style={{ fontSize: 12, color: s.red }}>{item.error}</div>
                ) : (
                  <div style={{ fontSize: 12, color: s.gray500 }}>
                    {item.pages} {item.pages === 1 ? 'page' : 'pages'} · {formatSize(item.size)}
                  </div>
                )}
              </div>

              {/* Remove */}
              <button
                onClick={() => removeFile(item.id)}
                style={{ ...btnSecondary, padding: '4px 10px', fontSize: 13, lineHeight: 1 }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleMerge}
          disabled={validCount < 2 || merging}
          style={{ ...btnPrimary, opacity: (validCount < 2 || merging) ? 0.5 : 1, cursor: validCount < 2 || merging ? 'not-allowed' : 'pointer' }}
        >
          {merging ? 'Merging…' : `Merge & Download (${validCount} files)`}
        </button>

        {files.length > 0 && (
          <button onClick={() => setFiles([])} style={btnSecondary}>
            Clear All
          </button>
        )}

        {doneMsg && (
          <span style={{ fontSize: 14, color: s.green, fontWeight: 600 }}>{doneMsg}</span>
        )}
      </div>

      {mergeError && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: `1px solid #fecaca`, borderRadius: s.radius, color: s.red, fontSize: 13 }}>
          {mergeError}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   12. SUPERVISOR VIEW — wraps all supervisor tabs
   ═══════════════════════════════════════════════════════════════════ */

function SupervisorView({ detectives, user, requireSignature }) {
  const [tab, setTab] = useState('dashboard')
  const [pendingCount, setPendingCount] = useState(0)
  const [pulseKey, setPulseKey] = useState(0)
  const prevCountRef = useRef(0)

  async function refreshCount() {
    try {
      const count = await fetchPendingCount()
      if (count > prevCountRef.current) setPulseKey(k => k + 1)
      prevCountRef.current = count
      setPendingCount(count)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    refreshCount()
    window.addEventListener('focus', refreshCount)
    return () => window.removeEventListener('focus', refreshCount)
  }, [])

  function handleTabClick(key) {
    setTab(key)
    refreshCount()
  }

  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'weekly', label: 'Weekly View' },
    { key: 'pending', label: 'Pending Requests' },
    { key: 'timeslips', label: 'Time Slips' },
    ...(user.can_access_payroll ? [{ key: 'payroll', label: 'Payroll' }] : []),
    ...(user.can_access_payroll ? [{ key: 'pdf_merger', label: 'PDF Merger' }] : []),
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(t => {
          const isPending = t.key === 'pending'
          const showBadge = isPending && pendingCount > 0
          return (
            <button
              key={isPending ? `pending-${pulseKey}` : t.key}
              className={showBadge ? 'jcso-pulse' : ''}
              style={btnTab(tab === t.key)}
              onClick={() => handleTabClick(t.key)}
            >
              {showBadge ? (
                <>
                  Pending Requests{' '}
                  <span style={{
                    background: '#ef4444', color: '#fff',
                    borderRadius: 10, padding: '1px 7px',
                    fontSize: 11, fontWeight: 700, marginLeft: 2,
                  }}>{pendingCount}</span>
                </>
              ) : t.label}
            </button>
          )
        })}
      </div>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'weekly' && <WeeklyDetailView detectives={detectives} />}
      {tab === 'pending' && <PendingRequestsView user={user} requireSignature={requireSignature} onCountRefresh={refreshCount} />}
      {tab === 'timeslips' && <TimeSlipsView user={user} requireSignature={requireSignature} />}
      {tab === 'payroll' && <PayrollView detectives={detectives} />}
      {tab === 'pdf_merger' && <PdfMergerView />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   13. SIGNATURE MODAL — draw / view stored signature
   Storage format: full data URL ("data:image/png;base64,...")
   so it can be dropped directly into <img src> or a PDF embed.
   ═══════════════════════════════════════════════════════════════════ */

function SignatureModal({ mode, required, signaturePng, onSave, onClose, onRedraw }) {
  const canvasRef = useRef(null)
  const isDrawingRef = useRef(false)
  const lastPosRef = useRef(null)
  const [drawError, setDrawError] = useState('')
  const [saving, setSaving] = useState(false)

  // Fill canvas white whenever we enter draw mode
  useEffect(() => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [mode])

  function getPos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if (e.touches && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function startDraw(e) {
    e.preventDefault()
    isDrawingRef.current = true
    lastPosRef.current = getPos(e)
    setDrawError('')
  }

  function draw(e) {
    e.preventDefault()
    if (!isDrawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPosRef.current = pos
  }

  function endDraw(e) {
    e?.preventDefault()
    isDrawingRef.current = false
    lastPosRef.current = null
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setDrawError('')
  }

  function isCanvasBlank() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 255 || data[i + 1] < 255 || data[i + 2] < 255) return false
    }
    return true
  }

  async function handleSave() {
    if (isCanvasBlank()) {
      setDrawError('Please draw a signature before saving.')
      return
    }
    setSaving(true)
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png')
      await onSave(dataUrl)
    } catch (e) {
      setDrawError('Failed to save: ' + (e.message || 'Unknown error'))
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: s.white, borderRadius: s.radius * 1.5,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        width: '100%', maxWidth: 560, padding: 28, fontFamily: s.font,
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20, color: s.navy }}>
          {mode === 'view' ? 'My Signature' : 'Draw Your Signature'}
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: s.gray500, lineHeight: 1.5 }}>
          {mode === 'view'
            ? 'Your saved signature. Click "Redraw" to replace it.'
            : 'Use your mouse, finger, or stylus to sign below. This will be used on your time-off and overtime request forms.'}
          {mode === 'draw' && required && (
            <><br /><span style={{ color: s.red }}>You need to set up your signature before continuing.</span></>
          )}
        </p>

        {mode === 'view' ? (
          <div style={{
            border: `1px solid ${s.gray200}`, borderRadius: s.radius,
            background: s.gray100, padding: 16, marginBottom: 20, textAlign: 'center',
          }}>
            <img
              src={signaturePng}
              alt="Your signature"
              style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }}
            />
          </div>
        ) : (
          <>
            <div style={{ border: `1px solid ${s.gray300}`, borderRadius: s.radius, overflow: 'hidden', marginBottom: 8 }}>
              <canvas
                ref={canvasRef}
                width={500}
                height={200}
                style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none', cursor: 'crosshair' }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
            </div>
            {drawError && (
              <p style={{ margin: '0 0 8px', fontSize: 13, color: s.red }}>{drawError}</p>
            )}
            <div style={{ marginBottom: 20 }}>
              <button onClick={clearCanvas} style={btnSecondary}>Clear</button>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {mode === 'view' ? (
            <>
              <button onClick={onRedraw} style={btnSecondary}>Redraw</button>
              <button onClick={onClose} style={btnPrimary}>Done</button>
            </>
          ) : (
            <>
              {!required && <button onClick={onClose} style={btnSecondary}>Cancel</button>}
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save Signature'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   12. APP — main component with auth and routing
   ═══════════════════════════════════════════════════════════════════ */

export default function App() {
  const [user, setUser] = useState(null)
  const [allUsers, setAllUsers] = useState([])

  // sigModal: null | { mode: 'view'|'draw', required: bool, resolve: fn|null, reject: fn|null }
  const [sigModal, setSigModal] = useState(null)

  // Restore session from localStorage, then re-fetch the user row from DB
  // to pick up any new columns (e.g. can_access_payroll) added after the session was cached.
  useEffect(() => {
    const saved = localStorage.getItem('jcso_det_user')
    if (saved) {
      try {
        const cached = JSON.parse(saved)
        setUser(cached)
        // Refresh the row so new columns like can_access_payroll are always current
        supabase.from('det_users').select('*').eq('id', cached.id).single()
          .then(({ data }) => {
            if (data) {
              setUser(data)
              localStorage.setItem('jcso_det_user', JSON.stringify(data))
            }
          })
          .catch(() => {})
      } catch {}
    }
    // Fetch all users for supervisor views
    fetchUsers().then(setAllUsers).catch(() => {})
  }, [])

  function handleLogin(u) {
    setUser(u)
    localStorage.setItem('jcso_det_user', JSON.stringify(u))
  }

  function handleLogout() {
    setUser(null)
    localStorage.removeItem('jcso_det_user')
  }

  // Save signature to DB + update in-memory state + localStorage
  async function handleSaveSignature(dataUrl) {
    const updated = await updateUserSignature(user.id, dataUrl)
    setUser(updated)
    localStorage.setItem('jcso_det_user', JSON.stringify(updated))
    const resolve = sigModal?.resolve
    setSigModal(null)
    if (resolve) resolve(true)
  }

  function closeSigModal() {
    const reject = sigModal?.reject
    setSigModal(null)
    if (reject) reject(new Error('cancelled'))
  }

  // Opens SignatureModal if user has no signature, otherwise resolves immediately.
  // Returns a Promise — call before any action that requires a signature.
  // Not wired into any action yet (Phase 5b).
  function requireSignature() {
    if (user?.signature_png) return Promise.resolve(true)
    return new Promise((resolve, reject) => {
      setSigModal({ mode: 'draw', required: true, resolve, reject })
    })
  }

  function openSigModal() {
    if (user?.signature_png) {
      setSigModal({ mode: 'view', required: false, resolve: null, reject: null })
    } else {
      setSigModal({ mode: 'draw', required: false, resolve: null, reject: null })
    }
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />

  const isSupervisor = user.role === 'supervisor'

  return (
    <div style={{ minHeight: '100vh', background: s.bg, fontFamily: s.font }}>
      {/* Header */}
      <header style={{
        background: s.navy, color: s.white, padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56, boxShadow: s.shadowLg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>JCSO Detective MicroManager</h1>
          <span style={{
            background: s.amber, color: s.navy, padding: '2px 10px',
            borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          }}>
            {isSupervisor ? 'Supervisor' : user.unit}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, opacity: 0.8 }}>{user.name}</span>
          <button
            onClick={openSigModal}
            style={{ ...btn, background: 'rgba(255,255,255,0.1)', color: s.white, padding: '6px 14px', fontSize: 13 }}
            title={user.signature_png ? 'View / redraw your signature' : 'Set up your signature'}
          >
            {user.signature_png ? '✓ Signature' : 'My Signature'}
          </button>
          <button onClick={handleLogout} style={{ ...btn, background: 'rgba(255,255,255,0.1)', color: s.white, padding: '6px 14px', fontSize: 13 }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        {isSupervisor
          ? <SupervisorView detectives={allUsers} user={user} requireSignature={requireSignature} />
          : <DetectiveView user={user} requireSignature={requireSignature} />
        }
      </main>

      {/* Signature modal */}
      {sigModal && (
        <SignatureModal
          mode={sigModal.mode}
          required={sigModal.required}
          signaturePng={user.signature_png || null}
          onSave={handleSaveSignature}
          onClose={closeSigModal}
          onRedraw={() => setSigModal(prev => ({ ...prev, mode: 'draw' }))}
        />
      )}
    </div>
  )
}
