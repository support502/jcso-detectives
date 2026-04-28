"""
Vercel serverless function: /api/ops_plans
CRUD for JCSO operational plans.

Actions: list, get, create, update, delete, submit, approve
"""
from http.server import BaseHTTPRequestHandler
import json, os, datetime, traceback


# ── Supabase client (lazy-init) ─────────────────────────────────────────────
_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        url = os.environ.get('SUPABASE_URL')
        key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        if not url or not key:
            raise RuntimeError(
                'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. '
                'Set them in Vercel project settings.'
            )
        _supabase = create_client(url, key)
    return _supabase


# ── Editable column whitelist ───────────────────────────────────────────────
# Fields the client may set on create/update. Server-managed fields
# (id, created_by, created_at, updated_at, status, supervisor_*) are
# excluded — they're set explicitly by the relevant actions.
EDITABLE_FIELDS = {
    'case_number', 'deconfliction', 'case_agent', 'operation_type',
    'city_county', 'briefing_datetime', 'operation_datetime',
    'background_info', 'synopsis',
    'briefing_address', 'briefing_city_state', 'briefing_zip', 'briefing_other',
    'operation_address', 'operation_city_state', 'operation_zip', 'operation_other',
    'suspects', 'residents', 'ci_uc_vehicles', 'personnel',
    'uc_arrest_signal', 'uc_no_response', 'uc_full_response',
    'uc_audible', 'uc_visual',
    'comms_radios', 'comms_channels', 'comms_cell_phones', 'comms_other',
    'monitoring_callyo', 'monitoring_1021',
    'monitoring_active', 'monitoring_active_channel',
    'agent_ci_contacts',
    'arrest_tbd', 'arrest_anticipated', 'arrest_charge',
    'arrest_not_anticipated', 'arrest_other',
    'medical_name', 'medical_address', 'medical_city_state',
    'medical_zip', 'medical_phone',
    'captain', 'lt_sergeant', 'contact_numbers',
    'media_contact_1', 'media_contact_2',
}


def _filter_editable(data):
    """Strip any keys not in the editable whitelist."""
    return {k: v for k, v in (data or {}).items() if k in EDITABLE_FIELDS}


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# ── Action handlers ─────────────────────────────────────────────────────────

def action_list(body):
    """List all ops_plans, newest first, with creator name joined in."""
    sb = get_supabase()

    plans_resp = sb.table('ops_plans') \
        .select('*') \
        .order('created_at', desc=True) \
        .execute()

    plans = plans_resp.data or []
    if not plans:
        return []

    # Resolve creator names in one query
    creator_ids = list({p['created_by'] for p in plans if p.get('created_by')})
    name_map = {}
    if creator_ids:
        users_resp = sb.table('det_users') \
            .select('id, name') \
            .in_('id', creator_ids) \
            .execute()
        name_map = {u['id']: u['name'] for u in (users_resp.data or [])}

    for p in plans:
        p['created_by_name'] = name_map.get(p.get('created_by'))

    return plans


def action_get(body):
    """Fetch a single plan by id."""
    sb = get_supabase()
    plan_id = body.get('id')
    if not plan_id:
        raise ValueError('Missing "id" field')

    resp = sb.table('ops_plans') \
        .select('*') \
        .eq('id', plan_id) \
        .limit(1) \
        .execute()

    rows = resp.data or []
    if not rows:
        raise ValueError(f'Plan not found: {plan_id}')

    plan = rows[0]
    if plan.get('created_by'):
        u = sb.table('det_users') \
            .select('name') \
            .eq('id', plan['created_by']) \
            .limit(1) \
            .execute()
        if u.data:
            plan['created_by_name'] = u.data[0]['name']

    return plan


def action_create(body):
    """Insert a new draft plan owned by created_by."""
    sb = get_supabase()
    created_by = body.get('created_by')
    if not created_by:
        raise ValueError('Missing "created_by" field')

    payload = _filter_editable(body.get('data'))
    payload['created_by'] = created_by
    payload['status'] = 'draft'

    resp = sb.table('ops_plans').insert(payload).execute()
    rows = resp.data or []
    if not rows:
        raise RuntimeError('Insert returned no rows')
    return rows[0]


