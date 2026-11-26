// lib/alertDettaglio.ts
// Calcolo puro (nessun accesso a DB/rete) del "dettaglio alert": gli stessi numeri
// finiscono nella mail e, salvati in notifiche.dettaglio, nella scheda in app.
import { calcolaLookthrough, type ComposizioneEtf, type PosizioneEtf } from '@/lib/portfolioLookthrough'
import { nuovoPmcDopoAcquisto, type ClasseAsset, type TargetAllocazione } from '@/lib/accumuloFormula'

export interface Alloc { azioni: number; obbligazioni: number; altro: number; liquidita: number } // % sul patrimonio

export interface AssetAlertInput {
  id: string
  nome: string
  classe: ClasseAsset
  prezzo: number
  pmc: number
  quantita: number
  /** importo da investire (solo ETF con accumulo deciso); undefined = nessun accumulo */
  importo?: number
}

export interface PosizioneAlertInput { id: string; nome: string; ticker: string; classe: ClasseAsset; valore: number; svincolato?: boolean }

/** Avvisi da mostrare accanto all'importo: tranche riarmata e freschezza dei dati */
export interface AvvisoImporto {
  /** data ISO dell'ultimo aggiornamento di quantità/PMC dell'asset (null = sconosciuta) */
  datiAggiornatiAl: string | null
  /** ultimo saldo di liquidità usato per la riserva, es. "ott 2026" */
  liquiditaAl: string | null
  /** tranche scattate ora che avevano già suonato in precedenza */
  riarmo: { sogliaPct: number; n: number; ultimoAvviso: string | null; nessunNuovoMassimo: boolean | null }[]
}

export interface DettaglioAsset {
  id: string
  nome: string
  accumulo: boolean
  prezzo: number
  pmc: number
  pnlPct: number            // prezzo vs PMC: + in utile, − in perdita
  margineGiuPct: number     // ribasso % dal prezzo attuale prima che il PnL diventi negativo (<0 = già in perdita)
  // solo se accumulo
  importo?: number
  quote?: number            // quote acquistate (stima)
  nuovoPmc?: number
  nuovoPnlPct?: number
  nuovoMargineGiuPct?: number
  pesoPrimaPct?: number     // peso dell'ETF sul patrimonio
  pesoDopoPct?: number
  avviso?: AvvisoImporto
}

export interface VoceHolding { nome: string; pct: number }   // % sul valore azionario
export interface DettaglioAlert {
  versione: 1
  generatoAt: string
  budget: { riserva: number; usato: number; residuo: number } | null
  allocazione: { prima: Alloc; dopo: Alloc; target: Alloc | null } | null
  /** Da dove arrivano i fondi: prelievo pro-quota su tutta la riserva (liquidità svincolata + asset svincolati) */
  finanziamento: { daLiquidita: number; daAssetSvincolati: number } | null
  holdings: { prima: VoceHolding[]; dopo: VoceHolding[]; coperturaPct: number } | null
  asset: DettaglioAsset[]
}

const pct = (a: number, tot: number) => (tot > 0 ? (a / tot) * 100 : 0)

export function pnlPct(prezzo: number, pmc: number): number {
  return pmc > 0 ? (prezzo / pmc - 1) * 100 : 0
}
export function margineGiuPct(prezzo: number, pmc: number): number {
  return prezzo > 0 && pmc > 0 ? (1 - pmc / prezzo) * 100 : 0
}

function alloc(az: number, ob: number, altro: number, liq: number): Alloc {
  const tot = az + ob + altro + liq
  return { azioni: pct(az, tot), obbligazioni: pct(ob, tot), altro: pct(altro, tot), liquidita: pct(liq, tot) }
}

function topHoldings(posizioni: PosizioneAlertInput[], composizioni: ComposizioneEtf[]) {
  const etf: PosizioneEtf[] = posizioni
    .filter(p => p.classe === 'azionario')
    .map(p => ({ id: p.id, nome: p.nome, ticker: p.ticker, valore: p.valore }))
  const valAz = etf.reduce((s, e) => s + e.valore, 0)
  const lt = calcolaLookthrough(etf, composizioni)
  return {
    voci: lt.societa.slice(0, 10).map(s => ({ nome: s.nome, pct: pct(s.euro, valAz) })),
    copertura: pct(lt.valoreConDati, valAz),
  }
}

