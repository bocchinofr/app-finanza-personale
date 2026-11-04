// lib/portfolioSimulation.ts
// Motore di simulazione riallocazione. Puro e deterministico: lavora su copie in memoria,
// non legge né scrive mai transazioni, quantità o prezzi di carico reali.
import { ComposizioneEtf, PosizioneEtf, RisultatoLookthrough, calcolaLookthrough } from './portfolioLookthrough'

export type Classe = 'azionario' | 'obbligazionario' | 'altro'

export interface StrumentoSim {
  id: string
  nome: string
  ticker: string
  classe: Classe
  qta: number // quantità attuale (0 per strumenti nuovi)
  pmc: number // prezzo medio di carico (0 per nuovi)
  prezzo: number // prezzo di mercato in euro
  leva: number // 1 normale, -1/-2 inverso
  riferimentoId?: string | null
  nuovo: boolean
}

export type ModoOperazione = 'tutto' | 'percentuale' | 'quantita' | 'importo'

export interface Operazione {
  id: string
  tipo: 'vendi' | 'acquista'
  strumentoId: string
  modo: ModoOperazione
  valore: number // % | quantità | importo in euro, secondo il modo
  aliquota: number // % imposta sulla plusvalenza (solo vendite)
  costi: number // costi di transazione in euro
}

export interface DettaglioOperazione {
  op: Operazione
  strumento: StrumentoSim
  qta: number
  lordo: number
  costi: number
  pmc: number
  plus: number // plusvalenza (o minusvalenza se negativa) al netto dei costi, solo vendite
  imposta: number
  netto: number // vendite: incasso netto; acquisti: esborso totale (negativo)
  avvisi: string[]
}

export interface StatoPortafoglio {
  posizioni: { s: StrumentoSim; qta: number; valore: number }[]
  liquidita: number
  valoreTitoli: number
  patrimonio: number
  azionario: number
  obbligazionario: number
  altro: number
  latente: number // plusvalenza latente non realizzata sui titoli
  lt: RisultatoLookthrough
  coperturaAzionario: number // % del valore azionario (ETF normali) con composizione inserita
}

export interface RisultatoSimulazione {
  prima: StatoPortafoglio
  dopo: StatoPortafoglio
  dettagli: DettaglioOperazione[]
  totali: {
    venditeLorde: number
    acquisti: number
    costi: number
    plusRealizzata: number
    imposta: number
    nettoReinvestibile: number
  }
  avvisi: string[]
}

function costruisciStato(
  strumenti: StrumentoSim[],
  qta: Map<string, number>,
  costoBase: Map<string, number>,
  liquidita: number,
  composizioni: ComposizioneEtf[],
): StatoPortafoglio {
  const compPerId = new Map(composizioni.map(c => [c.portafoglio_id, c]))
  const posizioni = strumenti.map(s => {
    const q = qta.get(s.id) ?? 0
    return { s, qta: q, valore: q * s.prezzo }
  })
  const somma = (f: (p: (typeof posizioni)[number]) => boolean) =>
    posizioni.filter(f).reduce((a, p) => a + p.valore, 0)

  const valoreTitoli = posizioni.reduce((a, p) => a + p.valore, 0)
  const azionario = somma(p => p.s.classe === 'azionario')
  const obbligazionario = somma(p => p.s.classe === 'obbligazionario')
  const altro = somma(p => p.s.classe === 'altro')
  const latente = posizioni.reduce((a, p) => a + (p.valore - (costoBase.get(p.s.id) ?? 0)), 0)

  // Look-through: ETF azionari normali + strumenti a leva (che sottraggono esposizione)
  const etf: PosizioneEtf[] = []
  const comps: ComposizioneEtf[] = []
  for (const p of posizioni) {
    const { s } = p
    const inversoOLeva = s.leva !== 1
    if (!(s.classe === 'azionario' && !inversoOLeva) && !inversoOLeva) continue
    etf.push({ id: s.id, nome: s.nome, ticker: s.ticker, valore: p.valore * s.leva })
    const sorgente = inversoOLeva && s.riferimentoId ? compPerId.get(s.riferimentoId) : compPerId.get(s.id)
    if (sorgente) comps.push({ ...sorgente, portafoglio_id: s.id })
  }
  const lt = calcolaLookthrough(etf, comps)

  const conDati = new Set(lt.coperture.filter(c => c.hasDati).map(c => c.etfId))
  const valoreNormaliConDati = posizioni
    .filter(p => p.s.classe === 'azionario' && p.s.leva === 1 && conDati.has(p.s.id))
    .reduce((a, p) => a + p.valore, 0)

  return {
    posizioni, liquidita, valoreTitoli,
    patrimonio: valoreTitoli + liquidita,
    azionario, obbligazionario, altro, latente, lt,
    coperturaAzionario: azionario > 0 ? (valoreNormaliConDati / azionario) * 100 : 0,
  }
}

