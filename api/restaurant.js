import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { requestingAdmin } from '../server/admin-auth.js';
import { getSupabaseAdmin } from '../server/supabase-admin.js';
import { PublicError } from '../server/errors.js';
import { normalizeRestaurantOrder, restaurantTransition } from '../server/restaurant-workflow.js';

const bucket = 'payment-screenshots';
const reply = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function settings(db) {
  const {data,error}=await db.from('restaurant_settings').select('ordering_available,custom_message').eq('id','default').single();
  if(error) throw error;
  return data;
}
async function paymentImage(input) {
  if (!input || typeof input.data !== 'string' || input.data.length > 4200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new PublicError('Upload a JPEG, PNG or WebP payment image up to 3 MB.');
  const bytes=Buffer.from(input.data,'base64');
  if(!bytes.length || bytes.length>3*1024*1024) throw new PublicError('Payment screenshots must be between 1 byte and 3 MB.');
  try {
    const result=await sharp(bytes,{limitInputPixels:24000000,animated:false}).metadata();
    if(!['jpeg','png','webp'].includes(result.format)) throw Error('Unsupported image');
    return await sharp(bytes,{limitInputPixels:24000000}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
  } catch {throw new PublicError('This payment image could not be read. Choose a JPEG, PNG or WebP file.');}
}
export default {async fetch(request) {
  if(request.method!=='POST') return reply({error:'Method not allowed.'},405);
  try {
    if(!(request.headers.get('content-type')||'').includes('application/json')) throw new PublicError('JSON required.',415);
    const raw=await request.text();
    if(raw.length>4400000) throw new PublicError('Request is too large.',413);
    let body;try {body=JSON.parse(raw);} catch {throw new PublicError('Invalid JSON.');}
    if(!body || typeof body!=='object') throw new PublicError('Invalid request.');
    let db=getSupabaseAdmin();
    if(body.action==='settings') return reply({settings:await settings(db)});
    if(body.action==='create') {
      const order=normalizeRestaurantOrder(body.order);
      const current=await settings(db);
      if(!current.ordering_available) throw new PublicError(current.custom_message || 'Restaurant ordering is currently unavailable.',409);
      // A random client reference makes retries safe without revealing existing customer details.
      const existing=await db.from('restaurant_orders').select('order_number').eq('order_number',order.order_number).maybeSingle();
      if(existing.error) throw existing.error;
      if(existing.data) return reply({order:{order_number:order.order_number,status:'pending'}});
      let path=null;
      if(order.payment_method!=='cash_at_hotel') {
        const bytes=await paymentImage(body.order.paymentScreenshot);
        path=`restaurant-orders/${order.order_number}/${randomUUID()}.jpg`;
        const uploaded=await db.storage.from(bucket).upload(path,bytes,{contentType:'image/jpeg',upsert:false});
        if(uploaded.error) throw uploaded.error;
      }
      const result=await db.from('restaurant_orders').insert({...order,payment_screenshot_url:path});
      if(result.error) {
        if(path) await db.storage.from(bucket).remove([path]);
        if(result.error.code!=='23505') throw result.error;
      }
      return reply({order:{order_number:order.order_number,status:'pending'}},201);
    }
    const admin=await requestingAdmin(db,request);
    if(!admin) return reply({error:'Active Harla Restaurant Admin access is required.'},403);
    db=getSupabaseAdmin(admin.id);
    if(body.action==='profile') return reply({authorized:true});
    if(body.action==='dashboard') {
      const result=await db.from('restaurant_orders').select('*').order('created_at',{ascending:false}).limit(300);
      if(result.error) throw result.error;
      return reply({orders:result.data,settings:await settings(db)});
    }
    if(body.action==='settings_update') {
      if(typeof body.available!=='boolean') throw new PublicError('Choose an ordering status.');
      const result=await db.from('restaurant_settings').update({ordering_available:body.available,custom_message:String(body.message||'').slice(0,300)}).eq('id','default').select('id').single();
      if(result.error) throw result.error;
      return reply({updated:true});
    }
    if(['transition','proof'].includes(body.action)) {
      const found=await db.from('restaurant_orders').select('*').eq('id',String(body.id||'')).maybeSingle();
      if(found.error) throw found.error;
      if(!found.data) throw new PublicError('Order not found.',404);
      if(body.action==='proof') {
        const path=found.data.payment_screenshot_url;
        if(!path || /^https?:/i.test(path)) throw new PublicError('No private payment screenshot is available.',404);
        const signed=await db.storage.from(bucket).createSignedUrl(path,120);
        if(signed.error) throw signed.error;
        return reply({url:signed.data.signedUrl});
      }
      if(!body.updatedAt || body.updatedAt!==found.data.updated_at) throw new PublicError('This order changed. Refresh and try again.',409);
      const values=restaurantTransition(found.data,body.transition);
      const result=await db.from('restaurant_orders').update(values).eq('id',found.data.id).eq('updated_at',body.updatedAt).select('id').maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) throw new PublicError('This order changed. Refresh and try again.',409);
      return reply({updated:true});
    }
    throw new PublicError('Choose a valid restaurant action.');
  } catch(error) {
    if(error instanceof PublicError) return reply({error:error.message},error.status);
    console.error('Restaurant API failed',{code:error.code||'restaurant_error',message:error.message});
    return reply({error:'The restaurant service is temporarily unavailable. Please try again.'},503);
  }
}};
