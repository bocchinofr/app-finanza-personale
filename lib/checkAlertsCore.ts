import { SupabaseClient } from '@supabase/supabase-js'
import { fetchQuote } from '@/lib/fetchQuote'
import { sendAlertEmail, AlertEmailRiga } from '@/lib/sendEmail'
import { calcolaConsigli, type TargetAllocazione, type AssetScattato } from '@/lib/accumuloFormula'

const PROFILO_DINAMICO_LABEL = 'Contrarian (accumula sui crolli)'

interface AssetRow {
  id: string
  ticker: string | null
  nome: string | null
  descrizione: string | null
  classe_rischio: 'azionario' | 'obbligazionario' | 'altro' | null
  svincolato: boolean | null
  prezzo_acquisto: number
  prezzo_carico_attuale: number | null
  quantita: number
  quantita_attuale: number | null
}
interface SogliaRow {
  id: string
  user_id: string
  portafoglio_id: string
  tipo: 'storico' | 'mensile' | 'acquisto'
  soglia_pct: number
  attivo: boolean
  accumulo?: boolean | null
  in_breach: boolean
}
interface LiquiditaRow {
  mese: string
  conto: string
  saldo: number
}
interface ContoFlagRow {
  conto: string
  svincolata: boolean
}
interface ProfiloRow {
  behavior_label: string | null
  dd_max: number | null
  nome_visualizzato: string | null
  target_azioni_pct: number | null
  target_obbligazioni_pct: number | null
  target_liquidita_pct: number | null
  pmc_max_aumento_pct: number | null
}

export interface CheckAlertsResult {
  nuoveNotifiche: number
  emailInviata: boolean
}

const ORDINE_MESE = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const TIPO_LABEL: Record<string, string> = { storico: 'dal massimo', mensile: 'nel mese', acquisto: 'da acquisto' }

// PMC corrente: si aggiorna con gli acquisti (stessa logica di statoAttuale in types)
function pmcAsset(a: { prezzo_carico_attuale: number | null; prezzo_acquisto: number }): number {
  return a.prezzo_carico_attuale ?? a.prezzo_acquisto
}

function fmtEuro(n: number) {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}