def action_update(body):
    """Update editable fields on an existing plan; bumps updated_at."""
    sb = get_supabase()
    plan_id = body.get('id')
    if not plan_id:
        raise ValueError('Missing "id" field')

    payload = _filter_editable(body.get('data'))
    if not payload:
        raise ValueError('No editable fields supplied in "data"')
    payload['updated_at'] = _now_iso()

    resp = sb.table('ops_plans') \
        .update(payload) \
        .eq('id', plan_id) \
        .execute()

    rows = resp.data or []
    if not rows:
        raise ValueError(f'Plan not found or update affected 0 rows: {plan_id}')
    return rows[0]


def action_delete(body):
    """Hard-delete a plan, but only if status='draft'."""
    sb = get_supabase()
    plan_id = body.get('id')
    if not plan_id:
        raise ValueError('Missing "id" field')

    # Verify status before deleting
    check = sb.table('ops_plans') \
        .select('id, status') \
        .eq('id', plan_id) \
        .limit(1) \
        .execute()

    rows = check.data or []
    if not rows:
        raise ValueError(f'Plan not found: {plan_id}')
    if rows[0]['status'] != 'draft':
        raise ValueError(
            f"Cannot delete plan {plan_id}: status is "
            f"'{rows[0]['status']}', only 'draft' may be deleted"
        )

    sb.table('ops_plans').delete().eq('id', plan_id).execute()
    return {'deleted': plan_id}


def action_submit(body):
    """Mark plan as submitted."""
    sb = get_supabase()
    plan_id = body.get('id')
    if not plan_id:
        raise ValueError('Missing "id" field')

    resp = sb.table('ops_plans') \
        .update({'status': 'submitted', 'updated_at': _now_iso()}) \
        .eq('id', plan_id) \
        .execute()

    rows = resp.data or []
    if not rows:
        raise ValueError(f'Plan not found: {plan_id}')
    return rows[0]


def action_approve(body):
    """Approve a plan: set supervisor signature, rank, signed_at, status."""
    sb = get_supabase()
    plan_id = body.get('id')
    if not plan_id:
        raise ValueError('Missing "id" field')

    signature = body.get('supervisor_signature')
    rank = body.get('supervisor_rank')
    if not signature:
        raise ValueError('Missing "supervisor_signature" field')
    if not rank:
        raise ValueError('Missing "supervisor_rank" field')

    now = _now_iso()
    resp = sb.table('ops_plans').update({
        'status': 'approved',
        'supervisor_signature': signature,
        'supervisor_signed_at': now,
        'supervisor_rank': rank,
        'updated_at': now,
    }).eq('id', plan_id).execute()

    rows = resp.data or []
    if not rows:
        raise ValueError(f'Plan not found: {plan_id}')
    return rows[0]


# ── HTTP helpers ────────────────────────────────────────────────────────────

def _cors_headers(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    h.send_header('Access-Control-Allow-Headers', 'Content-Type')


def _json_response(h, status, data):
    h.send_response(status)
    h.send_header('Content-Type', 'application/json')
    _cors_headers(h)
    h.end_headers()
    h.wfile.write(json.dumps(data, default=str).encode())


# ── Handler ─────────────────────────────────────────────────────────────────

ACTIONS = {
    'list': action_list,
    'get': action_get,
    'create': action_create,
    'update': action_update,
    'delete': action_delete,
    'submit': action_submit,
    'approve': action_approve,
}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}

            action = body.get('action')
            if not action:
                _json_response(self, 400, {'error': 'Missing "action" field'})
                return

            fn = ACTIONS.get(action)
            if not fn:
                _json_response(self, 400, {'error': f'Unknown action: {action}'})
                return

            result = fn(body)
            _json_response(self, 200, result)

        except ValueError as exc:
            print(f'[ops_plans] BAD REQUEST: {exc}')
            _json_response(self, 400, {'error': str(exc)})

        except Exception as exc:
            tb = traceback.format_exc()
            print(f'[ops_plans] ERROR: {tb}')
            _json_response(self, 500, {'error': str(exc), 'traceback': tb})

    def do_OPTIONS(self):
        self.send_response(200)
        _cors_headers(self)
        self.end_headers()
