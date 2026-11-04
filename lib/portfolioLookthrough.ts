// lib/portfolioLookthrough.ts
// Motore di calcolo "puro" (nessun accesso a DB/rete) per l'analisi look-through:
// parsing dei dati incollati, normalizzazione nomi e aggregazione delle esposizioni.
// Regola di fondo: nessun dato viene inventato o completato. Quello che non è
// dettagliato resta "non dettagliato" e la copertura è sempre esplicita.

export interface VocePeso {
  nome: string
  peso: number // percentuale 0-100 all'interno dell'ETF
}

// Metadati degli strumenti "nuovi" della libreria simulatore (righe con id che inizia per "sim:")
export interface MetaStrumento {
  nome: string
  ticker: string
  classe: 'azionario' | 'obbligazionario' | 'altro'
  leva: number // 1 = normale, -1 / -2 = inverso
  riferimentoId?: string | null // per gli inversi: ETF reale di cui usare la composizione
  prezzo?: number | null // ultimo prezzo noto in euro
  valuta?: 'EUR' | 'USD'
  azioneSingola?: boolean
}

export interface ComposizioneEtf {
  portafoglio_id: string
  meta?: MetaStrumento | null
  top_holdings: VocePeso[]
  settori: VocePeso[]
  paesi: VocePeso[]
  aggiornato_at: string | null
}

export interface PosizioneEtf {
  id: string
  nome: string
  ticker: string
  valore: number // valore attuale in euro
}

// ---------- Parsing numeri e testo incollato ----------

export function parseNumero(raw: string): number | null {
  let s = raw.trim().replace('%', '').replace(/\s/g, '')
  if (!s || !/[0-9]/.test(s)) return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // l'ultimo separatore è il decimale
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const SOLO_NUMERO = /^[-+]?\d{1,3}(?:[.,]\d+)?\s*%?$/
const NUMERO_IN_CODA = /^(.*?)[\s\t]+([-+]?\d{1,3}(?:[.,]\d+)?\s*%?)$/

export interface RisultatoParsing {
  voci: VocePeso[]
  scartate: string[]
  somma: number
}

// Accetta righe "Nome  4,87%", "Nome<TAB>4.87", oppure nome e peso su righe
// consecutive (come spesso copiato da justETF). Ignora la numerazione iniziale.
export function parseIncolla(testo: string): RisultatoParsing {
  const righe = testo.split(/\r?\n/).map(r => r.trim()).filter(Boolean)
  const voci: VocePeso[] = []
  const scartate: string[] = []
  let nomePendente: string | null = null

  const pulisciNome = (n: string) => n.replace(/^\d{1,2}[.)]\s+/, '').replace(/\s+/g, ' ').trim()

  for (const riga of righe) {
    if (SOLO_NUMERO.test(riga)) {
      const peso = parseNumero(riga)
      if (nomePendente && peso !== null) {
        voci.push({ nome: nomePendente, peso })
        nomePendente = null
      } else {
        scartate.push(riga)
      }
      continue
    }
    const m = riga.match(NUMERO_IN_CODA)
    if (m) {
      const nome = pulisciNome(m[1])
      const peso = parseNumero(m[2])
      if (nome && peso !== null) {
        voci.push({ nome, peso })
        nomePendente = null
        continue
      }
    }
    // riga di solo testo: potenzialmente il nome, con il peso nella riga successiva
    if (nomePendente) scartate.push(nomePendente)
    nomePendente = pulisciNome(riga)
  }
  if (nomePendente) scartate.push(nomePendente)

  const somma = voci.reduce((s, v) => s + v.peso, 0)
  return { voci, scartate, somma }
}

// ---------- Normalizzazione nomi ----------

const PAROLE_SOCIETARIE = new Set([
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'sa', 'ag', 'nv', 'se',
  'spa', 'the', 'adr', 'ordinary', 'shares', 'holdings', 'holding', 'group',
])

// Chiave di confronto: stessa società in ETF diversi ("Microsoft Corp" / "MICROSOFT").
export function normalizzaSocieta(nome: string): string {
  let s = nome.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ')
  s = s.replace(/\bclass\s+[a-z]\b/g, ' ').replace(/\s+[abc]$/g, ' ')
  const parole = s.split(/\s+/).filter(p => p && !PAROLE_SOCIETARIE.has(p))
  return parole.join(' ') || nome.toLowerCase().trim()
}

const SINONIMI_SETTORI: Record<string, string> = {
  'technology': 'Information Technology',
  'information technology': 'Information Technology',
  'tecnologia': 'Information Technology',
  'tecnologia dell informazione': 'Information Technology',
  'financials': 'Financials',
  'financial services': 'Financials',
  'finanza': 'Financials',
  'finanziari': 'Financials',
  'health care': 'Health Care',
  'healthcare': 'Health Care',
  'salute': 'Health Care',
  'sanita': 'Health Care',
  'consumer discretionary': 'Consumer Discretionary',
  'consumer cyclical': 'Consumer Discretionary',
  'beni di consumo ciclici': 'Consumer Discretionary',
  'consumer staples': 'Consumer Staples',
  'consumer defensive': 'Consumer Staples',
  'beni di consumo difensivi': 'Consumer Staples',
  'communication services': 'Communication Services',
  'telecommunication': 'Communication Services',
  'telecommunications': 'Communication Services',
  'comunicazioni': 'Communication Services',
  'materials': 'Materials',
  'basic materials': 'Materials',
  'materiali': 'Materials',
  'industrials': 'Industrials',
  'industriali': 'Industrials',
  'energy': 'Energy',
  'energia': 'Energy',
  'utilities': 'Utilities',
  'servizi di pubblica utilita': 'Utilities',
  'real estate': 'Real Estate',
  'immobiliare': 'Real Estate',
}

