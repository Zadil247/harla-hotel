import { createClient } from "@supabase/supabase-js";
import { requiredEnv } from "./config.js";

let adminClient;

export function getSupabaseAdmin(actorId = null) {
  if (actorId) return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { "x-harla-actor": actorId } },
  });
  if (!adminClient) {
    adminClient = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  }

  return adminClient;
}
