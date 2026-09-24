import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { requiredEnv } from './config.js';
import { requestingMasterAdmin, requestingRoomAdmin, requestingEventAdmin, requestingAdmin } from './admin-auth.js';

export const staffDepartments = {
  restaurant: { table: 'admin_users', role: 'admin', label: 'Restaurant' },
  rooms: { table: 'room_admin_users', role: 'room_admin', label: 'Rooms' },
  events: { table: 'event_admin_users', role: 'event_manager', label: 'Events' },
};
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const checked = result => { if (result.error) throw result.error; return result.data; };

export function accountValues(body, creating = false) {
  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid login email.');
  if (email !== String(body.confirmEmail || '').trim().toLowerCase()) fail('The two email addresses must match.');
  const password = String(body.password || '');
  if ((creating || password) && (password.length < 12 || password.length > 128)) fail('Use a password with 12–128 characters.');
  if (password !== String(body.confirmPassword || '')) fail('The two new passwords must match.');
  return { email, ...(password ? { password } : {}) };
}

async function verifyPassword(admin, password) {
  if (typeof password !== 'string' || !password || password.length > 1024) fail('Enter your current password.', 400);
  // A separate client prevents a staff-management request replacing the server client session.
  const auth = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const result = await auth.auth.signInWithPassword({ email: admin.email, password });
  if (result.error || result.data.user?.id !== admin.id) fail('Your current password could not be verified.', 403);
  await auth.auth.signOut({ scope: 'local' });
}

export async function staffAccounts(db) {
  const groups = await Promise.all(Object.entries(staffDepartments).map(async ([department, config]) => {
    const rows = checked(await db.from(config.table).select('user_id,email,full_name,active').order('created_at'));
    return { department, label: config.label, accounts: await Promise.all(rows.map(async row => {
      const user = checked(await db.auth.admin.getUserById(row.user_id)).user;
      const master = checked(await db.from('master_admin_users').select('user_id').eq('user_id', row.user_id).eq('active', true).maybeSingle());
      return { ...row, email: user.email, master: Boolean(master) };
    })) };
  }));
  return groups;
}

async function authorize(db, request) {
  return await requestingMasterAdmin(db, request) || await requestingRoomAdmin(db, request)
    || await requestingEventAdmin(db, request) || await requestingAdmin(db, request);
}

export async function adminAccountRequest(request, body) {
  const db = getSupabaseAdmin();
  try {
    const admin = await authorize(db, request);
    if (!admin) return reply({ error: 'An active hotel staff login is required.' }, 403);
    if (body.action === 'profile') return reply({ email: admin.email, master: Boolean(admin.masterAdmin) });
    if (body.action === 'staff') {
      if (!admin.masterAdmin) return reply({ error: 'Master Admin access is required.' }, 403);
      return reply({ departments: await staffAccounts(db) });
    }
    if (!['save_self', 'save_staff'].includes(body.action)) return reply({ error: 'Choose a valid account action.' }, 400);
    if (body.action === 'save_staff' && !admin.masterAdmin) return reply({ error: 'Master Admin access is required.' }, 403);
    const values = accountValues(body, body.action === 'save_staff' && !body.userId);
    const department = staffDepartments[body.department];
    if (body.action === 'save_staff' && !department) fail('Choose a staff department.');
    await verifyPassword(admin, body.currentPassword);

    let target = admin.id;
    if (body.action === 'save_staff') {
      if (body.userId) {
        const member = checked(await db.from(department.table).select('user_id').eq('user_id', body.userId).maybeSingle());
        if (!member) fail('This staff account was not found.', 404);
        const master = checked(await db.from('master_admin_users').select('user_id').eq('user_id', body.userId).maybeSingle());
        if (master) fail('A management account must be changed from its own Account Settings.', 403);
        target = member.user_id;
      } else {
        const created = await db.auth.admin.createUser({ ...values, email_confirm: true });
        if (created.error) fail(created.error.code === 'email_exists' ? 'That email already has an account. Edit its existing login.' : 'The staff login could not be created. Check the email and password requirements.', 400);
        target = created.data.user.id;
        const member = await db.from(department.table).insert({ user_id: target, email: values.email, full_name: `${department.label} Team`, role: department.role, active: true });
        if (member.error) {
          // Remove only the new, unassigned auth user from this failed setup.
          await db.auth.admin.deleteUser(target);
          throw member.error;
        }
      }
    }
    if (body.action === 'save_self' || body.userId) {
      const updated = await db.auth.admin.updateUserById(target, { ...values, email_confirm: true });
      if (updated.error) fail('The login could not be updated. That email may already be in use, or the password may not meet security requirements.');
    }
    // Membership IDs determine access; emails here are display/contact copies only.
    for (const table of ['admin_users', 'room_admin_users', 'event_admin_users', 'master_admin_users']) {
      const result = await db.from(table).update({ email: values.email }).eq('user_id', target);
      if (result.error) console.error('Staff email display sync failed', { table, code: result.error.code });
    }
    const audit = await db.from('admin_activity').insert({ service: 'Staff access', record_id: target, reference: values.email,
      action: body.action === 'save_staff' && !body.userId ? 'account_created' : 'credentials_changed',
      actor_id: admin.id, actor_email: admin.email, details: { department: body.department || 'self', password_changed: Boolean(values.password) } });
    if (audit.error) console.error('Staff account saved but audit failed', { code: audit.error.code });
    return reply({ saved: true, email: values.email, signOut: body.action === 'save_self', warning: audit.error ? 'Login saved, but the activity entry could not be recorded.' : null });
  } catch (error) {
    // Never log request bodies, passwords, or auth responses.
    console.error('Admin account action failed', { action: body.action, code: error.code || error.status || 'account_error' });
    return reply({ error: error.status ? error.message : 'Account settings could not be saved. Please try again.' }, error.status || 503);
  }
}
