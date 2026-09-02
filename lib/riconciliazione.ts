import { AssetPortafoglio, Movimento, statoAttuale } from '@/types'

// ============================================================
// Matching: trova l'asset di portafoglio corrispondente a un
// movimento ETF, cercando nome/ticker dentro nome_etf o descrizione.
// ============================================================

export function normalizza(s: string): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseDataIt(v: string): Date | null {
  const parti = (v ?? '').trim().split(/[^\d]+/).filter(Boolean)
  if (parti.length !== 3) return null
  const gg = Number(parti[0])
  const mm = Number(parti[1])
  const aaaa = Number(parti[2])
  if (!aaaa || !mm || mm < 1 || mm > 12 || !gg) return null
  return new Date(aaaa, mm - 1, gg)
}

/**
 * Un movimento datato prima della data_acquisto dell'asset è già conteggiato
 * nella quantità di anagrafica: non va proposto in riconciliazione né collegato
 * all'asset (altrimenti verrebbe sommato due volte).
 */
export function movimentoPrecedeAcquisto(movimento: Movimento, asset: AssetPortafoglio): boolean {
  const dataMov = parseDataIt(movimento.data_operazione)
  const dataAcq = parseDataIt(asset.data_acquisto)
  if (!dataMov || !dataAcq) return false
  return dataMov.getTime() < dataAcq.getTime()
}

export interface RegolaMatching {
  pattern: string
  portafoglio_id: string
}

/**
 * Estrae la parte "descrittiva" del movimento, tagliando via la porzione
 * che indica quantità/prezzo (es. "Qta/Val.nom. 4,000000"). Usata sia per
 * il matching automatico che per salvare/riconoscere le regole imparate,
 * così lo stesso ETF con quantità diverse ogni mese produce lo stesso pattern.
 */
export function estraiPattern(testoCompleto: string): string {
  const testo = testoCompleto || ''
  const markerRegex = /QT[AÀ'.]?\s*\/?\s*VAL\.?\s?NOM\.?|QUANTIT[AÀ'.]+|N\.?\s?QUOTE|QUOTE|\d[\d.,]*\s*[xX]\s*\d/i
  const match = testo.match(markerRegex)
  const base = match && match.index && match.index > 0 ? testo.slice(0, match.index) : testo
  return normalizza(base)
}

/**
 * Cerca il miglior asset corrispondente per un movimento.
 * Priorità:
 *  1) regola già confermata in passato per lo stesso pattern di testo (match esatto)
 *  2) ticker esatto (parola intera) > nome asset contenuto nel testo > punteggio parole in comune
 * Ritorna null se non trova nulla di sufficientemente convincente.
 */
export function trovaAssetCorrispondente(
  movimento: Movimento,
  portafoglio: AssetPortafoglio[],
  regole: RegolaMatching[] = []
): AssetPortafoglio | null {
  const testoCompleto = `${movimento.nome_etf} ${movimento.descrizione}`
  const patternMovimento = estraiPattern(testoCompleto)

  if (patternMovimento) {
    const regola = regole.find(r => r.pattern === patternMovimento)
    if (regola) {
      const asset = portafoglio.find(a => a.id === regola.portafoglio_id)
      if (asset) return asset
    }
  }

  const testo = normalizza(testoCompleto)
  if (!testo) return null
  const parole = new Set(testo.split(' ').filter(w => w.length > 1))

  let migliore: AssetPortafoglio | null = null
  let miglioreScore = 0

  for (const a of portafoglio) {
    const ticker = normalizza(a.ticker)
    const nome = normalizza(a.nome || a.descrizione)
    if (!ticker && !nome) continue

    let score = 0

    // Match esatto del ticker come parola intera: massima confidenza
    if (ticker && parole.has(ticker)) score += 100

    // Il nome dell'asset è contenuto per intero nel testo del movimento
    if (nome && testo.includes(nome)) score += 60

    // Punteggio per parole del nome in comune col testo (min 3 lettere)
    if (nome) {
      const paroleNome = nome.split(' ').filter(w => w.length >= 3)
      const comuni = paroleNome.filter(w => parole.has(w)).length
      if (paroleNome.length > 0) score += (comuni / paroleNome.length) * 30
    }

    if (score > miglioreScore) {
      miglioreScore = score
      migliore = a
    }
  }

  // Soglia minima per evitare falsi positivi
  return miglioreScore >= 30 ? migliore : null
}