export function simula(
  strumenti: StrumentoSim[],
  liquiditaIniziale: number,
  operazioni: Operazione[],
  composizioni: ComposizioneEtf[],
  variazioneLiquidita = 0,
): RisultatoSimulazione {
  const qta0 = new Map(strumenti.map(s => [s.id, s.qta]))
  const costo0 = new Map(strumenti.map(s => [s.id, s.qta * s.pmc]))
  const prima = costruisciStato(strumenti, qta0, costo0, liquiditaIniziale, composizioni)

  const qta = new Map(qta0)
  const costoBase = new Map(costo0)
  let liq = liquiditaIniziale + variazioneLiquidita
  const dettagli: DettaglioOperazione[] = []
  const avvisiGlobali: string[] = []

  for (const op of operazioni) {
    const s = strumenti.find(x => x.id === op.strumentoId)
    if (!s) continue
    const avvisi: string[] = []
    if (!(s.prezzo > 0)) {
      avvisi.push('Prezzo non disponibile: operazione ignorata')
      dettagli.push({ op, strumento: s, qta: 0, lordo: 0, costi: 0, pmc: 0, plus: 0, imposta: 0, netto: 0, avvisi })
      continue
    }
    const corrente = qta.get(s.id) ?? 0
    const costoCorr = costoBase.get(s.id) ?? 0
    const pmcCorr = corrente > 0 ? costoCorr / corrente : s.pmc
    const costi = Math.max(op.costi || 0, 0)
    let q = 0

    if (op.tipo === 'vendi') {
      if (op.modo === 'tutto') q = corrente
      else if (op.modo === 'percentuale') q = (s.qta * Math.max(op.valore, 0)) / 100
      else if (op.modo === 'quantita') q = op.valore
      else q = op.valore / s.prezzo
      if (q > corrente + 1e-9) {
        avvisi.push(`Quantità ridotta al disponibile (${corrente.toLocaleString('it-IT', { maximumFractionDigits: 4 })})`)
        q = corrente
      }
      q = Math.max(q, 0)
      const lordo = q * s.prezzo
      const plus = q * (s.prezzo - pmcCorr) - (q > 0 ? costi : 0)
      const imposta = plus > 0 ? (plus * Math.max(op.aliquota, 0)) / 100 : 0
      const netto = lordo - (q > 0 ? costi : 0) - imposta
      qta.set(s.id, corrente - q)
      costoBase.set(s.id, costoCorr - q * pmcCorr)
      liq += netto
      dettagli.push({ op, strumento: s, qta: q, lordo, costi: q > 0 ? costi : 0, pmc: pmcCorr, plus, imposta, netto, avvisi })
    } else {
      q = op.modo === 'quantita' ? op.valore : op.valore / s.prezzo
      q = Math.max(q, 0)
      const lordo = q * s.prezzo
      const esborso = lordo + (q > 0 ? costi : 0)
      qta.set(s.id, corrente + q)
      costoBase.set(s.id, costoCorr + esborso) // i costi di acquisto entrano nel costo fiscale
      liq -= esborso
      dettagli.push({ op, strumento: s, qta: q, lordo, costi: q > 0 ? costi : 0, pmc: s.prezzo, plus: 0, imposta: 0, netto: -esborso, avvisi })
    }
  }

  const dopo = costruisciStato(strumenti, qta, costoBase, liq, composizioni)
  if (liq < -0.5) avvisiGlobali.push(`Liquidità negativa (${Math.round(liq).toLocaleString('it-IT')} €): gli acquisti superano le disponibilità`)

  const vendite = dettagli.filter(d => d.op.tipo === 'vendi')
  const acquisti = dettagli.filter(d => d.op.tipo === 'acquista')
  const totali = {
    venditeLorde: vendite.reduce((a, d) => a + d.lordo, 0),
    acquisti: acquisti.reduce((a, d) => a + d.lordo, 0),
    costi: dettagli.reduce((a, d) => a + d.costi, 0),
    plusRealizzata: vendite.reduce((a, d) => a + d.plus, 0),
    imposta: vendite.reduce((a, d) => a + d.imposta, 0),
    nettoReinvestibile: vendite.reduce((a, d) => a + d.netto, 0),
  }
  return { prima, dopo, dettagli, totali, avvisi: avvisiGlobali }
}
