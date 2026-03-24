# JCSO Detective MicroManager

Weekly activity reporting app for JCSO Narcotics division.

## Stack
- **Frontend**: React + Vite (JSX, inline styles)
- **Backend**: Supabase (Postgres + auth)
- **Hosting**: Vercel (static frontend + Python serverless functions)
- **Excel generation**: openpyxl (Python, server-side) — SheetJS was removed

## Supabase Tables

### `det_users`
`id, name, unit, pin, role`
Seeded with 13 users, all PIN `1234`.

### `det_entries`
`id, user_id, user_name, unit, entry_date, week_start, month, year, notes, case_numbers, stats (jsonb), submitted_at`
Unique constraint on `(user_id, entry_date)`. Upserted on save.

## Users by Unit
| Unit | Detectives |
|------|-----------|
| UC | Colton Lowe, Layne Verdine, Ryan Golmon, Matthew Flowers |
| Uniform | Brian Chowns, Scott Weaver, Tamara Spikes, William Crain |
| Interdiction | Jake Droddy, Brigitte Morse |
| Supervisor | Caleb Mitchell, Ryan Hargrove, Andy Jones |

## Auth
Name dropdown + PIN looked up from `det_users`. Session stored in `localStorage`.

## Detective View
- Week navigator with prev/next arrows; 7 day tabs (Sun–Sat) defaulting to today
- Daily entry form with unit-specific stat fields
- Upserts on `(user_id, entry_date)` — edit any past day freely
- History tab showing entries grouped by week with totals row

## Supervisor View
- **Dashboard**: all entries filterable by unit / detective / month / year
- **Weekly View**: Export Weekly button → POST to `/api/weekly` → fills `2026 Uniform Weekly.xlsx` or `Blank Narc Weekly.xlsx` template (Interdiction generated from scratch)
- **Monthly Report**: POST to `/api/monthly` → fills `Monthly Uniform 2025 new.xlsx` template, including Year Total sheet

## Python API (`api/`)
- `api/weekly.py` — fills weekly Excel templates via openpyxl. Totals in row 26 computed server-side in Python (never rely on Excel formula cache). Dates written explicitly to all 7 day rows.
- `api/monthly.py` — fills monthly template. Accepts `unit` param ("Uniform" or "UC") to select template. Accumulates unit totals in Python dicts while writing week rows; writes those totals directly to Year Total sheet. **Never read back from formula cells.**
- `api/requirements.txt`: `openpyxl==3.1.5`
- `vercel.json` includes `"includeFiles": "templates/**"` to bundle templates with the function

## Templates (`templates/`)
Read-only. Never modify these files — openpyxl loads them as base and fills data on top.
- `2026 Uniform Weekly.xlsx`
- `Blank Narc Weekly.xlsx`
- `Monthly Uniform 2025 new.xlsx`
- `Monthly UC 2025 new.xlsx`

## Deployment
**URL**: jcso-detectives.vercel.app

## TODO
- (none)
