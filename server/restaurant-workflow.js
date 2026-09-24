import { restaurantMenuItems } from '../src/restaurant-menu-data.js';
import { PublicError } from './errors.js';

const menu = new Map(restaurantMenuItems.map(item => [item.id, item]));
const methods = new Set(['CBE', 'Telebirr', 'E-Birr', 'cash_at_hotel']);
function text(value, label, max = 160) {
  const clean = String(value ?? '').trim();
  if (!clean || clean.length > max) throw new PublicError(`Enter a valid ${label}.`);
  return clean;
}
export function normalizeRestaurantOrder(input = {}) {
  if (!input || typeof input !== 'object') throw new PublicError('Enter valid order details.');
  if (!/^HRL-[0-9a-f]{32}$/i.test(input.orderNumber || '')) throw new PublicError('Invalid order reference. Reload and try again.');
  const orderType = text(input.orderType, 'order type');
  if (!['Dine In', 'Take Away', 'Delivery'].includes(orderType)) throw new PublicError('Choose a valid order type.');
  const paymentMethod = text(input.paymentMethod, 'payment method');
  if (!methods.has(paymentMethod) || (paymentMethod === 'cash_at_hotel' && orderType !== 'Dine In')) throw new PublicError('Choose a valid payment method.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new PublicError('Select at least one menu item.');
  if (input.pastryItems?.length) throw new PublicError('Please select pastries from the current menu.');
  const seen = new Set();
  const items = input.items.map(value => {
    if (!value || typeof value !== 'object') throw new PublicError('A menu item is invalid. Refresh the menu.');
    const item = menu.get(value.id);
    if (!item || seen.has(value.id)) throw new PublicError('A menu item is invalid. Refresh the menu.');
    seen.add(value.id);
    if (!Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 50) throw new PublicError('Item quantities must be between 1 and 50.');
    return { id:item.id, name:item.name, category:item.category, price:item.price, quantity:value.quantity,
      line_total: Math.round(item.price * 100) * value.quantity / 100 };
  });
  const phone = text(input.phone, 'phone number', 40);
  if (!/^\+?[\d\s()-]{7,40}$/.test(phone) || phone.replace(/\D/g,'').length < 7) throw new PublicError('Enter a valid phone number.');
  const addressArea = orderType === 'Delivery' ? text(input.addressArea, 'delivery area') : null;
  const customAddress = orderType === 'Delivery' ? String(input.customAddress || '').trim().slice(0,500) : null;
  if (addressArea === 'Other' && !customAddress) throw new PublicError('Enter your delivery address.');
  if (paymentMethod !== 'cash_at_hotel' && !input.paymentScreenshot?.data) throw new PublicError('Upload your payment screenshot before submitting.');
  return {order_number:input.orderNumber, customer_name:text(input.customerName,'name'), phone,
    order_type:orderType, address_area:addressArea, custom_address:customAddress, items, pastry_items:[],
    payment_method:paymentMethod, payment_reference:String(input.paymentReference || '').trim().slice(0,160),
    payment_status:paymentMethod === 'cash_at_hotel' ? 'pay_at_hotel' : 'submitted_for_verification',
    status:'pending', odoo_status:'not_entered'};
}
export function restaurantTransition(order, action) {
  if (action === 'approve' && order.status === 'pending') return {status:'approved', approved_at:new Date().toISOString()};
  if (action === 'decline' && order.status === 'pending') return {status:'declined', declined_at:new Date().toISOString()};
  if (action === 'kitchen' && order.status === 'approved' && order.odoo_status === 'not_entered') return {odoo_status:'entered',odoo_entered_at:new Date().toISOString()};
  throw new PublicError('This order has changed or the action is not available. Refresh and try again.',409);
}
