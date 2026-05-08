// Supabase configuration for Harla Hotel.
// REPLACE: Prefer VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env when using Vite.
// For this current static site, you can also define window.HARLA_SUPABASE_CONFIG before the module scripts:
// window.HARLA_SUPABASE_CONFIG = { url: "https://PROJECT.supabase.co", anonKey: "PUBLIC_ANON_KEY" };

const viteEnv = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
const staticConfig = typeof window !== "undefined" ? window.HARLA_SUPABASE_CONFIG || {} : {};

export const supabaseConfig = {
  url:
    viteEnv.VITE_SUPABASE_URL ||
    viteEnv.NEXT_PUBLIC_SUPABASE_URL ||
    staticConfig.url ||
    "https://lzgzkpkpotaxjqqaigdh.supabase.co ",
  anonKey:
    viteEnv.VITE_SUPABASE_ANON_KEY ||
    viteEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    staticConfig.anonKey ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6Z3prcGtwb3RheGpxcWFpZ2RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNTY4NTEsImV4cCI6MjA5MzczMjg1MX0.lDMCbutYq6TGR_nQCpzFl58GwW_OsKS3Dl5nPn27JmQ",
};

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

export function supabaseSetupMessage() {
  return "Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or set window.HARLA_SUPABASE_CONFIG for the static site.";
}
