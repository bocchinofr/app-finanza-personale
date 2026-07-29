import { AssetPortafoglio, Movimento, statoAttuale } from '@/types'

// ============================================================
// Matching: trova l'asset di portafoglio corrispondente a un
// movimento ETF, cercando nome/ticker dentro nome_etf o descrizione.
// ============================================================

function normalizza(s: string): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cerca il miglior asset corrispondente per un movimento.
 * Priorità: ticker esatto (parola intera) > nome asset contenuto nel testo > punteggio parole in comune.
 * Ritorna null se non trova nulla di sufficientemente convincente.
 */
export function trovaAssetCorrispondente(
  movimento: Movimento,
  portafoglio: AssetPortafoglio[]
): AssetPortafoglio | null {
  const testo = normalizza(`${movimento.nome_etf} ${movimento.descrizione}`)
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
  // Formato italiano "1.234,56" -> "1234.56"
  if (/,\d{1,2}$/.test(s) && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export function estraiQuantitaPrezzo(descrizione: string): EstrattoDescrizione {
  const testo = descrizione || ''
  const numero = '\\d[\\d.,]*'

  // Pattern comuni: "QTA 12,5 PREZZO 34,20" / "QUANTITA' 12.5 A 34.20"
  // / "12,5 X 34,20" / "N. QUOTE 12,5"
  const patQta = new RegExp(`(?:QT[AÀ'\\.]?|QUANTIT[AÀ'\\.]+|N\\.?\\s?QUOTE|QUOTE)\\s*[:\\-]?\\s*(${numero})`, 'i')
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
