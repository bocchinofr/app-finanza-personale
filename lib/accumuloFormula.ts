/**
 * Calcolo dell'importo consigliato per l'accumulo su un singolo asset.
 *
 * Idea: il budget assegnato all'asset (vedi calcolaBudgetPerAsset) viene
 * "sbloccato" progressivamente in due fasi, in funzione del prezzo attuale:
 *
 *  Fase A — prezzo tra il massimo (52 settimane) e il PMC (prezzo medio di
 *  carico): la quota di budget sbloccata cresce linearmente da 0% a
 *  `frazioneAPmc` (default 40%) man mano che il prezzo scende verso il PMC.
 *
 *  Fase B — prezzo sotto il PMC (l'asset è "in perdita" rispetto al costo
 *  medio): la quota residua (dal 40% al 100%) viene sbloccata con una curva
 *  convessa (esponente `esponenteAccelerazione`, default 2): più si scende
 *  sotto il PMC, più ogni ulteriore punto percentuale di ribasso vale un
 *  importo maggiore rispetto al precedente.
 *
 * `ddMaxSottoPmc` è la profondità di ribasso sotto il PMC (in frazione,
 * es. 0.30 = -30%) alla quale si considera sbloccato il 100% del budget.
 * Di default si riusa `dd_max` del profilo investitore.
 */
export interface AccumuloInput {
  prezzoAttuale: number
  prezzoMassimo: number
  pmc: number
  budgetAsset: number
  ddMaxSottoPmc: number
  frazioneAPmc?: number
  esponenteAccelerazione?: number
}

export function calcolaFrazioneSbloccata({
  prezzoAttuale, prezzoMassimo, pmc, ddMaxSottoPmc,
  frazioneAPmc = 0.4, esponenteAccelerazione = 2,
}: Omit<AccumuloInput, 'budgetAsset'>): number {
  if (prezzoMassimo <= 0 || prezzoAttuale <= 0) return 0

  const ddDalMassimo = Math.max(0, (prezzoMassimo - prezzoAttuale) / prezzoMassimo)
  const ddMassimoAlPmc = pmc > 0 ? Math.max(0, (prezzoMassimo - pmc) / prezzoMassimo) : 0

  let frazione: number
  if (prezzoAttuale >= pmc || pmc <= 0) {
    // Fase A: sopra o al PMC — rampa lineare 0 → frazioneAPmc
    frazione = ddMassimoAlPmc > 0 ? Math.min(ddDalMassimo / ddMassimoAlPmc, 1) * frazioneAPmc : 0
  } else {
    // Fase B: sotto il PMC — accelerazione convessa frazioneAPmc → 100%
    const ddSottoPmc = (pmc - prezzoAttuale) / pmc
    const progresso = ddMaxSottoPmc > 0 ? Math.min(ddSottoPmc / ddMaxSottoPmc, 1) : 1
    frazione = frazioneAPmc + (1 - frazioneAPmc) * Math.pow(progresso, esponenteAccelerazione)
  }

  return Math.min(Math.max(frazione, 0), 1)
}

export function calcolaImportoConsigliato(input: AccumuloInput): number {
  if (input.budgetAsset <= 0) return 0
  return input.budgetAsset * calcolaFrazioneSbloccata(input)
}

/**
 * Divide la riserva totale tra gli asset che hanno almeno una soglia attiva,
 * pesando per l'aggressività della soglia più bassa impostata su ciascuno
 * (soglia più bassa = si vuole iniziare ad accumulare prima = fetta maggiore).
 * Peso = 1 / soglia_pct_minima, normalizzato a somma 1.
 */
export function calcolaBudgetPerAsset(
  riservaTotale: number,
  sogliePerAsset: Map<string, number[]> // portafoglio_id -> soglie_pct attive
): Map<string, number> {
  const pesi = new Map<string, number>()
  let sommaPesi = 0
  for (const [assetId, soglie] of sogliePerAsset.entries()) {
    if (soglie.length === 0) continue
    const sogliaMin = Math.min(...soglie)
    if (sogliaMin <= 0) continue
    const peso = 1 / sogliaMin
    pesi.set(assetId, peso)
    sommaPesi += peso
  }

  const budget = new Map<string, number>()
  if (sommaPesi <= 0) return budget
  for (const [assetId, peso] of pesi.entries()) {
    budget.set(assetId, riservaTotale * (peso / sommaPesi))
  }
  return budget
}

/* ------------------------------------------------------------------ *
 *  NUOVO CALCOLO SEMPLIFICATO (3 passi)
 *
 *  1. BUDGET     = liquidità svincolata + asset svincolati (riserva)
 *  2. QUOTA      = per ogni classe (azioni/obbligazioni) si usa al massimo quanto
 *                  manca al peso target; il budget di classe è diviso in parti
 *                  uguali tra gli ETF scattati della classe e sbloccato in
 *                  proporzione al ribasso dal massimo (ribasso ÷ DD max).
 *  3. LIMITE PMC = l'importo viene ridotto se il nuovo PMC supererebbe il
 *                  limite scelto (es. +2%). Sotto il PMC non c'è limite.
 * ------------------------------------------------------------------ */