const SINONIMI_PAESI: Record<string, string> = {
  'usa': 'United States',
  'us': 'United States',
  'united states': 'United States',
  'united states of america': 'United States',
  'stati uniti': 'United States',
  'uk': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'regno unito': 'United Kingdom',
  'giappone': 'Japan',
  'japan': 'Japan',
  'francia': 'France',
  'germania': 'Germany',
  'svizzera': 'Switzerland',
  'canada': 'Canada',
  'australia': 'Australia',
  'cina': 'China',
  'italia': 'Italy',
  'paesi bassi': 'Netherlands',
  'olanda': 'Netherlands',
  'taiwan': 'Taiwan',
  'india': 'India',
  'corea del sud': 'South Korea',
}

function senzaAccenti(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function chiaveSettore(nome: string): string {
  const k = senzaAccenti(nome.toLowerCase()).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return SINONIMI_SETTORI[k] ?? nome.trim()
}

export function chiavePaese(nome: string): string {
  const k = senzaAccenti(nome.toLowerCase()).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return SINONIMI_PAESI[k] ?? nome.trim()
}

// ---------- Aggregazione look-through ----------

export interface ContributoEtf {
  etfId: string
  etfNome: string
  euro: number
}

export interface EsposizioneSocieta {
  chiave: string
  nome: string
  euro: number
  contributi: ContributoEtf[]
  nEtf: number
}

export interface EsposizioneVoce {
  nome: string
  euro: number
  contributi: ContributoEtf[]
}

export interface CopertureEtf {
  etfId: string
  hasDati: boolean
  copertura: number | null // % top holdings sul peso dell'ETF
  coperturaSettori: number | null
  coperturaPaesi: number | null
}

export interface RisultatoLookthrough {
  societa: EsposizioneSocieta[] // ordinate per euro desc
  settori: EsposizioneVoce[]
  paesi: EsposizioneVoce[]
  coperture: CopertureEtf[]
  valoreConDati: number // valore degli ETF azionari con composizione inserita
  valoreSenzaDati: number
  euroSocietaDettagliate: number
  euroSettoriDettagliati: number
  euroPaesiDettagliati: number
}

function sommaPesi(v: VocePeso[]): number {
  return v.reduce((s, x) => s + x.peso, 0)
}

export function calcolaLookthrough(
  etf: PosizioneEtf[],
  composizioni: ComposizioneEtf[],
): RisultatoLookthrough {
  const perId = new Map(composizioni.map(c => [c.portafoglio_id, c]))
  const societa = new Map<string, EsposizioneSocieta>()
  const settori = new Map<string, EsposizioneVoce>()
  const paesi = new Map<string, EsposizioneVoce>()
  const coperture: CopertureEtf[] = []
  let valoreConDati = 0
  let valoreSenzaDati = 0
  let euroSocietaDettagliate = 0
  let euroSettoriDettagliati = 0
  let euroPaesiDettagliati = 0

  const aggiungi = (
    mappa: Map<string, EsposizioneVoce>, chiave: string, nome: string, e: PosizioneEtf, euro: number,
  ) => {
    const cur = mappa.get(chiave) ?? { nome, euro: 0, contributi: [] }
    cur.euro += euro
    cur.contributi.push({ etfId: e.id, etfNome: e.nome, euro })
    mappa.set(chiave, cur)
  }

  for (const e of etf) {
    const c = perId.get(e.id)
    const ha = !!c && (c.top_holdings.length > 0 || c.settori.length > 0 || c.paesi.length > 0)
    if (!c || !ha) {
      valoreSenzaDati += e.valore
      coperture.push({ etfId: e.id, hasDati: false, copertura: null, coperturaSettori: null, coperturaPaesi: null })
      continue
    }
    valoreConDati += e.valore

    for (const h of c.top_holdings) {
      const euro = (e.valore * h.peso) / 100
      const chiave = normalizzaSocieta(h.nome)
      const cur = societa.get(chiave) ?? { chiave, nome: h.nome.replace(/\s+/g, ' ').trim(), euro: 0, contributi: [], nEtf: 0 }
      cur.euro += euro
      cur.contributi.push({ etfId: e.id, etfNome: e.nome, euro })
      cur.nEtf = new Set(cur.contributi.map(x => x.etfId)).size
      societa.set(chiave, cur)
      euroSocietaDettagliate += euro
    }
    for (const s of c.settori) {
      const euro = (e.valore * s.peso) / 100
      const nome = chiaveSettore(s.nome)
      aggiungi(settori, nome, nome, e, euro)
      euroSettoriDettagliati += euro
    }
    for (const p of c.paesi) {
      const euro = (e.valore * p.peso) / 100
      const nome = chiavePaese(p.nome)
      aggiungi(paesi, nome, nome, e, euro)
      euroPaesiDettagliati += euro
    }

    coperture.push({
      etfId: e.id,
      hasDati: true,
      copertura: c.top_holdings.length ? sommaPesi(c.top_holdings) : null,
      coperturaSettori: c.settori.length ? sommaPesi(c.settori) : null,
      coperturaPaesi: c.paesi.length ? sommaPesi(c.paesi) : null,
    })
  }

  const ordina = <T extends { euro: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.euro - a.euro)
  return {
    societa: ordina(societa),
    settori: ordina(settori),
    paesi: ordina(paesi),
    coperture,
    valoreConDati,
    valoreSenzaDati,
    euroSocietaDettagliate,
    euroSettoriDettagliati,
    euroPaesiDettagliati,
  }
}
