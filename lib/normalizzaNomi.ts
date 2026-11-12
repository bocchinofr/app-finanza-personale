// lib/normalizzaNomi.ts
// Normalizza i nomi di settori e paesi incollati dagli emittenti in un formato unico (italiano).
// Nessun dato su DB: i nomi originali restano salvati, la normalizzazione avviene in lettura.
// Paesi: generati dai codici ISO con Intl.DisplayNames (it + en), quindi nessuna lista da mantenere.
// Settori: i 11 settori GICS sono uno standard stabile.

export interface NomeNormalizzato {
  nome: string // nome canonico (o originale ripulito se non riconosciuto)
  riconosciuto: boolean
}

const senzaAccenti = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Chiave di confronto: minuscolo, senza accenti/punteggiatura, spazi singoli.
export function chiaveTesto(s: string): string {
  return senzaAccenti(s.toLowerCase())
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- Voci generiche (valide per settori e paesi) ----------
const ALTRO = 'Altro'
const LIQUIDITA = 'Liquidità'
const GENERICHE: Record<string, string> = {
  'altro': ALTRO, 'altri': ALTRO, 'other': ALTRO, 'others': ALTRO, 'n a': ALTRO, 'na': ALTRO,
  'non classificato': ALTRO, 'non classificati': ALTRO, 'unclassified': ALTRO, 'not classified': ALTRO,
  'undefined': ALTRO, 'unknown': ALTRO, 'non definito': ALTRO, 'altri settori': ALTRO, 'altri paesi': ALTRO,
  'cash': LIQUIDITA, 'liquidita': LIQUIDITA, 'contanti': LIQUIDITA, 'cash and derivatives': LIQUIDITA,
  'cash and or derivatives': LIQUIDITA, 'cash and equivalents': LIQUIDITA, 'money market': LIQUIDITA,
  'mercato monetario': LIQUIDITA,
}

// ---------- Settori (GICS, nomi italiani) ----------
const SETTORI: Record<string, string[]> = {
  "Tecnologia dell'informazione": [
    'it', 'info tech', 'information technology', 'technology', 'tech', 'tecnologia', 'tecnologico',
    'tecnologia dell informazione', 'tecnologia informatica', 'tecnologie dell informazione',
  ],
  'Finanza': [
    'financials', 'financial', 'financial services', 'finance', 'finanza', 'finanziari', 'finanziario',
    'servizi finanziari', 'settore finanziario',
  ],
  'Sanità': ['health care', 'healthcare', 'health', 'salute', 'sanita', 'sanitario', 'assistenza sanitaria'],
  'Beni di consumo discrezionali': [
    'consumer discretionary', 'consumer cyclical', 'cyclical consumer goods', 'consumi discrezionali',
    'beni di consumo ciclici', 'beni di consumo voluttuari', 'beni voluttuari', 'beni di consumo discrezionali',
  ],
  'Beni di prima necessità': [
    'consumer staples', 'consumer defensive', 'non cyclical consumer goods', 'consumi di base',
    'beni di consumo difensivi', 'beni di prima necessita', 'beni di largo consumo', 'generi alimentari',
  ],
  'Servizi di comunicazione': [
    'communication services', 'communications', 'communication', 'telecommunications', 'telecommunication',
    'telecom', 'comunicazioni', 'servizi di comunicazione', 'telecomunicazioni', 'servizi di telecomunicazione',
  ],
  'Materiali': ['materials', 'basic materials', 'materiali', 'materie prime', 'materiali di base'],
  'Industriali': ['industrials', 'industrial', 'industriali', 'industria', 'beni industriali', 'industriale'],
  'Energia': ['energy', 'energia', 'energetico'],
  'Servizi di pubblica utilità': [
    'utilities', 'utility', 'servizi di pubblica utilita', 'pubblica utilita', 'servizi pubblici',
    'servizi di pubblica utilità', 'servizi di utilita pubblica',
  ],
  'Immobiliare': [
    'real estate', 'realty', 'immobiliare', 'immobiliari', 'settore immobiliare', 'reit', 'reits',
    'real estate investment trusts',
  ],
}

const MAPPA_SETTORI: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const [canonico, alias] of Object.entries(SETTORI)) {
    m.set(chiaveTesto(canonico), canonico)
    for (const a of alias) m.set(chiaveTesto(a), canonico)
  }
  return m
})()

// Rete di sicurezza per varianti non previste (l'ordine conta: i "non ciclici" prima dei "ciclici").
const EURISTICHE_SETTORI: Array<[RegExp, string]> = [
  [/staples|defensive|non cyclical|prima necessit|difensiv|alimentar/, 'Beni di prima necessità'],
  [/discretion|cyclical|ciclic|voluttuar/, 'Beni di consumo discrezionali'],
  [/information tech|info tech|technolog|tecnolog|software|semiconduct/, "Tecnologia dell'informazione"],
  [/health|sanit|salute|pharma|farmac|biotech/, 'Sanità'],
  [/communicat|telecom|comunicaz/, 'Servizi di comunicazione'],
  [/real estate|immobil/, 'Immobiliare'],
  [/utilit|pubblica/, 'Servizi di pubblica utilità'],
  [/financ|finanz|bank|banc|insurance|assicur/, 'Finanza'],
  [/material/, 'Materiali'],
  [/industri/, 'Industriali'],
  [/energ|oil|petrol/, 'Energia'],
]

