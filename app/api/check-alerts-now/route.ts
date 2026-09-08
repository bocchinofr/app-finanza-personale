import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkAlertsForUser } from '@/lib/checkAlertsCore'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Check on-demand per l'utente loggato, chiamato dal bottone "Aggiorna prezzi".
// Richiede il token JWT dell'utente (non il CRON_SECRET) per evitare che un
// utente possa far scattare il check per altri.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Token mancante' }, { status: 401 })
  }

  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: userData, error: userErr } = await anon.auth.getUser(token)
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'Token non valido' }, { status: 401 })
  }

  const admin = createAdminClient()
  const result = await checkAlertsForUser(admin, userData.user.id)

  return NextResponse.json({ ok: true, ...result })
}
