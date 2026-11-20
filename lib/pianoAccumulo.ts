// lib/pianoAccumulo.ts
// Calcolo puro (nessun accesso a DB/rete) del "Piano di accumulo".
// Usato sia dalla sezione in app sia da checkAlertsCore (alert e mail):
// gli importi sono quindi identici ovunque.
//
//  1. RISERVA  R      = liquidità svincolata + asset svincolati
//  2. QUOTA asset     = R × peso dell'asset (uguale per tutti, o % manuale)
//  3. TRANCHE i       = quota asset × peso della soglia i (uguale / crescente / manuale)
//  4. IMPORTO tranche =
//       sotto PMC : tranche × M,  M = 1 + bonus × (% sotto PMC ÷ 10), max `moltMax`
//       sopra PMC : tranche, ridotta se il nuovo PMC supera il limite scelto
//     In ogni caso non si supera la quota dell'asset (niente prestiti dagli altri asset).
import { importoMassimoPerLimitePmc, nuovoPmcDopoAcquisto } from '@/lib/accumuloFormula'

export type Distribuzione = 'uguale' | 'crescente' | 'manuale'

export const SOGLIE_DEFAULT = [5, 10, 15, 20]

export interface PianoConfig {
  /** bonus di acquisto per ogni -10% sotto il PMC (0.5 = +50% ogni -10%) */
  bonusSottoPmc: number
  /** moltiplicatore massimo applicabile a una tranche (es. 2 = al massimo il doppio) */
  moltMax: number
  /** frazione, es. 0.02 = il nuovo PMC non può salire oltre +2%; null = nessun limite */
  limitePmc: number | null
}

export const PIANO_CONFIG_DEFAULT: PianoConfig = { bonusSottoPmc: 0.5, moltMax: 2, limitePmc: 0.02 }

export interface TrancheInput {
  id?: string
  sogliaPct: number // ribasso dal massimo, positivo (10 = -10%)
  pesoPct: number   // % della quota dell'asset (somma 100)
}

/** Pesi (somma 100) delle soglie, in ordine di ribasso crescente. */
export function pesiDistribuzione(n: number, tipo: Exclude<Distribuzione, 'manuale'>): number[] {
  if (n <= 0) return []
  if (tipo === 'uguale') return Array.from({ length: n }, () => 100 / n)
  const somma = (n * (n + 1)) / 2
  return Array.from({ length: n }, (_, i) => ((i + 1) / somma) * 100)
}

/** Quota di riserva di ciascun asset: uguale se nessuna % manuale, altrimenti la % indicata. */
export function ripartisciRiserva(
  riserva: number,
  assets: { id: string; quotaPct: number | null }[]
): Map<string, number> {
  const out = new Map<string, number>()
  if (assets.length === 0 || riserva <= 0) return out
  const manuali = assets.filter(a => a.quotaPct != null)
  const sommaManuali = manuali.reduce((s, a) => s + (a.quotaPct as number), 0)
  const automatici = assets.filter(a => a.quotaPct == null)
  const restoPct = Math.max(0, 100 - sommaManuali)
  for (const a of assets) {
    if (a.quotaPct != null) out.set(a.id, riserva * (a.quotaPct / 100))
    else out.set(a.id, automatici.length > 0 ? riserva * (restoPct / 100) / automatici.length : 0)
  }
  return out
}

export interface RigaPiano {
  id?: string
  sogliaPct: number
  pesoPct: number
  base: number               // quota × peso (senza moltiplicatore)
  scattata: boolean          // il ribasso attuale ha raggiunto la soglia
  ora: boolean               // è la tranche da investire adesso (la più profonda tra quelle scattate)
  storica: boolean           // scattata prima, si presume già gestita
  prezzoRif: number          // prezzo a cui è calcolata (attuale se scattata, ipotetico se in attesa)
  pmcPrima: number
  sottoPmc: boolean
  moltiplicatore: number
  lordo: number              // base × moltiplicatore (dopo il tetto di quota)
  importo: number            // dopo il limite PMC
  limitataDaPmc: boolean
  limitataDaQuota: boolean
  nuovoPmc: number | null
  residuoDopo: number        // quota dell'asset ancora libera dopo questa tranche
}

export interface PianoAsset {
  quota: number
  righe: RigaPiano[]
  /** importo da investire adesso (tranche "ora"), 0 se nessuna soglia scattata */
  importoOra: number
  /** somma degli importi previsti per le tranche ancora in attesa */
  importoInAttesa: number
}

