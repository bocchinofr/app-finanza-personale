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
