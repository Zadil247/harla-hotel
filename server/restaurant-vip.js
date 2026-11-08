import { PublicError } from './errors.js';

export function normalizeVipRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicError('Enter your VIP request details.');
  const fullName = String(input.fullName || '').trim();
  const phone = String(input.phone || '').trim();
  if (!fullName || fullName.length > 160) throw new PublicError('Enter your name (up to 160 characters).');
  if (!/^[+\d][\d\s().-]{5,39}$/.test(phone) || phone.replace(/\D/g, '').length < 7) throw new PublicError('Enter a valid phone number so the restaurant can call you.');
  const guests = input.guests === '' || input.guests == null ? null : Number(input.guests);
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 999)) throw new PublicError('Enter a valid number of guests, or leave it blank.');
  const date = input.date || null, time = input.time || null;
  if ((date && typeof date !== 'string') || (time && typeof time !== 'string')) throw new PublicError('Choose a valid date and time, or leave them blank.');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new PublicError('Choose a valid date, or leave it blank.');
  if (date && date < new Date(Date.now() + 10800000).toISOString().slice(0, 10)) throw new PublicError('Choose today or a later date.');
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new PublicError('Choose a valid time, or leave it blank.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id || '')) throw new PublicError('Reload the request form and try again.');
  return { p_id: input.id, p_name: fullName, p_phone: phone, p_guests: guests, p_date: date, p_time: time };
}
export function vipError(error) {
  if (error.code === 'P0001') return new PublicError('The VIP room is occupied. Please call the restaurant on +251984977677.', 409, 'vip_occupied');
  if (error.code === '40001') return new PublicError('The VIP room or request changed. Refresh and try again.', 409);
  if (error.code === '42501') return new PublicError('Restaurant Admin access is required.', 403);
  if (error.code === '22023') return new PublicError('This action is no longer available for the VIP request. Refresh and try again.', 409);
  if (error.code === '23505') return new PublicError('That request reference was already used. Reload the form.', 409);
  if (error.code === 'P0002') return new PublicError('Please wait a minute before sending another VIP request.', 429);
  return error;
}
export async function vipAvailability(db) {
  const result = await db.from('restaurant_vip_room').select('status,version,updated_at').eq('id', 'default').single();
  if (result.error) throw result.error;
  return result.data;
}
export async function vipDashboard(db) {
  const [room, requests] = await Promise.all([
    db.from('restaurant_vip_room').select('*').eq('id', 'default').single(),
    db.from('restaurant_vip_requests').select('*').order('created_at', { ascending: false }).limit(300),
  ]);
  if (room.error || requests.error) throw room.error || requests.error;
  return { room: room.data, requests: requests.data };
}
export async function createVipRequest(db, input) {
  const result = await db.rpc('create_restaurant_vip_request', normalizeVipRequest(input));
  if (result.error) throw vipError(result.error);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  // Never expose guest contact information in the public receipt or availability response.
  return { reference: row.booking_reference, request_number: row.request_number, request_series: row.request_series };
}
export async function transitionVip(db, admin, body) {
  if (!['contact', 'decline', 'occupy', 'release'].includes(body.transition)) throw new PublicError('Choose a valid VIP room action.');
  if (!Number.isInteger(body.roomVersion) || body.roomVersion < 1) throw new PublicError('Refresh the VIP room status before continuing.', 409);
  if (body.id && !/^[0-9a-f-]{36}$/i.test(body.id)) throw new PublicError('Invalid VIP request.');
  if (body.id && (!Number.isInteger(body.version) || body.version < 1)) throw new PublicError('Refresh the VIP request before continuing.', 409);
  const result = await db.rpc('transition_restaurant_vip', { p_action: body.transition, p_request_id: body.id || null, p_expected_version: body.version || null, p_room_version: body.roomVersion, p_actor: admin.id });
  if (result.error) throw vipError(result.error);
  return { updated: true };
}
