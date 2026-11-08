import {getSupabaseClient} from './supabase-client.js';
export async function restaurantRequest(action,payload={},admin=false) {
  const headers={'Content-Type':'application/json'};
  if(admin) {
    const db=await getSupabaseClient();
    const {data,error}=await db.auth.getSession();
    if(error) throw error;
    if(!data.session) throw Object.assign(new Error('Please sign in.'),{status:403});
    headers.Authorization=`Bearer ${data.session.access_token}`;
  }
  const response=await fetch('/api/restaurant',{method:'POST',headers,body:JSON.stringify({action,...payload})});
  const result=await response.json();
  if(!response.ok) throw Object.assign(new Error(result.error||'Request failed.'),{status:response.status});
  return result;
}
