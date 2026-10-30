// lib/speculativoCalculations.ts
// Dimensionamento e scenari per posizioni short speculative (satellite) finanziate con capitale libero.

export type TipoStrumento = 'etf_inverso' | 'azione'

export interface Correlazione {
  corr: number // correlazione grezza dello strumento coi tuoi long
  beta: number // beta grezzo dello strumento sul paniere long
  n: number // giorni usati
}

export interface SizingInput {
  patrimonio: number
  disponibile: number
  rischioPct: number // perdita massima accettata, % del patrimonio totale
  tettoPct: number // quota massima del capitale disponibile
  stopPct: number // distanza dello stop, % sul prezzo
}

export interface SizingResult {
  limiteRischio: number
  limiteCapitale: number
  importo: number
  vincolo: 'rischio' | 'capitale'
}

export function calcolaSizing(i: SizingInput): SizingResult {
  const limiteRischio = i.stopPct > 0 ? (i.patrimonio * i.rischioPct) / i.stopPct : 0
  const limiteCapitale = Math.max(0, i.disponibile) * (i.tettoPct / 100)
  const importo = Math.max(0, Math.min(limiteRischio, limiteCapitale))
  return { limiteRischio, limiteCapitale, importo, vincolo: limiteRischio <= limiteCapitale ? 'rischio' : 'capitale' }
}

/** Beta della posizione sul paniere long: per l'azione short il segno è invertito. Negativo = copertura. */
export function betaPosizione(tipo: TipoStrumento, c: Correlazione | null): number | null {
  if (!c) return null
  return tipo === 'azione' ? -c.beta : c.beta
}

export function corrPosizione(tipo: TipoStrumento, c: Correlazione | null): number | null {
  if (!c) return null
  return tipo === 'azione' ? -c.corr : c.corr
}

export type QualitaCopertura = 'buona' | 'parziale' | 'debole' | 'inversa'

/** Giudizio sulla copertura a partire dalla correlazione della posizione coi long. */
export function qualitaCopertura(corrPos: number | null): QualitaCopertura | null {
  if (corrPos === null) return null
  if (corrPos > 0) return 'inversa' // si muove come i long: non copre
  const a = Math.abs(corrPos)
  return a >= 0.7 ? 'buona' : a >= 0.4 ? 'parziale' : 'debole'
}

export interface Scenario {
  chiave: 'stop' | 'neutro' | 'target'
  mercatoPct: number | null // movimento implicito dei long
  pnlShort: number
  pnlLong: number
  deltaNetto: number
  patrimonioFinale: number
}

const MAX_MOVIMENTO_IMPLICITO = 60
const BETA_MINIMO = 0.15

export function calcolaScenari(p: {
  patrimonio: number
  valoreLong: number
  capitale: number
  stopPct: number
  targetPct: number
  betaPos: number | null
}): Scenario[] {
  const stimabile = p.betaPos !== null && Math.abs(p.betaPos) >= BETA_MINIMO
  const mov = (rendPosPct: number): number | null => {
    if (!stimabile || p.betaPos === null) return null
    const m = rendPosPct / p.betaPos
    return Math.max(-MAX_MOVIMENTO_IMPLICITO, Math.min(MAX_MOVIMENTO_IMPLICITO, m))
  }
  const costruisci = (chiave: Scenario['chiave'], rendPosPct: number): Scenario => {
    const m = chiave === 'neutro' ? 0 : mov(rendPosPct)
    const pnlShort = (p.capitale * rendPosPct) / 100
    const pnlLong = m === null ? 0 : (p.valoreLong * m) / 100
    const deltaNetto = pnlShort + pnlLong
    return { chiave, mercatoPct: m, pnlShort, pnlLong, deltaNetto, patrimonioFinale: p.patrimonio + deltaNetto }
  }
  return [costruisci('stop', -p.stopPct), costruisci('neutro', 0), costruisci('target', p.targetPct)]
}

export interface RigaMercato {
  mercatoPct: number
  senzaShort: number
  conShort: number | null
}

/** Patrimonio finale per diversi movimenti dei long, con e senza posizione. */
export function calcolaGrigliaMercato(p: {
  patrimonio: number
  valoreLong: number
  capitale: number
  betaPos: number | null
}): RigaMercato[] {
  return [-20, -10, 0, 10].map(m => {
    const pnlLong = (p.valoreLong * m) / 100
    return {
      mercatoPct: m,
      senzaShort: p.patrimonio + pnlLong,
      conShort: p.betaPos === null ? null : p.patrimonio + pnlLong + (p.capitale * p.betaPos * m) / 100,
    }
  })
}

export function calcolaCurva(maxCapitale: number, stopPct: number, targetPct: number, punti = 24) {
  return Array.from({ length: punti + 1 }, (_, k) => {
    const capitale = (maxCapitale * k) / punti
    return {
      capitale: Math.round(capitale),
      perdita: -Math.round((capitale * stopPct) / 100),
      utile: Math.round((capitale * targetPct) / 100),
    }
  })
}

export const NOTA_FISCALE: Record<TipoStrumento, string> = {
  etf_inverso:
    'Utili da ETF: redditi di capitale, non compensabili con minusvalenze. Perdite: redditi diversi, compensabili solo con plusvalenze di tipo diverso.',
  azione:
    'Utili e perdite sono redditi diversi: si compensano tra loro, con riporto delle minusvalenze fino a 4 anni.',
}