export interface TargetAllocazione {
  azioni: number        // % (0-100)
  obbligazioni: number  // % (0-100)
  liquidita: number     // % (0-100)
}

export type ClasseAsset = 'azionario' | 'obbligazionario' | 'altro' | null | undefined

export interface AssetScattato {
  id: string
  classe: ClasseAsset
  prezzo: number
  pmc: number
  quantita: number
  ribassoDalMax: number // frazione positiva, es. 0.12 = -12% dal massimo
}

export interface ConsigliInput {
  riserva: number
  valoreAzionario: number
  valoreObbligazionario: number
  liquiditaTotale: number
  target: TargetAllocazione | null
  ddMax: number               // frazione, es. 0.30
  limitePmc: number | null    // frazione, es. 0.02 = max +2% sul PMC
  scattati: AssetScattato[]
}

export interface ConsiglioAsset {
  id: string
  budgetClasse: number   // passo 2: budget della classe assegnato all'ETF (parte uguale)
  quota: number          // passo 2: frazione sbloccata (0-1) in base al ribasso
  importoLordo: number   // budgetClasse × quota
  importo: number        // dopo limite PMC
  limitatoDaPmc: boolean
  pmcAttuale: number
  nuovoPmc: number | null
}

/** Nuovo PMC dopo aver acquistato `importo` € a `prezzo`. */
export function nuovoPmcDopoAcquisto(quantita: number, pmc: number, prezzo: number, importo: number): number | null {
  if (prezzo <= 0) return null
  const nuovaQta = quantita + importo / prezzo
  if (nuovaQta <= 0) return null
  return (quantita * pmc + importo) / nuovaQta
}

/** Importo massimo che mantiene il nuovo PMC entro PMC × (1 + limite). */
export function importoMassimoPerLimitePmc(quantita: number, pmc: number, prezzo: number, limite: number): number {
  if (quantita <= 0 || pmc <= 0 || prezzo <= 0) return Infinity
  const c = 1 - (pmc * (1 + limite)) / prezzo
  if (c <= 0) return Infinity // prezzo entro il limite: acquistare non può superarlo
  return (quantita * pmc * limite) / c
}

export function calcolaConsigli(input: ConsigliInput): Map<string, ConsiglioAsset> {
  const { riserva, valoreAzionario, valoreObbligazionario, liquiditaTotale, target, ddMax, limitePmc, scattati } = input
  const out = new Map<string, ConsiglioAsset>()
  if (riserva <= 0 || scattati.length === 0) return out

  const totale = valoreAzionario + valoreObbligazionario + liquiditaTotale
  const gapClasse = (classe: ClasseAsset): number => {
    if (!target || totale <= 0) return riserva // nessun target: nessun limite di classe
    if (classe === 'azionario') return Math.max(0, (target.azioni / 100) * totale - valoreAzionario)
    if (classe === 'obbligazionario') return Math.max(0, (target.obbligazioni / 100) * totale - valoreObbligazionario)
    return riserva
  }

  // Raggruppa per classe
  const perClasse = new Map<string, AssetScattato[]>()
  for (const a of scattati) {
    const k = a.classe === 'azionario' || a.classe === 'obbligazionario' ? a.classe : 'altro'
    perClasse.set(k, [...(perClasse.get(k) ?? []), a])
  }

  // Pool per classe: al massimo il gap rispetto al target; se la somma supera la riserva si riduce in proporzione
  const pool = new Map<string, number>()
  let sommaPool = 0
  for (const k of perClasse.keys()) {
    const p = Math.min(gapClasse(k as ClasseAsset), riserva)
    pool.set(k, p)
    sommaPool += p
  }
  const scala = sommaPool > riserva ? riserva / sommaPool : 1

  for (const [k, assets] of perClasse.entries()) {
    const base = ((pool.get(k) ?? 0) * scala) / assets.length
    for (const a of assets) {
      const quota = ddMax > 0 ? Math.min(Math.max(a.ribassoDalMax / ddMax, 0), 1) : 1
      const lordo = base * quota
      let importo = lordo
      let limitato = false
      if (limitePmc != null) {
        const max = importoMassimoPerLimitePmc(a.quantita, a.pmc, a.prezzo, limitePmc)
        if (importo > max) { importo = max; limitato = true }
      }
      out.set(a.id, {
        id: a.id,
        budgetClasse: base,
        quota,
        importoLordo: lordo,
        importo,
        limitatoDaPmc: limitato,
        pmcAttuale: a.pmc,
        nuovoPmc: nuovoPmcDopoAcquisto(a.quantita, a.pmc, a.prezzo, importo),
      })
    }
  }
  return out
}