export interface PianoAssetInput {
  quota: number
  tranche: TrancheInput[]
  prezzo: number
  pmc: number
  quantita: number
  /** ribasso attuale dal massimo, frazione positiva (0.12 = -12%) */
  ribasso: number
  config: PianoConfig
  /** se presente: tranche appena scattate (alert). Le altre già scattate si considerano storiche. */
  nuoveIds?: Set<string>
}

export function moltiplicatoreSottoPmc(prezzo: number, pmc: number, cfg: Pick<PianoConfig, 'bonusSottoPmc' | 'moltMax'>): number {
  if (pmc <= 0 || prezzo >= pmc) return 1
  const ddSotto = (pmc - prezzo) / pmc
  return Math.min(Math.max(1, cfg.moltMax), 1 + cfg.bonusSottoPmc * (ddSotto / 0.10))
}

export function calcolaPianoAsset(input: PianoAssetInput): PianoAsset {
  const { quota, prezzo, pmc, quantita, ribasso, config, nuoveIds } = input
  const tranche = [...input.tranche].sort((a, b) => a.sogliaPct - b.sogliaPct)
  const prezzoMax = ribasso > 0 && ribasso < 1 ? prezzo / (1 - ribasso) : prezzo

  const scattate = tranche.map(t => ribasso * 100 >= t.sogliaPct - 1e-9)
  // Tranche da investire adesso: se sono note le "nuove" (alert) quelle, altrimenti la più profonda scattata
  let idxOra: number[] = []
  if (nuoveIds && nuoveIds.size > 0) {
    idxOra = tranche.map((t, i) => (t.id && nuoveIds.has(t.id) && scattate[i] ? i : -1)).filter(i => i >= 0)
  } else {
    const ultima = scattate.lastIndexOf(true)
    if (ultima >= 0) idxOra = [ultima]
  }

  // Le scattate che non sono "ora" si presumono già investite al loro valore base
  const spesoStorico = tranche.reduce((s, t, i) => s + (scattate[i] && !idxOra.includes(i) ? (quota * t.pesoPct) / 100 : 0), 0)
  let residuo = Math.max(0, quota - spesoStorico)
  let qta = quantita
  let pmcCorr = pmc

  const righe: RigaPiano[] = []
  let importoOra = 0
  let importoInAttesa = 0

  tranche.forEach((t, i) => {
    const base = (quota * t.pesoPct) / 100
    const ora = idxOra.includes(i)
    const storica = scattate[i] && !ora
    if (storica) {
      righe.push({
        id: t.id, sogliaPct: t.sogliaPct, pesoPct: t.pesoPct, base, scattata: true, ora: false, storica: true,
        prezzoRif: prezzo, pmcPrima: pmc, sottoPmc: prezzo < pmc, moltiplicatore: 1,
        lordo: base, importo: base, limitataDaPmc: false, limitataDaQuota: false,
        nuovoPmc: null, residuoDopo: residuo,
      })
      return
    }
    const prezzoRif = ora ? prezzo : prezzoMax * (1 - t.sogliaPct / 100)
    const sottoPmc = pmcCorr > 0 && prezzoRif < pmcCorr
    const molt = moltiplicatoreSottoPmc(prezzoRif, pmcCorr, config)
    let lordo = base * molt
    const limitataDaQuota = lordo > residuo
    lordo = Math.min(lordo, residuo)
    let importo = lordo
    let limitataDaPmc = false
    if (!sottoPmc && config.limitePmc != null) {
      const max = importoMassimoPerLimitePmc(qta, pmcCorr, prezzoRif, config.limitePmc)
      if (importo > max) { importo = max; limitataDaPmc = true }
    }
    const nuovoPmc = nuovoPmcDopoAcquisto(qta, pmcCorr, prezzoRif, importo)
    righe.push({
      id: t.id, sogliaPct: t.sogliaPct, pesoPct: t.pesoPct, base, scattata: scattate[i], ora, storica: false,
      prezzoRif, pmcPrima: pmcCorr, sottoPmc, moltiplicatore: molt, lordo, importo,
      limitataDaPmc, limitataDaQuota, nuovoPmc, residuoDopo: Math.max(0, residuo - importo),
    })
    if (ora) importoOra += importo
    else importoInAttesa += importo
    // lo stato evolve: si presume l'acquisto per le tranche successive
    if (prezzoRif > 0 && importo > 0) {
      const nq = qta + importo / prezzoRif
      pmcCorr = (qta * pmcCorr + importo) / nq
      qta = nq
    }
    residuo = Math.max(0, residuo - importo)
  })

  return { quota, righe, importoOra, importoInAttesa }
}