/**
 * Controlla le soglie attive di un utente contro le quotazioni attuali,
 * inserisce le notifiche (edge-triggered, con conteggio attivazioni storiche
 * e, se il profilo è impostato su "accumula sui crolli", l'investimento
 * consigliato dalla riserva svincolata) e invia l'email riepilogativa.
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
    .select('id, ticker, nome, descrizione, classe_rischio, svincolato, prezzo_acquisto, prezzo_carico_attuale, quantita, quantita_attuale')
    .in('id', portafoglioIds)
  const assets = (assetsData as AssetRow[]) ?? []
  const tickers = [...new Set(assets.map(a => a.ticker).filter(Boolean) as string[])]
  if (tickers.length === 0) return { nuoveNotifiche: 0, emailInviata: false }

  const quotes: Record<string, Awaited<ReturnType<typeof fetchQuote>>> = {}
  const quotesEntries = await Promise.all(
    tickers.map(async t => [t, await fetchQuote(t)] as const)
  )
  for (const [t, q] of quotesEntries) if (q) quotes[t] = q

  // --- Profilo "accumula sui crolli" + riserva svincolata (stessa logica di RiservaAccumulo.tsx) ---
  const { data: profiloData } = await admin
    .from('profili')
    .select('behavior_label, dd_max, nome_visualizzato, target_azioni_pct, target_obbligazioni_pct, target_liquidita_pct, pmc_max_aumento_pct')
    .eq('user_id', userId)
    .single()
  const profilo = profiloData as ProfiloRow | null
  const profiloDinamico = profilo?.behavior_label === PROFILO_DINAMICO_LABEL
  const ddMax = profilo?.dd_max ?? 0.30

  // Serve l'intero portafoglio (non solo gli asset con soglia) per calcolare
  // riserva totale e pesi azionario/obbligazionario in modo coerente con la UI.
  const { data: interoPortafoglioData } = await admin
    .from('portafoglio')
    .select('id, ticker, nome, descrizione, classe_rischio, svincolato, prezzo_acquisto, prezzo_carico_attuale, quantita, quantita_attuale')
    .eq('user_id', userId)
  const interoPortafoglio = (interoPortafoglioData as AssetRow[]) ?? []
  const tickersInteri = [...new Set(interoPortafoglio.map(a => a.ticker).filter(Boolean) as string[])]
  const tickersMancanti = tickersInteri.filter(t => !(t in quotes))
  if (tickersMancanti.length > 0) {
    const extra = await Promise.all(tickersMancanti.map(async t => [t, await fetchQuote(t)] as const))
    for (const [t, q] of extra) if (q) quotes[t] = q
  }

  function valoreAttualeAsset(a: AssetRow): number {
    const qta = a.quantita_attuale ?? a.quantita
    const p = a.ticker && quotes[a.ticker] ? quotes[a.ticker]!.price : pmcAsset(a)
    return p * qta
  }

  let riservaTotale = 0
  let valoreAzionario = 0
  let valoreObbligazionario = 0
  let liquiditaTotale = 0
  if (profiloDinamico) {
    const { data: liquiditaData } = await admin.from('liquidita').select('mese, conto, saldo').eq('user_id', userId)
    const { data: contoFlagsData } = await admin.from('conto_flags').select('conto, svincolata').eq('user_id', userId)
    const liquidita = (liquiditaData as LiquiditaRow[]) ?? []
    const contoFlags = (contoFlagsData as ContoFlagRow[]) ?? []
    const isContoSvincolato = (conto: string) => contoFlags.find(c => c.conto === conto)?.svincolata ?? false

    const ultimiSaldiPerConto: Record<string, { mese: string; saldo: number }> = {}
    liquidita.forEach(l => {
      const attuale = ultimiSaldiPerConto[l.conto]
      if (!attuale || ORDINE_MESE.indexOf(l.mese) >= ORDINE_MESE.indexOf(attuale.mese)) {
        ultimiSaldiPerConto[l.conto] = { mese: l.mese, saldo: l.saldo }
      }
    })

    const riservaAsset = interoPortafoglio.filter(a => a.svincolato).reduce((s, a) => s + valoreAttualeAsset(a), 0)
    const riservaLiquidita = Object.entries(ultimiSaldiPerConto)
      .filter(([conto]) => isContoSvincolato(conto))
      .reduce((s, [, v]) => s + v.saldo, 0)
    riservaTotale = riservaAsset + riservaLiquidita
    liquiditaTotale = Object.values(ultimiSaldiPerConto).reduce((s, v) => s + v.saldo, 0)

    valoreAzionario = interoPortafoglio.filter(a => a.classe_rischio === 'azionario').reduce((s, a) => s + valoreAttualeAsset(a), 0)
    valoreObbligazionario = interoPortafoglio.filter(a => a.classe_rischio === 'obbligazionario').reduce((s, a) => s + valoreAttualeAsset(a), 0)
  }
  const totaleClassificato = valoreAzionario + valoreObbligazionario

  // --- Determina stato finale (in_breach) di ogni soglia dopo il check odierno ---
  const updates: { id: string; in_breach: boolean; ultima_notifica_at?: string }[] = []
  const nuoveBreach: { s: SogliaRow; asset: AssetRow; drawdown: number }[] = []
  const finalState = new Map<string, { inBreach: boolean; drawdown: number | null }>()

  for (const s of soglie) {
    const asset = assets.find(a => a.id === s.portafoglio_id)
    if (!asset?.ticker) continue
    const quote = quotes[asset.ticker]
    if (!quote) continue

    const drawdown = s.tipo === 'storico' ? quote.changeFromHigh : s.tipo === 'mensile' ? quote.changeFromMonth : null
    if (drawdown == null) continue

    const breach = drawdown <= -s.soglia_pct
    finalState.set(s.id, { inBreach: breach, drawdown })

    if (breach && !s.in_breach) {
      updates.push({ id: s.id, in_breach: true, ultima_notifica_at: new Date().toISOString() })
      nuoveBreach.push({ s, asset, drawdown })
    } else if (!breach && s.in_breach) {
      updates.push({ id: s.id, in_breach: false })
    }
  }

  if (nuoveBreach.length === 0) {
    // Nessuna nuova attivazione, ma aggiorna comunque gli stati rientrati
    for (const u of updates) {
      await admin.from('alert_soglie').update({ in_breach: u.in_breach }).eq('id', u.id)
    }
    return { nuoveNotifiche: 0, emailInviata: false }
  }

  // Consigli di accumulo (3 passi: budget → quota rispetto al peso target → limite PMC).
  // Si calcolano su tutti gli asset attualmente scattati con "Accum." attivo,
  // così gli importi sono coerenti con quelli mostrati in app.
  const target: TargetAllocazione | null =
    profilo?.target_azioni_pct != null && profilo?.target_obbligazioni_pct != null && profilo?.target_liquidita_pct != null
      ? { azioni: profilo.target_azioni_pct, obbligazioni: profilo.target_obbligazioni_pct, liquidita: profilo.target_liquidita_pct }
      : null
  const limitePmc = profilo?.pmc_max_aumento_pct != null ? profilo.pmc_max_aumento_pct / 100 : null
  const idAccumulo = new Set(soglie.filter(x => x.accumulo !== false).map(x => x.portafoglio_id))
  const scattati: AssetScattato[] = []
  if (profiloDinamico && riservaTotale > 0) {
    const idInBreach = new Set<string>()
    for (const sg of soglie) if (finalState.get(sg.id)?.inBreach) idInBreach.add(sg.portafoglio_id)
    for (const id of idInBreach) {
      if (!idAccumulo.has(id)) continue
      const full = interoPortafoglio.find(x => x.id === id)
      const qt = full?.ticker ? quotes[full.ticker] : undefined
      if (!full || !qt) continue
      const ribasso = qt.changeFromHigh != null ? Math.max(0, -qt.changeFromHigh) / 100
        : qt.high52 ? Math.max(0, (qt.high52 - qt.price) / qt.high52) : 0
      scattati.push({
        id, classe: full.classe_rischio, prezzo: qt.price, pmc: pmcAsset(full),
        quantita: full.quantita_attuale ?? full.quantita, ribassoDalMax: ribasso,
      })
    }
  }
  const consigli = calcolaConsigli({
    riserva: riservaTotale, valoreAzionario, valoreObbligazionario, liquiditaTotale,
    target, ddMax, limitePmc, scattati,
  })

  // Conteggio attivazioni storiche per asset+tipo (per il testo "attivazione #N").
  // Una notifica può contenere più soglie dello stesso asset: si conta quindi
  // anche dal testo ("dal massimo (soglia" / "nel mese (soglia"), oltre che dal campo tipo.
  const { data: notificheStoricheData } = await admin
    .from('notifiche')
    .select('portafoglio_id, tipo, messaggio')
    .eq('user_id', userId)
    .in('portafoglio_id', portafoglioIds)
  const notificheStoriche = (notificheStoricheData as { portafoglio_id: string; tipo: string; messaggio: string | null }[]) ?? []
  const conteggio = (portafoglioId: string, tipo: string) => {
    const tipoLabel = TIPO_LABEL[tipo] ?? tipo
    return notificheStoriche.filter(n =>
      n.portafoglio_id === portafoglioId &&
      (n.tipo === tipo || (n.messaggio ?? '').includes(`${tipoLabel} (soglia`))
    ).length + 1
  }

  // Una sola notifica per asset: se scattano più soglie (es. dal massimo + nel mese)
  // vengono elencate insieme, con un unico importo consigliato (non si somma).
  const nuoveBreachPerAsset = new Map<string, { asset: AssetRow; breaches: { s: SogliaRow; drawdown: number }[] }>()
  for (const { s, asset, drawdown } of nuoveBreach) {
    const entry = nuoveBreachPerAsset.get(s.portafoglio_id) ?? { asset, breaches: [] }
    entry.breaches.push({ s, drawdown })
    nuoveBreachPerAsset.set(s.portafoglio_id, entry)
  }

  const nuoveNotifiche: { user_id: string; portafoglio_id: string; tipo: string; messaggio: string }[] = []
  const righeEmail: AlertEmailRiga[] = []

  for (const [portafoglioId, { asset, breaches }] of nuoveBreachPerAsset.entries()) {
    const nomeAsset = (asset.nome || asset.descrizione || asset.ticker) as string

    const trigger = breaches.map(({ s, drawdown }) => ({
      tipoLabel: TIPO_LABEL[s.tipo] ?? s.tipo,
      sogliaPct: s.soglia_pct,
      drawdown,
      numAttivazione: conteggio(portafoglioId, s.tipo),
    }))

    let importoConsigliato: number | undefined
    let nuovoPesoAzionario: number | undefined
    const consiglio = consigli.get(portafoglioId)
    if (profiloDinamico && consiglio) {
      importoConsigliato = consiglio.importo
      if (asset.classe_rischio === 'azionario' || asset.classe_rischio === 'obbligazionario') {
        const nuovoAzionario = valoreAzionario + (asset.classe_rischio === 'azionario' ? importoConsigliato : 0)
        const nuovoTotale = totaleClassificato + importoConsigliato
        if (nuovoTotale > 0) nuovoPesoAzionario = (nuovoAzionario / nuovoTotale) * 100
      }
    }

    const testoTrigger = trigger
      .map(t => `${t.drawdown.toFixed(1)}% ${t.tipoLabel} (soglia ${t.sogliaPct}%, attivazione #${t.numAttivazione})`)
      .join(' · ')
    let riga = `${nomeAsset}: ${testoTrigger}`
    if (importoConsigliato != null) {
      riga += ` → investimento consigliato €${Math.round(importoConsigliato).toLocaleString('it-IT')}`
      if (trigger.length > 1) riga += ' (importo unico, non si somma tra le soglie)'
      if (nuovoPesoAzionario != null) riga += `, nuovo peso azionario ${nuovoPesoAzionario.toFixed(1)}%`
    }

    // tipo = prima soglia scattata (valore valido per il vincolo della colonna)
    nuoveNotifiche.push({ user_id: userId, portafoglio_id: portafoglioId, tipo: breaches[0].s.tipo, messaggio: riga })
    righeEmail.push({ nomeAsset, trigger, importoConsigliato, nuovoPesoAzionario })
  }

  await admin.from('notifiche').insert(nuoveNotifiche)
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
        await sendAlertEmail(email, righeEmail, {
          nomeUtente: profilo?.nome_visualizzato ?? null,
          riservaDisponibile: profiloDinamico && riservaTotale > 0 ? fmtEuro(riservaTotale) : null,
        })
        emailInviata = true
      } catch (err) {
        console.error(`Errore invio email a ${email}:`, err)
      }
    }
  }

  return { nuoveNotifiche: nuoveNotifiche.length, emailInviata }
}
