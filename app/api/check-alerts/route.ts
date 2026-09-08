import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { fetchQuote } from '@/lib/fetchQuote'
import { sendAlertEmail } from '@/lib/sendEmail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface AssetRow {
  id: string
  ticker: string | null
  nome: string | null
  descrizione: string | null
}
interface SogliaRow {
  id: string
  user_id: string
  portafoglio_id: string
  tipo: 'storico' | 'mensile' | 'acquisto'
  soglia_pct: number
  attivo: boolean
  in_breach: boolean
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // 1. Tutte le soglie attive, raggruppate per utente
  const { data: soglieData, error: soglieErr } = await supabase
    .from('alert_soglie')
    .select('*')
    .eq('attivo', true)
  if (soglieErr) {
    return NextResponse.json({ error: soglieErr.message }, { status: 500 })
  }
  const soglie = (soglieData as SogliaRow[]) ?? []
  if (soglie.length === 0) {
    return NextResponse.json({ ok: true, utentiControllati: 0, notifiche: 0 })
  }

  const userIds = [...new Set(soglie.map(s => s.user_id))]
  let notificheInviate = 0

  for (const userId of userIds) {
    const soglieUtente = soglie.filter(s => s.user_id === userId)
    const portafoglioIds = [...new Set(soglieUtente.map(s => s.portafoglio_id))]

    const { data: assetsData } = await supabase
      .from('portafoglio')
      .select('id, ticker, nome, descrizione')
      .in('id', portafoglioIds)
    const assets = (assetsData as AssetRow[]) ?? []
    const tickers = [...new Set(assets.map(a => a.ticker).filter(Boolean) as string[])]
    if (tickers.length === 0) continue

    const quotesEntries = await Promise.all(
      tickers.map(async t => [t, await fetchQuote(t)] as const)
    )
    const quotes = Object.fromEntries(quotesEntries.filter(([, q]) => q))

    const updates: { id: string; in_breach: boolean; ultima_notifica_at?: string }[] = []
    const nuoveNotifiche: { user_id: string; portafoglio_id: string; tipo: string; messaggio: string }[] = []
    const righeEmail: string[] = []

    for (const s of soglieUtente) {
      const asset = assets.find(a => a.id === s.portafoglio_id)
      if (!asset?.ticker) continue
      const quote = quotes[asset.ticker]
      if (!quote) continue
      const nomeAsset = asset.nome || asset.descrizione || asset.ticker

      if (s.tipo === 'storico' && quote.changeFromHigh != null) {
        const breach = quote.changeFromHigh <= -s.soglia_pct
        if (breach && !s.in_breach) {
          updates.push({ id: s.id, in_breach: true, ultima_notifica_at: new Date().toISOString() })
          const msg = `${nomeAsset}: ${quote.changeFromHigh.toFixed(1)}% dal massimo (soglia ${s.soglia_pct}%)`
          nuoveNotifiche.push({ user_id: userId, portafoglio_id: s.portafoglio_id, tipo: 'storico', messaggio: msg })
          righeEmail.push(msg)
        } else if (!breach && s.in_breach) {
          updates.push({ id: s.id, in_breach: false })
        }
      }

      if (s.tipo === 'mensile' && quote.changeFromMonth != null) {
        const breach = quote.changeFromMonth <= -s.soglia_pct
        if (breach && !s.in_breach) {
          updates.push({ id: s.id, in_breach: true, ultima_notifica_at: new Date().toISOString() })
          const msg = `${nomeAsset}: ${quote.changeFromMonth.toFixed(1)}% nel mese (soglia ${s.soglia_pct}%)`
          nuoveNotifiche.push({ user_id: userId, portafoglio_id: s.portafoglio_id, tipo: 'mensile', messaggio: msg })
          righeEmail.push(msg)
        } else if (!breach && s.in_breach) {
          updates.push({ id: s.id, in_breach: false })
        }
      }
    }

    if (nuoveNotifiche.length > 0) {
      await supabase.from('notifiche').insert(nuoveNotifiche)
    }
    for (const u of updates) {
      await supabase.from('alert_soglie')
        .update(u.ultima_notifica_at ? { in_breach: u.in_breach, ultima_notifica_at: u.ultima_notifica_at } : { in_breach: u.in_breach })
        .eq('id', u.id)
    }

    if (righeEmail.length > 0) {
      const { data: userData } = await supabase.auth.admin.getUserById(userId)
      const email = userData?.user?.email
      if (email) {
        try {
          await sendAlertEmail(email, righeEmail)
          notificheInviate += righeEmail.length
        } catch (err) {
          console.error(`Errore invio email a ${email}:`, err)
        }
      }
    }
  }

  return NextResponse.json({ ok: true, utentiControllati: userIds.length, notifiche: notificheInviate })
}
