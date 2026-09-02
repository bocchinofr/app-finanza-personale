import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Client con service role key: bypassa la Row Level Security.
// Da usare SOLO in route handler server-side (app/api/...), MAI in componenti
// 'use client' né esposto al browser. La chiave va aggiunta su Vercel come
// variabile d'ambiente SUPABASE_SERVICE_ROLE_KEY (la trovi in Supabase →
// Project Settings → API → service_role secret).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
