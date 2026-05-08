import { isSupabaseConfigured, supabaseConfig, supabaseSetupMessage } from "./supabase-config.js?v=20260507-supabase";

let clientPromise;

export function hasSupabaseClient() {
  return isSupabaseConfigured();
}

export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(supabaseSetupMessage());
  }

  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) =>
      createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }),
    );
  }

  return clientPromise;
}