export function calcolaDettaglioAlert(args: {
  asset: AssetAlertInput[]               // asset scattati (accumulo se importo definito)
  posizioni: PosizioneAlertInput[]       // intero portafoglio (valori attuali; svincolato = parte della riserva)
  liquiditaTotale: number
  riservaLiquidita: number               // liquidità svincolata (parte della riserva)
  riserva: number | null                 // null se profilo non "contrarian"
  target: TargetAllocazione | null
  composizioni: ComposizioneEtf[]
}): DettaglioAlert {
  const { asset, posizioni, liquiditaTotale, riservaLiquidita, riserva, target, composizioni } = args
  const conAccumulo = asset.filter(a => a.importo != null)
  const usato = conAccumulo.reduce((s, a) => s + (a.importo ?? 0), 0)

  // Ipotesi: l'acquisto è finanziato pro-quota da TUTTA la riserva
  // (liquidità svincolata + asset svincolati), non solo dalla liquidità.
  const f = riserva != null && riserva > 0 ? Math.min(usato / riserva, 1) : 0
  const patrimonio = posizioni.reduce((s, p) => s + p.valore, 0) + liquiditaTotale

  const importoDi = (id: string) => conAccumulo.find(a => a.id === id)?.importo ?? 0
  const posizioniDopo = posizioni.map(p => ({
    ...p,
    valore: p.valore * (p.svincolato ? 1 - f : 1) + importoDi(p.id),
  }))
  const liquiditaDopo = liquiditaTotale - riservaLiquidita * f

  const somma = (arr: PosizioneAlertInput[], classe: ClasseAsset) => arr.filter(p => p.classe === classe).reduce((s, p) => s + p.valore, 0)
  const allocDi = (arr: PosizioneAlertInput[], liq: number) => {
    const az = somma(arr, 'azionario'), ob = somma(arr, 'obbligazionario')
    return alloc(az, ob, arr.reduce((s, p) => s + p.valore, 0) - az - ob, liq)
  }

  const dettagliAsset: DettaglioAsset[] = asset.map(a => {
    const base: DettaglioAsset = {
      id: a.id, nome: a.nome, accumulo: a.importo != null, prezzo: a.prezzo, pmc: a.pmc,
      pnlPct: pnlPct(a.prezzo, a.pmc), margineGiuPct: margineGiuPct(a.prezzo, a.pmc),
    }
    if (a.importo == null) return base
    const nuovoPmc = nuovoPmcDopoAcquisto(a.quantita, a.pmc, a.prezzo, a.importo) ?? a.pmc
    const prima = posizioni.find(p => p.id === a.id)?.valore ?? a.quantita * a.prezzo
    const dopo = posizioniDopo.find(p => p.id === a.id)?.valore ?? prima + a.importo
    return {
      ...base,
      importo: a.importo,
      quote: a.prezzo > 0 ? a.importo / a.prezzo : 0,
      nuovoPmc,
      nuovoPnlPct: pnlPct(a.prezzo, nuovoPmc),
      nuovoMargineGiuPct: margineGiuPct(a.prezzo, nuovoPmc),
      pesoPrimaPct: pct(prima, patrimonio),
      pesoDopoPct: pct(dopo, patrimonio), // patrimonio invariato: i soldi si spostano dentro il portafoglio
    }
  })

  const haAccumulo = conAccumulo.length > 0 && riserva != null
  const hPrima = topHoldings(posizioni, composizioni)
  const hDopo = topHoldings(posizioniDopo, composizioni)

  return {
    versione: 1,
    generatoAt: new Date().toISOString(),
    budget: riserva != null ? { riserva, usato, residuo: Math.max(0, riserva - usato) } : null,
    allocazione: haAccumulo ? {
      prima: allocDi(posizioni, liquiditaTotale),
      dopo: allocDi(posizioniDopo, liquiditaDopo),
      target: target ? { azioni: target.azioni, obbligazioni: target.obbligazioni, altro: 0, liquidita: target.liquidita } : null,
    } : null,
    finanziamento: haAccumulo ? { daLiquidita: riservaLiquidita * f, daAssetSvincolati: usato - riservaLiquidita * f } : null,
    holdings: haAccumulo && hPrima.voci.length > 0
      ? { prima: hPrima.voci, dopo: hDopo.voci, coperturaPct: hPrima.copertura }
      : null,
    asset: dettagliAsset,
  }
}

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null)

/** Testo unico per app e mail: titolo, righe e se mostrarlo in evidenza (tranche già scattata). */
export function avvisoImportoTesto(a: AvvisoImporto): { forte: boolean; titolo: string; righe: string[] } {
  const righe: string[] = []
  for (const r of a.riarmo) {
    const quando = r.ultimoAvviso ? `ultimo avviso il ${fmtData(r.ultimoAvviso)}` : 'il livello era già stato superato prima della creazione del piano'
    righe.push(`La tranche −${r.sogliaPct}% è già scattata in precedenza (attivazione #${r.n}, ${quando}): potresti aver già investito a questo livello.`)
    if (r.nessunNuovoMassimo === true) righe.push(`Dal precedente avviso il prezzo non ha fatto un nuovo massimo: è lo stesso ciclo di ribasso.`)
    else if (r.nessunNuovoMassimo === false) righe.push(`Dal precedente avviso c'è stato un nuovo massimo: è un nuovo ciclo di ribasso.`)
  }
  const dati = fmtData(a.datiAggiornatiAl)
  righe.push(
    `Importo calcolato su quantità e PMC ${dati ? `aggiornati al ${dati}` : '(data di aggiornamento non disponibile)'}` +
    `${a.liquiditaAl ? ` e liquidità di ${a.liquiditaAl}` : ''}. ` +
    `Se hai già acquistato dopo quella data l'importo può differire da quello pianificato: aggiorna prima i dati.`
  )
  return { forte: a.riarmo.length > 0, titolo: a.riarmo.length > 0 ? 'Attenzione: livello già scattato' : 'Controlla i dati prima di investire', righe }
}