export function normalizzaSettore(nome: string): NomeNormalizzato {
  const originale = nome.replace(/\s+/g, ' ').trim()
  const k = chiaveTesto(nome)
  const esatto = MAPPA_SETTORI.get(k) ?? GENERICHE[k]
  if (esatto) return { nome: esatto, riconosciuto: true }
  for (const [re, canonico] of EURISTICHE_SETTORI) {
    if (re.test(k)) return { nome: canonico, riconosciuto: true }
  }
  return { nome: originale, riconosciuto: false }
}

// ---------- Paesi (codici ISO + Intl.DisplayNames) ----------
// Nomi che l'emittente scrive in modo diverso dai nomi ISO.
const ALIAS_PAESI: Record<string, string[]> = {
  US: ['usa', 'u s a', 'u s', 'united states of america', 'stati uniti d america', 'stati uniti damerica', 'america', 'us'],
  GB: ['uk', 'u k', 'great britain', 'gran bretagna', 'england', 'inghilterra', 'regno unito'],
  KR: ['korea', 'south korea', 'republic of korea', 'korea republic of', 'korea south', 'corea del sud', 'corea'],
  CN: ['china', 'cina', 'peoples republic of china', 'mainland china', 'china mainland', 'repubblica popolare cinese'],
  HK: ['hong kong', 'hong kong sar china', 'hong kong china', 'china hong kong', 'ras di hong kong'],
  TW: ['taiwan', 'taiwan province of china', 'taiwan china'],
  NL: ['netherlands', 'the netherlands', 'holland', 'olanda', 'paesi bassi'],
  CZ: ['czech republic', 'czechia', 'cechia', 'repubblica ceca'],
  RU: ['russia', 'russian federation', 'federazione russa'],
  AE: ['uae', 'united arab emirates', 'emirati arabi uniti', 'emirati arabi'],
  TR: ['turkey', 'turkiye', 'turchia'],
  IE: ['ireland', 'republic of ireland', 'irlanda'],
  CI: ['ivory coast', 'cote d ivoire', 'costa d avorio'],
  VN: ['vietnam', 'viet nam'],
  LU: ['luxembourg', 'luxemburg', 'lussemburgo'],
  IT: ['italy', 'italia'],
  DE: ['germany', 'germania', 'deutschland'],
  CH: ['switzerland', 'svizzera'],
  ES: ['spain', 'spagna'],
  FR: ['france', 'francia'],
  JP: ['japan', 'giappone'],
}

// Nomi canonici da usare al posto di quelli ISO italiani, più verbosi.
const CANONICO_PAESI: Record<string, string> = {
  HK: 'Hong Kong', MO: 'Macao', CZ: 'Repubblica Ceca', US: 'Stati Uniti', GB: 'Regno Unito',
}

let cachePaesi: { mappa: Map<string, string>; nomi: Map<string, string> } | null = null

function costruisciPaesi() {
  const mappa = new Map<string, string>() // chiave testo → codice ISO
  const nomi = new Map<string, string>() // codice ISO → nome canonico italiano
  const A = 65
  let itNames: Intl.DisplayNames | null = null
  let enNames: Intl.DisplayNames | null = null
  try {
    itNames = new Intl.DisplayNames(['it'], { type: 'region' })
    enNames = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    // ambiente senza Intl.DisplayNames: restano solo gli alias manuali
  }
  if (itNames && enNames) {
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j)
        let it: string | undefined
        let en: string | undefined
        try {
          it = itNames.of(code)
          en = enNames.of(code)
        } catch {
          continue
        }
        // Codice non assegnato: Intl restituisce il codice stesso.
        if (!it || it === code) continue
        nomi.set(code, CANONICO_PAESI[code] ?? it)
        mappa.set(chiaveTesto(it), code)
        if (en && en !== code) mappa.set(chiaveTesto(en), code)
        mappa.set(chiaveTesto(code), code)
      }
    }
  }
  for (const [code, alias] of Object.entries(ALIAS_PAESI)) {
    if (!nomi.has(code)) nomi.set(code, CANONICO_PAESI[code] ?? alias[alias.length - 1])
    for (const a of alias) mappa.set(chiaveTesto(a), code)
  }
  return { mappa, nomi }
}

export function normalizzaPaese(nome: string): NomeNormalizzato {
  const originale = nome.replace(/\s+/g, ' ').trim()
  const k = chiaveTesto(nome)
  const gen = GENERICHE[k]
  if (gen) return { nome: gen, riconosciuto: true }
  if (!cachePaesi) cachePaesi = costruisciPaesi()
  const code = cachePaesi.mappa.get(k)
  if (code) return { nome: cachePaesi.nomi.get(code) ?? originale, riconosciuto: true }
  return { nome: originale, riconosciuto: false }
}
