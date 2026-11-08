import assert from 'node:assert/strict';
import { accountValues, adminAccountRequest } from '../server/admin-accounts.js';
import { requestNumberLabel } from '../src/request-number.js';

const owner = '11111111-1111-4111-8111-111111111111';
const staff = '22222222-2222-4222-8222-222222222222';
const fresh = '33333333-3333-4333-8333-333333333333';
const password = 'synthetic-test-only-passphrase';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key-no-real-access';
let mode = 'master', mutations = [], failPassword = false;
const members = { master_admin_users: [{ user_id: owner, email: 'master@example.test', active: true }], admin_users: [{ user_id: staff, email: 'restaurant@example.test', active: true }], room_admin_users: [], event_admin_users: [] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (url.pathname === '/auth/v1/user') return json({ id: mode === 'master' ? owner : staff, email: mode === 'master' ? 'master@example.test' : 'restaurant@example.test' });
  if (url.pathname === '/auth/v1/token') {
    if (failPassword) return json({ msg: 'Invalid login credentials', code: 'invalid_credentials' }, 400);
    const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'),'test'].join('.');
    return json({ access_token: token, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user: { id: owner, email: 'master@example.test' } });
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  if (url.pathname.startsWith('/auth/v1/admin/users')) {
    mutations.push({ path: url.pathname, method, body });
    return json({ id: method === 'POST' ? fresh : staff, email: body?.email || 'restaurant@example.test' });
  }
  const table = url.pathname.split('/').pop();
  if (url.pathname.startsWith('/rest/v1/')) {
    if (method !== 'GET') { mutations.push({ table, method, body }); return json(null); }
    let rows = members[table] || [];
    if (url.searchParams.has('user_id')) rows = rows.filter(row => row.user_id === url.searchParams.get('user_id').replace('eq.',''));
    const single = String(options.headers?.get?.('Accept') || options.headers?.Accept || '').includes('object');
    return json(single ? rows[0] || null : rows);
  }
  throw new Error(`Unexpected test request ${method} ${url.pathname}`);
};
const req = () => new Request('https://harlahotel.com/api/room-admin', { method: 'POST', headers: { Authorization: 'Bearer synthetic-test' } });
const values = { email: 'restaurant@harlahotel.com', confirmEmail: 'restaurant@harlahotel.com', password, confirmPassword: password, currentPassword: password, department: 'restaurant' };
try {
  assert.equal(accountValues(values, true).email, values.email);
  assert.throws(() => accountValues({ ...values, password: 'short', confirmPassword: 'short' }, true), /12/);
  assert.throws(() => accountValues({ ...values, confirmEmail: 'other@example.test' }), /match/);
  assert.equal(requestNumberLabel({ request_number: 1, request_series: 2 }), 'Request #1 · Series 2');
  assert.equal(requestNumberLabel({}), 'Earlier record');
  const guest = await adminAccountRequest(new Request('https://harlahotel.com'), { action: 'save_staff', ...values });
  assert.equal(guest.status, 403); assert.equal(mutations.length, 0);
  mode = 'staff';
  assert.equal((await adminAccountRequest(req(), { action: 'save_staff', ...values })).status, 403);
  assert.equal((await adminAccountRequest(req(), { action: 'staff' })).status, 403);
  assert.equal(mutations.length, 0);
  mode = 'master'; failPassword = true;
  assert.equal((await adminAccountRequest(req(), { action: 'save_staff', ...values })).status, 403);
  assert.equal(mutations.length, 0);
  failPassword = false;
  const create = await adminAccountRequest(req(), { action: 'save_staff', ...values });
  assert.equal(create.status, 200, await create.text());
  assert(mutations.some(m => m.table === 'admin_users' && m.method === 'POST' && m.body.user_id === fresh && m.body.role === 'admin'));
  assert(!mutations.some(m => ['master_admin_users','room_admin_users','event_admin_users'].includes(m.table) && m.method === 'POST'));
  const audit = mutations.find(m => m.table === 'admin_activity');
  assert(audit); assert(!JSON.stringify(audit).includes(password));
  mutations = [];
  const invalidTarget = await adminAccountRequest(req(), { action: 'save_staff', ...values, userId: owner });
  assert.equal(invalidTarget.status, 404); assert.equal(mutations.length, 0);
  const edit = await adminAccountRequest(req(), { action: 'save_staff', ...values, userId: staff });
  assert.equal(edit.status, 200, await edit.text());
  assert(mutations.some(m => m.method === 'PUT' && m.path.endsWith(staff)));
  mutations = [];
  members.admin_users.push({ user_id: owner, email: 'master@example.test', active: true });
  assert.equal((await adminAccountRequest(req(), { action: 'save_staff', ...values, userId: owner })).status, 403);
  assert.equal(mutations.length, 0);
  const self = await adminAccountRequest(req(), { action: 'save_self', ...values, email: 'new-master@example.test', confirmEmail: 'new-master@example.test' });
  assert.equal(self.status, 200); assert.equal((await self.json()).signOut, true);
  assert(mutations.some(m => m.method === 'PUT' && m.path.endsWith(owner)));
  console.log('Admin account checks passed: guest/staff denial, current-password verification, department isolation, account updates, password-free audit and numbering labels.');
} finally { globalThis.fetch = originalFetch; }
