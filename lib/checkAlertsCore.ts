import { SupabaseClient } from '@supabase/supabase-js'
import { fetchQuote } from '@/lib/fetchQuote'
import { sendAlertEmail } from '@/lib/sendEmail'

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

export interface CheckAlertsResult {
  nuoveNotifiche: number
  emailInviata: boolean
}

/**
 * Controlla le soglie attive di un utente contro le quotazioni attuali,
 * inserisce le notifiche (edge-triggered) e invia l'email riepilogativa.
 * Usato sia dalla route cron (tutti gli utenti) sia dal check on-demand
 * (bottone "Aggiorna prezzi").
 */
export async function checkAlertsForUser(
  admin: SupabaseClient,
  userId: string
): Promise<CheckAlertsResult> {
  const { data: soglieData } = await admin
    .from('alert_soglie')
    .select('*')
    .eq('user_id', userId)
    .eq('attivo', true)
  const soglie = (soglieData as SogliaRow[]) ?? []
  if (soglie.length === 0) return { nuoveNotifiche: 0, emailInviata: false }

  const portafoglioIds = [...new Set(soglie.map(s => s.portafoglio_id))]
  const { data: assetsData } = await admin
    .from('portafoglio')
    .select('id, ticker, nome, descrizione')
    .in('id', portafoglioIds)
  const assets = (assetsData as AssetRow[]) ?? []
  const tickers = [...new Set(assets.map(a => a.ticker).filter(Boolean) as string[])]
  if (tickers.length === 0) return { nuoveNotifiche: 0, emailInviata: false }

  const quotesEntries = await Promise.all(
    tickers.map(async t => [t, await fetchQuote(t)] as const)
  )
  const quotes = Object.fromEntries(quotesEntries.filter(([, q]) => q))

  const updates: { id: string; in_breach: boolean; ultima_notifica_at?: string }[] = []
  const nuoveNotifiche: { user_id: string; portafoglio_id: string; tipo: string; messaggio: string }[] = []
  const righeEmail: string[] = []

  for (const s of soglie) {
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
    await admin.from('notifiche').insert(nuoveNotifiche)
  }
  for (const u of updates) {
    await admin.from('alert_soglie')
      .update(u.ultima_notifica_at ? { in_breach: u.in_breach, ultima_notifica_at: u.ultima_notifica_at } : { in_breach: u.in_breach })
      .eq('id', u.id)
  }

  let emailInviata = false
  if (righeEmail.length > 0) {
    const { data: userData } = await admin.auth.admin.getUserById(userId)
    const email = userData?.user?.email
    if (email) {
      try {
        await sendAlertEmail(email, righeEmail)
        emailInviata = true
      } catch (err) {
        console.error(`Errore invio email a ${email}:`, err)
      }
    }
  }

  return { nuoveNotifiche: nuoveNotifiche.length, emailInviata }
}