// ============================================================
// Estrazione quantità/prezzo dalla descrizione del movimento.
// Tollerante a formati diversi (punto/virgola come separatore decimale,
// ordine quantità-prezzo variabile). Best-effort: se non trova nulla
// di affidabile ritorna campi vuoti, da compilare manualmente.
// ============================================================

export interface EstrattoDescrizione {
  quantita: number | null
  prezzo: number | null
}

function parseNumeroFlessibile(raw: string): number | null {
  let s = raw.trim()
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // il separatore che compare per ultimo è quello decimale, l'altro è delle migliaia
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    // convenzione italiana: la virgola è sempre decimale, anche con molte cifre
    // (es. "4,000000" = 4, non 4 milioni)
    s = s.replace(',', '.')
  }

  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export function estraiQuantitaPrezzo(descrizione: string): EstrattoDescrizione {
  const testo = descrizione || ''
  const numero = '\\d[\\d.,]*'

  // Pattern comuni: "QTA 12,5 PREZZO 34,20" / "QUANTITA' 12.5 A 34.20"
  // / "12,5 X 34,20" / "N. QUOTE 12,5" / "Qta/Val.nom. 4,000000"
  const patQta = new RegExp(`(?:QT[AÀ'\\.]?\\s*\\/?\\s*VAL\\.?\\s?NOM\\.?|QT[AÀ'\\.]?|QUANTIT[AÀ'\\.]+|N\\.?\\s?QUOTE|QUOTE)\\s*[:\\-]?\\s*(${numero})`, 'i')
  const patPrezzo = new RegExp(`(?:PREZZO|P\\.?\\s?UNIT|A)\\s*[:\\-]?\\s*(${numero})(?!\\d)`, 'i')
  const patX = new RegExp(`(${numero})\\s*[xX]\\s*(${numero})`)

  let quantita: number | null = null
  let prezzo: number | null = null

  const mX = testo.match(patX)
  if (mX) {
    quantita = parseNumeroFlessibile(mX[1])
    prezzo = parseNumeroFlessibile(mX[2])
  }

  const mQta = testo.match(patQta)
  if (mQta) quantita = parseNumeroFlessibile(mQta[1]) ?? quantita

  const mPrezzo = testo.match(patPrezzo)
  if (mPrezzo) prezzo = parseNumeroFlessibile(mPrezzo[1]) ?? prezzo

  return { quantita, prezzo }
}

// ============================================================
// Calcolo del nuovo stato (quantità + prezzo di carico medio)
// dato un movimento confermato dall'utente.
// ============================================================

export interface RisultatoRiconciliazione {
  nuovaQuantita: number
  nuovoPrezzoCarico: number
  errore?: string
}

export function calcolaNuovoStato(
  asset: AssetPortafoglio,
  movimento: Movimento,
  quantitaMovimento: number
): RisultatoRiconciliazione {
  const { quantita: qtaAttuale, prezzoCarico: prezzoAttuale } = statoAttuale(asset)
  const isAcquisto = movimento.uscite > 0

  if (isAcquisto) {
    const prezzoTransazione = quantitaMovimento > 0 ? movimento.uscite / quantitaMovimento : 0
    const nuovaQuantita = qtaAttuale + quantitaMovimento
    const nuovoPrezzoCarico = nuovaQuantita > 0
      ? (qtaAttuale * prezzoAttuale + quantitaMovimento * prezzoTransazione) / nuovaQuantita
      : prezzoAttuale
    return { nuovaQuantita, nuovoPrezzoCarico }
  }

  // Vendita: la quantità scende, il prezzo di carico medio non cambia
  const nuovaQuantita = qtaAttuale - quantitaMovimento
  if (nuovaQuantita < -0.0001) {
    return {
      nuovaQuantita: qtaAttuale,
      nuovoPrezzoCarico: prezzoAttuale,
      errore: `Quantità venduta (${quantitaMovimento}) superiore a quella posseduta (${qtaAttuale}). Controlla il valore.`,
    }
  }
  return { nuovaQuantita: Math.max(0, nuovaQuantita), nuovoPrezzoCarico: prezzoAttuale }
}
