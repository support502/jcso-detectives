"""
Vercel serverless function: /api/monthly
Accepts POST JSON with month, year, and all entries for that month.
Opens the monthly Excel template, fills the correct month sheet, returns .xlsx.
"""
from http.server import BaseHTTPRequestHandler
import json, os, io, datetime
from openpyxl import load_workbook

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'templates', 'Monthly Uniform 2025 new.xlsx'
)

# ── Sheet names in the template (index 0–11 = Jan–Dec, 12 = Year Total) ──
SHEET_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

# ═══════════════════════════════════════════════════════════════════════════
# CELL MAPPINGS — derived from studying the template
# Each detective → (name_row, week1_row … week5_row)
# The template already has SUM formulas in the total rows — we never touch those.
# ═══════════════════════════════════════════════════════════════════════════

# ── INTERDICTION section (rows 10–24) ──
# Stats columns B–L:
INTER_STAT_COLS = {
    'B': 'hours_worked',
    'C': 'drug_seizures',
    'D': 'criminal_seizures',
    'E': 'currency_seizures',
    'F': 'training_hours',
    'G': 'vehicle_searches',
    'H': 'assist_narc_ops',
    'I': 'traffic_stops',
    'J': 'warrant_arrests',
    'K': 'pc_arrests',
    'L': 'agency_assist',
}
# Drug seizure columns N–T:
INTER_DRUG_COLS = {
    'N': 'meth_g',
    'O': 'cocaine_g',
    'P': 'heroin_g',
    'Q': 'fentanyl_g',
    'R': 'marijuana_oz',
    'S': 'promethazine_codeine_oz',
    'T': 'rx_pills',
}

# Detective name → (week_rows for stats B–L, week_rows for drugs N–T)
# Both sets share the same row offsets from the name row
INTER_DETECTIVES = {
    'Jake Droddy':    {'stat_weeks': [11, 12, 13, 14, 15], 'drug_weeks': [11, 12, 13, 14, 15]},
    'Brigitte Morse': {'stat_weeks': [18, 19, 20, 21, 22], 'drug_weeks': [18, 19, 20, 21, 22]},
}

# ── UNIFORM section (rows 27–55) ──
# Stats columns B–L:
UNI_STAT_COLS = {
    'B': 'hours_worked',
    'C': 'time_off',
    'D': 'k9_deploy',
    'E': 'tno_cases',
    'F': 'training_hours',
    'G': 'surv_hours',
    'H': 'patrol_jail_cases',
    'I': 'traffic_stops',
    'J': 'warrant_arrests',
    'K': 'agency_assist',
    'L': 'supp_reports',
}

# Drug seizure columns N–T for Uniform detectives (right side of sheet):
# These use different rows than the stat columns
UNI_DETECTIVES = {
    'Scott Weaver':  {'stat_weeks': [28, 29, 30, 31, 32], 'drug_weeks': [25, 26, 27, 28, 29]},
    'Brian Chowns':  {'stat_weeks': [35, 36, 37, 38, 39], 'drug_weeks': [32, 33, 34, 35, 36]},
    'William Crain': {'stat_weeks': [42, 43, 44, 45, 46], 'drug_weeks': [39, 40, 41, 42, 43]},
    'Tamara Spikes': {'stat_weeks': [49, 50, 51, 52, 53], 'drug_weeks': [46, 47, 48, 49, 50]},
}


def get_week_start(date_str):
    """Return the Sunday that starts the week containing date_str."""
    d = datetime.date.fromisoformat(date_str)
    return d - datetime.timedelta(days=d.weekday() + 1 if d.weekday() != 6 else 0)


def get_week_starts_for_month(month, year):
    """
    Return up to 5 week-start Sundays that overlap with the given month.
    Ordered chronologically — index 0 = Week 1.
    """
    first = datetime.date(year, month, 1)
    # Sunday on or before the 1st
    start = first - datetime.timedelta(days=(first.weekday() + 1) % 7)
    last_day = (datetime.date(year, month % 12 + 1, 1) if month < 12
                else datetime.date(year + 1, 1, 1)) - datetime.timedelta(days=1)
    weeks = []
    current = start
    while len(weeks) < 6:
        week_end = current + datetime.timedelta(days=6)
        # Include if any day of this week falls in the target month
        if (current.month == month and current.year == year) or \
           (week_end.month == month and week_end.year == year):
            weeks.append(current.isoformat())
        current += datetime.timedelta(days=7)
        if current > last_day + datetime.timedelta(days=7):
            break
    return weeks[:5]


def fill_monthly(month, year, entries):
    """
    Fill the correct month sheet in the template with entry data.
    Returns BytesIO containing the completed .xlsx.
    """
    wb = load_workbook(TEMPLATE_PATH)
    sheet_name = SHEET_NAMES[month - 1]
    ws = wb[sheet_name]

    week_starts = get_week_starts_for_month(month, year)

    # Build lookup: (user_name, week_start_str) → list of entries
    week_entries = {}
    for e in entries:
        ws_key = e.get('week_start', get_week_start(e['entry_date']).isoformat())
        key = (e['user_name'], ws_key)
        week_entries.setdefault(key, []).append(e)

    def sum_stats(entry_list, key):
        """Sum a single stat key across a list of entries."""
        total = 0
        for e in entry_list:
            val = e.get('stats', {}).get(key)
            if val not in (None, '', '0'):
                try:
                    total += float(val)
                except (ValueError, TypeError):
                    pass
        return total if total else None

    def fill_detective(det_name, det_config, stat_cols, drug_cols=None):
        """Fill week rows for one detective."""
        for wi, ws_str in enumerate(week_starts):
            if wi >= 5:
                break
            elist = week_entries.get((det_name, ws_str), [])

            # Fill stat columns
            stat_row = det_config['stat_weeks'][wi]
            for col_letter, stat_key in stat_cols.items():
                val = sum_stats(elist, stat_key)
                if val is not None:
                    ws[f'{col_letter}{stat_row}'] = val

            # Fill drug seizure columns (if applicable)
            if drug_cols:
                drug_row = det_config['drug_weeks'][wi]
                for col_letter, stat_key in drug_cols.items():
                    val = sum_stats(elist, stat_key)
                    if val is not None:
                        ws[f'{col_letter}{drug_row}'] = val

    # ── Fill Interdiction detectives ──
    for det_name, config in INTER_DETECTIVES.items():
        fill_detective(det_name, config, INTER_STAT_COLS, INTER_DRUG_COLS)

    # ── Fill Uniform detectives ──
    for det_name, config in UNI_DETECTIVES.items():
        fill_detective(det_name, config, UNI_STAT_COLS, INTER_DRUG_COLS)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))

            month = int(body['month'])
            year = int(body['year'])
            entries = body.get('entries', [])

            output = fill_monthly(month, year, entries)

            month_names = [
                '', 'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December',
            ]
            filename = f'JCSO_Monthly_{month_names[month]}_{year}.xlsx'

            self.send_response(200)
            self.send_header('Content-Type',
                             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(output.read())

        except Exception as exc:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
