import { SupabaseClient } from '@supabase/supabase-js'
import { fetchQuote } from '@/lib/fetchQuote'
import { sendAlertEmail, AlertEmailRiga } from '@/lib/sendEmail'
import type { TargetAllocazione } from '@/lib/accumuloFormula'
import { calcolaPianoAsset, ripartisciRiserva, PIANO_CONFIG_DEFAULT, type PianoConfig, type Distribuzione } from '@/lib/pianoAccumulo'
import { calcolaDettaglioAlert, type AssetAlertInput, type DettaglioAlert, type AvvisoImporto } from '@/lib/alertDettaglio'
import type { ComposizioneEtf } from '@/lib/portfolioLookthrough'

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
  ultimo_aggiornamento_at: string | null
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
interface TrancheRow {
  id: string
  portafoglio_id: string
  soglia_pct: number
  peso_pct: number
  in_breach: boolean
  attivazioni?: number | null
  massimo_ultimo_avviso?: number | null
  prezzo_ultimo_avviso?: number | null
  ultima_notifica_at?: string | null
}
interface AccumuloAssetRow {
  portafoglio_id: string
  quota_pct: number | null
  distribuzione: Distribuzione
}
/** Una soglia scattata: può venire da alert_soglie o da una tranche del piano di accumulo */
interface BreachItem {
  s: { portafoglio_id: string; tipo: string; soglia_pct: number }
  asset: AssetRow
  drawdown: number
  trancheId?: string
}
interface LiquiditaRow {
  anno?: number | null
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
  accumulo_bonus_pmc: number | null
  accumulo_molt_max: number | null
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

// Ribasso dal massimo (frazione positiva): stessa logica usata in app (PianoAccumulo.tsx)
function ribassoDa(q: { price: number; high52: number | null; changeFromHigh: number | null } | undefined | null): number {
  if (!q) return 0
  if (q.changeFromHigh != null) return Math.max(0, -q.changeFromHigh) / 100
  if (q.high52) return Math.max(0, (q.high52 - q.price) / q.high52)
  return 0
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

  // Piano di accumulo: asset inclusi e relative tranche (una per soglia di ribasso dal massimo)
  const { data: accAssetData } = await admin.from('accumulo_asset').select('portafoglio_id, quota_pct, distribuzione').eq('user_id', userId).eq('attivo', true)
  const { data: accTrancheData } = await admin.from('accumulo_tranche').select('*').eq('user_id', userId)
  const assetPiano = (accAssetData as AccumuloAssetRow[]) ?? []
  const idPiano = new Set(assetPiano.map(a => a.portafoglio_id))
  const tranche = ((accTrancheData as TrancheRow[]) ?? []).filter(t => idPiano.has(t.portafoglio_id))

  if (soglie.length === 0 && tranche.length === 0) return { nuoveNotifiche: 0, emailInviata: false }

  const portafoglioIds = [...new Set([...soglie.map(s => s.portafoglio_id), ...tranche.map(t => t.portafoglio_id)])]
  const { data: assetsData } = await admin
    .from('portafoglio')
    .select('id, ticker, nome, descrizione, classe_rischio, svincolato, prezzo_acquisto, prezzo_carico_attuale, quantita, quantita_attuale, ultimo_aggiornamento_at')
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
    .select('behavior_label, dd_max, nome_visualizzato, target_azioni_pct, target_obbligazioni_pct, target_liquidita_pct, pmc_max_aumento_pct, accumulo_bonus_pmc, accumulo_molt_max')
    .eq('user_id', userId)
    .single()
  const profilo = profiloData as ProfiloRow | null
  const profiloDinamico = profilo?.behavior_label === PROFILO_DINAMICO_LABEL

  // Serve l'intero portafoglio (non solo gli asset con soglia) per calcolare
  // riserva totale e pesi azionario/obbligazionario in modo coerente con la UI.
  const { data: interoPortafoglioData } = await admin
    .from('portafoglio')
    .select('id, ticker, nome, descrizione, classe_rischio, svincolato, prezzo_acquisto, prezzo_carico_attuale, quantita, quantita_attuale, ultimo_aggiornamento_at')
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
  let riservaLiquiditaSvinc = 0
  let liquiditaAl: string | null = null // ultimo saldo di liquidità usato, es. "nov 2026"
  if (profiloDinamico) {
    const { data: liquiditaData } = await admin.from('liquidita').select('anno, mese, conto, saldo').eq('user_id', userId)
    const { data: contoFlagsData } = await admin.from('conto_flags').select('conto, svincolata').eq('user_id', userId)
    const liquidita = (liquiditaData as LiquiditaRow[]) ?? []
    const contoFlags = (contoFlagsData as ContoFlagRow[]) ?? []
    const isContoSvincolato = (conto: string) => contoFlags.find(c => c.conto === conto)?.svincolata ?? false

    // L'ultimo saldo si sceglie per (anno, mese): con più anni in tabella il solo mese darebbe il saldo sbagliato
    const chiaveMese = (anno: number | null | undefined, mese: string) => (anno ?? 0) * 12 + ORDINE_MESE.indexOf(mese)
    const ultimiSaldiPerConto: Record<string, { mese: string; anno: number | null; saldo: number }> = {}
    liquidita.forEach(l => {
      const attuale = ultimiSaldiPerConto[l.conto]
      if (!attuale || chiaveMese(l.anno, l.mese) >= chiaveMese(attuale.anno, attuale.mese)) {
        ultimiSaldiPerConto[l.conto] = { mese: l.mese, anno: l.anno ?? null, saldo: l.saldo }
      }
    })
    const ultimoSaldo = Object.values(ultimiSaldiPerConto).sort((a, b) => chiaveMese(b.anno, b.mese) - chiaveMese(a.anno, a.mese))[0]
    liquiditaAl = ultimoSaldo ? `${ultimoSaldo.mese}${ultimoSaldo.anno ? ` ${ultimoSaldo.anno}` : ''}` : null

    const riservaAsset = interoPortafoglio.filter(a => a.svincolato).reduce((s, a) => s + valoreAttualeAsset(a), 0)
    const riservaLiquidita = Object.entries(ultimiSaldiPerConto)
      .filter(([conto]) => isContoSvincolato(conto))
      .reduce((s, [, v]) => s + v.saldo, 0)
    riservaTotale = riservaAsset + riservaLiquidita
    riservaLiquiditaSvinc = riservaLiquidita
    liquiditaTotale = Object.values(ultimiSaldiPerConto).reduce((s, v) => s + v.saldo, 0)

    valoreAzionario = interoPortafoglio.filter(a => a.classe_rischio === 'azionario').reduce((s, a) => s + valoreAttualeAsset(a), 0)
    valoreObbligazionario = interoPortafoglio.filter(a => a.classe_rischio === 'obbligazionario').reduce((s, a) => s + valoreAttualeAsset(a), 0)
  }
  const totaleClassificato = valoreAzionario + valoreObbligazionario

  // --- Determina stato finale (in_breach) di ogni soglia dopo il check odierno ---
  const updates: { id: string; in_breach: boolean; ultima_notifica_at?: string }[] = []
  const nuoveBreach: BreachItem[] = []
  const trancheUpdates: { id: string; in_breach: boolean; ultima_notifica_at?: string; riarmo?: { attivazioni: number; massimo_ultimo_avviso: number; prezzo_ultimo_avviso: number } }[] = []
  // Info di riarmo per ogni tranche appena scattata (attivazione #N, ultimo avviso, nuovo massimo?)
  const infoTranche = new Map<string, { n: number; giaScattata: boolean; ultimoAvviso: string | null; nessunNuovoMassimo: boolean | null; sogliaPct: number }>()
  const finalState = new Map<string, { inBreach: boolean; drawdown: number | null }>()

  for (const s of soglie) {
    // Per gli asset del piano la soglia "dal massimo" è sostituita dalle tranche: nessun alert doppio
    if (s.tipo === 'storico' && idPiano.has(s.portafoglio_id)) {
      if (s.in_breach) updates.push({ id: s.id, in_breach: false })
      continue
    }
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

  // Tranche del piano di accumulo: stessa logica edge-triggered, ribasso misurato dal massimo
  for (const t of tranche) {
    const asset = assets.find(a => a.id === t.portafoglio_id)
    if (!asset?.ticker) continue
    const quote = quotes[asset.ticker]
    if (!quote) continue
    const ribasso = ribassoDa(quote)
    const breach = ribasso * 100 >= Number(t.soglia_pct) - 1e-9
    if (breach && !t.in_breach) {
      // Massimo implicito attuale: serve a capire se dall'ultimo avviso c'è stato un nuovo massimo
      const massimoOra = ribasso > 0 && ribasso < 1 ? quote.price / (1 - ribasso) : quote.price
      const prec = t.massimo_ultimo_avviso != null ? Number(t.massimo_ultimo_avviso) : null
      const n = (t.attivazioni ?? 0) + 1
      const giaScattata = prec != null || (t.attivazioni ?? 0) > 0
      infoTranche.set(t.id, {
        n, giaScattata, ultimoAvviso: t.ultima_notifica_at ?? null, sogliaPct: Number(t.soglia_pct),
        nessunNuovoMassimo: prec != null ? massimoOra <= prec * 1.005 : null,
      })
      trancheUpdates.push({
        id: t.id, in_breach: true, ultima_notifica_at: new Date().toISOString(),
        riarmo: { attivazioni: n, massimo_ultimo_avviso: massimoOra, prezzo_ultimo_avviso: quote.price },
      })
      nuoveBreach.push({
        s: { portafoglio_id: t.portafoglio_id, tipo: 'storico', soglia_pct: Number(t.soglia_pct) },
        asset, drawdown: -ribasso * 100, trancheId: t.id,
      })
    } else if (!breach && t.in_breach) {
      trancheUpdates.push({ id: t.id, in_breach: false })
    }
  }
  const salvaStatiTranche = async () => {
    for (const u of trancheUpdates) {
      // 1) stato edge-triggered (indispensabile per non rinotificare)
      await admin.from('accumulo_tranche')
        .update(u.ultima_notifica_at ? { in_breach: u.in_breach, ultima_notifica_at: u.ultima_notifica_at } : { in_breach: u.in_breach })
        .eq('id', u.id)
      // 2) memoria dell'avviso: contatore e massimo di riferimento
      if (u.riarmo) await admin.from('accumulo_tranche').update(u.riarmo).eq('id', u.id)
    }
  }

  if (nuoveBreach.length === 0) {
    // Nessuna nuova attivazione, ma aggiorna comunque gli stati rientrati
    for (const u of updates) {
      await admin.from('alert_soglie').update({ in_breach: u.in_breach }).eq('id', u.id)
    }
    await salvaStatiTranche()
    return { nuoveNotifiche: 0, emailInviata: false }
  }

  // Importi del Piano di accumulo (riserva → quota asset → tranche → moltiplicatore / limite PMC).
  // Stessa formula della sezione in app (lib/pianoAccumulo.ts): l'importo indicato è quello
  // delle tranche appena scattate per ciascun asset del piano.
  const target: TargetAllocazione | null =
    profilo?.target_azioni_pct != null && profilo?.target_obbligazioni_pct != null && profilo?.target_liquidita_pct != null
      ? { azioni: profilo.target_azioni_pct, obbligazioni: profilo.target_obbligazioni_pct, liquidita: profilo.target_liquidita_pct }
      : null
  const configPiano: PianoConfig = {
    bonusSottoPmc: profilo?.accumulo_bonus_pmc ?? PIANO_CONFIG_DEFAULT.bonusSottoPmc,
    moltMax: profilo?.accumulo_molt_max ?? PIANO_CONFIG_DEFAULT.moltMax,
    limitePmc: profilo?.pmc_max_aumento_pct != null ? profilo.pmc_max_aumento_pct / 100 : null,
  }
  const consigli = new Map<string, { importo: number }>()
  if (profiloDinamico && riservaTotale > 0) {
    const quote_ = ripartisciRiserva(riservaTotale, assetPiano.map(a => ({ id: a.portafoglio_id, quotaPct: a.quota_pct })))
    const nuoveIdsPerAsset = new Map<string, Set<string>>()
    for (const b of nuoveBreach) {
      if (!b.trancheId) continue
      const set = nuoveIdsPerAsset.get(b.s.portafoglio_id) ?? new Set<string>()
      set.add(b.trancheId)
      nuoveIdsPerAsset.set(b.s.portafoglio_id, set)
    }
    for (const [id, nuoveIds] of nuoveIdsPerAsset.entries()) {
      const full = interoPortafoglio.find(x => x.id === id)
      const qt = full?.ticker ? quotes[full.ticker] : undefined
      if (!full || !qt) continue
      const piano = calcolaPianoAsset({
        quota: quote_.get(id) ?? 0,
        tranche: tranche.filter(t => t.portafoglio_id === id).map(t => ({ id: t.id, sogliaPct: Number(t.soglia_pct), pesoPct: Number(t.peso_pct) })),
        prezzo: qt.price, pmc: pmcAsset(full), quantita: full.quantita_attuale ?? full.quantita,
        ribasso: ribassoDa(qt), config: configPiano, nuoveIds,
      })
      if (piano.importoOra > 0) consigli.set(id, { importo: piano.importoOra })
    }
  }

  // Dettaglio alert (PMC prima→dopo, margine PnL, allocazione, holding, budget residuo).
  // Stessa fonte per mail e app: viene salvato in notifiche.dettaglio.
  const assetNuoveBreach = new Map<string, AssetRow>()
  for (const { asset } of nuoveBreach) assetNuoveBreach.set(asset.id, asset)
  let composizioni: ComposizioneEtf[] = []
  if (profiloDinamico && consigli.size > 0) {
    const { data: compData } = await admin.from('etf_composizione').select('*').eq('user_id', userId)
    composizioni = (compData as ComposizioneEtf[]) ?? []
  }
  const assetDettaglio: AssetAlertInput[] = [...assetNuoveBreach.values()].map(a => {
    const qt = a.ticker ? quotes[a.ticker] : undefined
    return {
      id: a.id, nome: (a.nome || a.descrizione || a.ticker) as string, classe: a.classe_rischio,
      prezzo: qt?.price ?? pmcAsset(a), pmc: pmcAsset(a), quantita: a.quantita_attuale ?? a.quantita,
      importo: profiloDinamico ? consigli.get(a.id)?.importo : undefined,
    }
  })
  const dettaglio: DettaglioAlert = calcolaDettaglioAlert({
    asset: assetDettaglio,
    posizioni: interoPortafoglio.map(a => ({
      id: a.id, nome: (a.nome || a.descrizione || a.ticker || '') as string, ticker: a.ticker ?? '',
      classe: a.classe_rischio, valore: valoreAttualeAsset(a), svincolato: !!a.svincolato,
    })),
    liquiditaTotale,
    riservaLiquidita: riservaLiquiditaSvinc,
    riserva: profiloDinamico ? riservaTotale : null,
    target,
    composizioni,
  })

  // Avvisi accanto all'importo: tranche riarmata + freschezza dei dati (quantità/PMC e liquidità)
  const ultimoAggiornamentoGlobale = interoPortafoglio
    .map(a => a.ultimo_aggiornamento_at).filter((x): x is string => !!x).sort().pop() ?? null
  for (const d of dettaglio.asset) {
    if (d.importo == null) continue
    const asset = assetNuoveBreach.get(d.id)
    const avviso: AvvisoImporto = {
      datiAggiornatiAl: asset?.ultimo_aggiornamento_at ?? ultimoAggiornamentoGlobale,
      liquiditaAl,
      riarmo: nuoveBreach
        .filter(b => b.trancheId && b.s.portafoglio_id === d.id)
        .map(b => infoTranche.get(b.trancheId as string))
        .filter((i): i is NonNullable<typeof i> => !!i && i.giaScattata)
        .map(i => ({ sogliaPct: i.sogliaPct, n: i.n, ultimoAvviso: i.ultimoAvviso, nessunNuovoMassimo: i.nessunNuovoMassimo })),
    }
    d.avviso = avviso
  }

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
  const nuoveBreachPerAsset = new Map<string, { asset: AssetRow; breaches: { s: BreachItem['s']; drawdown: number; trancheId?: string }[] }>()
  for (const { s, asset, drawdown, trancheId } of nuoveBreach) {
    const entry = nuoveBreachPerAsset.get(s.portafoglio_id) ?? { asset, breaches: [] }
    entry.breaches.push({ s, drawdown, trancheId })
    nuoveBreachPerAsset.set(s.portafoglio_id, entry)
  }

  const nuoveNotifiche: { user_id: string; portafoglio_id: string; tipo: string; messaggio: string; dettaglio: DettaglioAlert }[] = []
  const righeEmail: AlertEmailRiga[] = []

  for (const [portafoglioId, { asset, breaches }] of nuoveBreachPerAsset.entries()) {
    const nomeAsset = (asset.nome || asset.descrizione || asset.ticker) as string

    // Soglia di notifica e tranche con lo stesso livello si mostrano una volta sola
    const visti = new Set<string>()
    const trigger = breaches
      .filter(({ s }) => {
        const k = `${s.tipo}-${s.soglia_pct}`
        if (visti.has(k)) return false
        visti.add(k)
        return true
      })
      .map(({ s, drawdown, trancheId }) => ({
        tipoLabel: TIPO_LABEL[s.tipo] ?? s.tipo,
        sogliaPct: s.soglia_pct,
        drawdown,
        // per le tranche il contatore è della singola tranche (quante volte è scattata dopo un riarmo)
        numAttivazione: trancheId ? (infoTranche.get(trancheId)?.n ?? 1) : conteggio(portafoglioId, s.tipo),
      }))
    const numTranche = breaches.filter(b => b.trancheId).length

    // Alert mensile su un asset del piano: dice dove sei rispetto al massimo e alle tranche
    let notaPiano: string | undefined
    if (idPiano.has(portafoglioId) && breaches.some(b => !b.trancheId)) {
      const rib = ribassoDa(asset.ticker ? quotes[asset.ticker] : undefined) * 100
      const scattate = tranche
        .filter(t => t.portafoglio_id === portafoglioId && rib >= Number(t.soglia_pct) - 1e-9)
        .map(t => Number(t.soglia_pct))
      const ultima = scattate.length > 0 ? Math.max(...scattate) : null
      notaPiano = `Dal massimo sei a −${rib.toFixed(1)}%: ` + (ultima != null
        ? `ultima tranche del piano scattata −${ultima}%${numTranche > 0 ? '' : ' (importo già indicato al suo scatto)'}`
        : 'nessuna tranche del piano ancora scattata')
    }

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
      if (numTranche > 1) riga += ` (somma delle ${numTranche} tranche scattate)`
      if (nuovoPesoAzionario != null) riga += `, nuovo peso azionario ${nuovoPesoAzionario.toFixed(1)}%`
    }

    if (notaPiano) riga += ` · ${notaPiano}`
    const avvisoAsset = dettaglio.asset.find(d => d.id === portafoglioId)?.avviso
    if (avvisoAsset && avvisoAsset.riarmo.length > 0) riga += ' · ⚠ tranche già scattata in precedenza: verifica di non aver già investito a questo livello'

    // tipo = prima soglia scattata (valore valido per il vincolo della colonna)
    nuoveNotifiche.push({ user_id: userId, portafoglio_id: portafoglioId, tipo: breaches[0].s.tipo, messaggio: riga, dettaglio })
    righeEmail.push({ nomeAsset, trigger, importoConsigliato, nuovoPesoAzionario, nota: notaPiano, dettaglio: dettaglio.asset.find(d => d.id === portafoglioId) })
  }

  await admin.from('notifiche').insert(nuoveNotifiche)
  await salvaStatiTranche()
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
          dettaglio,
          appUrl: process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null,
        })
        emailInviata = true
      } catch (err) {
        console.error(`Errore invio email a ${email}:`, err)
      }
    }
  }

  return { nuoveNotifiche: nuoveNotifiche.length, emailInviata }
}
