import { useState, useEffect, useMemo } from 'react'
import {
  supabase, getWeekStart, getWeekDates, formatDate, formatDateLong,
  todayStr, fetchUsers, loginUser, fetchEntry, upsertEntry,
  fetchUserEntries, fetchAllEntries, fetchMonthEntries, fetchEntriesRange,
} from './supabase'

/* ═══════════════════════════════════════════════════════════════════
   1. CONSTANTS — unit field definitions and detective roster
   ═══════════════════════════════════════════════════════════════════ */

const UC_FIELDS = [
  { key: 'hours', label: 'Hours' },
  { key: 'attempted_operations', label: 'Attempted Operations' },
  { key: 'uc_ci_cases', label: 'UC/CI Cases' },
  { key: 'tno_cases', label: 'TNO Cases' },
  { key: 'sw_cases', label: 'SW Cases' },
  { key: 'surv_hours', label: 'Surv Hours' },
  { key: 'patrol_cases', label: 'Patrol Cases' },
  { key: 'pc_arrest', label: 'PC Arrest' },
  { key: 'warrant_arrest', label: 'Warrant Arrest' },
  { key: 'training_hours', label: 'Training Hours' },
  { key: 'detective_agency_assist', label: 'Detective/Agency Assist' },
]

const UNIFORM_FIELDS = [
  { key: 'hours_worked', label: 'Hours Worked' },
  { key: 'time_off', label: 'Time Off' },
  { key: 'k9_deploy', label: 'K9 Deploy' },
  { key: 'tno_cases', label: 'TNO Cases' },
  { key: 'training_hours', label: 'Training Hours' },
  { key: 'surv_hours', label: 'Surv Hours' },
  { key: 'patrol_jail_cases', label: 'Patrol/Jail Cases' },
  { key: 'traffic_stops', label: 'Traffic Stops' },
  { key: 'warrant_arrests', label: 'Warrant Arrests' },
  { key: 'agency_assist', label: 'Agency Assist' },
  { key: 'supp_reports', label: 'Supp Reports' },
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
  { key: 'meth_g', label: 'Meth (g)' },
  { key: 'cocaine_g', label: 'Cocaine (g)' },
  { key: 'heroin_g', label: 'Heroin (g)' },
  { key: 'fentanyl_g', label: 'Fentanyl (g)' },
  { key: 'marijuana_oz', label: 'Marijuana (oz)' },
  { key: 'promethazine_codeine_oz', label: 'Promethazine/Codeine (oz)' },
  { key: 'rx_pills', label: 'RX Pills (#)' },
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

function DetectiveView({ user }) {
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
      </div>

      {tab === 'entry' && <EntryForm user={user} />}
      {tab === 'history' && <HistoryView user={user} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   8. SUPERVISOR — Dashboard
   ═══════════════════════════════════════════════════════════════════ */

function Dashboard({ detectives }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterUnit, setFilterUnit] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))

  useEffect(() => {
    const filters = {}
    if (filterUnit) filters.unit = filterUnit
    if (filterUser) filters.user_id = filterUser
    if (filterMonth) filters.month = Number(filterMonth)
    if (filterYear) filters.year = Number(filterYear)
    setLoading(true)
    fetchAllEntries(filters).then(data => {
      setEntries(data)
      setLoading(false)
    })
  }, [filterUnit, filterUser, filterMonth, filterYear])

  // Get unique units from detectives (not supervisors)
  const units = [...new Set(detectives.filter(d => d.role !== 'supervisor').map(d => d.unit))]

  return (
    <div>
      {/* Filters */}
      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={label}>Unit</label>
          <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)} style={{ ...input, width: 150 }}>
            <option value="">All Units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Detective</label>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{ ...input, width: 200 }}>
            <option value="">All Detectives</option>
            {detectives.filter(d => d.role !== 'supervisor').filter(d => !filterUnit || d.unit === filterUnit).map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Month</label>
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...input, width: 140 }}>
            <option value="">All Months</option>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Year</label>
          <input type="number" value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ ...input, width: 100 }} />
        </div>
      </div>

      {/* Results table */}
      <div style={{ ...card, overflow: 'auto' }}>
        {loading ? (
          <p style={{ color: s.gray500 }}>Loading...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: s.gray500 }}>No entries match the filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Detective</th>
                <th style={th}>Unit</th>
                <th style={th}>Notes</th>
                <th style={th}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id || e.entry_date + e.user_id}>
                  <td style={td}>{formatDate(e.entry_date)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{e.user_name}</td>
                  <td style={td}>
                    <span style={{
                      background: s.amberLight, color: s.navy, padding: '2px 8px',
                      borderRadius: 4, fontSize: 12, fontWeight: 600,
                    }}>{e.unit}</span>
                  </td>
                  <td style={{ ...td, maxWidth: 250, whiteSpace: 'normal', fontSize: 13, color: s.gray500 }}>
                    {e.notes || '—'}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: s.gray500 }}>
                    {e.submitted_at ? new Date(e.submitted_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
          <button onClick={handleExportWeekly} style={btnPrimary}>Export Weekly</button>
        )}
      </div>

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

function MonthlyReport({ detectives }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [generating, setGenerating] = useState(false)

  async function generateReport() {
    setGenerating(true)
    try {
      // Fetch all entries for the selected month from Supabase
      const entries = await fetchMonthEntries(month, year)

      // Send entries to the API which fills the real Excel template
      const res = await fetch('/api/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year, entries }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }

      // Download the returned xlsx file
      const blob = await res.blob()
      const fileName = `JCSO_Monthly_${MONTH_NAMES[month]}_${year}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error generating report: ' + err.message)
    }
    setGenerating(false)
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 16px', color: s.navy }}>Monthly XLSX Report</h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
        <button onClick={generateReport} disabled={generating} style={btnPrimary}>
          {generating ? 'Generating...' : 'Download XLSX'}
        </button>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 13, color: s.gray500 }}>
        Generates a report matching the existing Excel layout — Interdiction, Uniform, and UC sections
        with weekly breakdowns per detective, plus a Year Total sheet.
      </p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   11. SUPERVISOR VIEW — wraps all supervisor tabs
   ═══════════════════════════════════════════════════════════════════ */

function SupervisorView({ detectives }) {
  const [tab, setTab] = useState('dashboard')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'weekly', label: 'Weekly View' },
          { key: 'report', label: 'Monthly Report' },
        ].map(t => (
          <button key={t.key} style={btnTab(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <Dashboard detectives={detectives} />}
      {tab === 'weekly' && <WeeklyDetailView detectives={detectives} />}
      {tab === 'report' && <MonthlyReport detectives={detectives} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   12. APP — main component with auth and routing
   ═══════════════════════════════════════════════════════════════════ */

export default function App() {
  const [user, setUser] = useState(null)
  const [allUsers, setAllUsers] = useState([])

  // Restore session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('jcso_det_user')
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch {}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, opacity: 0.8 }}>{user.name}</span>
          <button onClick={handleLogout} style={{ ...btn, background: 'rgba(255,255,255,0.1)', color: s.white, padding: '6px 14px', fontSize: 13 }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        {isSupervisor
          ? <SupervisorView detectives={allUsers} />
          : <DetectiveView user={user} />
        }
      </main>
    </div>
  )
}
