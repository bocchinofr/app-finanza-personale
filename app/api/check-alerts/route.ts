import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkAlertsForUser } from '@/lib/checkAlertsCore'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: soglieData, error: soglieErr } = await admin
    .from('alert_soglie')
    .select('user_id')
    .eq('attivo', true)
  if (soglieErr) {
    return NextResponse.json({ error: soglieErr.message }, { status: 500 })
  }
  const userIds = [...new Set((soglieData ?? []).map((s: { user_id: string }) => s.user_id))]

  let notifiche = 0
  for (const userId of userIds) {
    const result = await checkAlertsForUser(admin, userId)
    notifiche += result.nuoveNotifiche
  }

  return NextResponse.json({ ok: true, utentiControllati: userIds.length, notifiche })
}
