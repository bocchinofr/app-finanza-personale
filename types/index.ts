export interface Movimento {
  id?: string
  user_id?: string
  mese: string
  data_operazione: string
  descrizione: string
  entrate: number
  uscite: number
  categoria: string
  sottocategoria: string
  nome_etf: string
  componente: string
  anno: number
}

export interface Liquidita {
  id?: string
  user_id?: string
  anno: number
  mese: string
  conto: string
  saldo: number
}

export interface AssetPortafoglio {
  id?: string
  user_id?: string
  asset: string
  descrizione: string
  ticker: string
  isin: string
  nome: string
  data_acquisto: string
  prezzo_acquisto: number
  quantita: number
  pac: boolean
  pac_versamento: number
}

export interface AlertSoglia {
  id?: string
  user_id?: string
  portafoglio_id: string
  tipo: 'storico' | 'mensile' | 'acquisto'
  soglia_pct: number
  attivo: boolean
  in_breach: boolean
  ultima_notifica_at?: string | null
  created_at?: string
}

export interface Notifica {
  id: string
  user_id?: string
  portafoglio_id: string | null
  tipo: string
  messaggio: string
  letta: boolean
  created_at: string
}

export interface Profilo {
  user_id: string
  google_sheet_id: string | null
  nome_visualizzato: string | null
  updated_at?: string
}

export const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'] as const
export type Mese = typeof MESI[number]

export const CATEGORIE_ENTRATE = [
  'STIPENDIO G','STIPENDIO F','ASSEGNO UNICO','BONUS NIDO',
  'RIMBORSI','INTERESSI','VENDITA TITOLI'
]
export const CATEGORIE_INVESTIMENTI = ['INVESTIMENTI']
export const CATEGORIE_USCITE = [
  'MUTUO','SPESA','TASSE','SPESE BANCA','AUTO','TRASPORTI','CONDOMINIO','BABY',
  'BOLLETTE','INTERNET&CELL','SALUTE','RISTORANTI','TEMPO LIBERO','CASA',
  'ABBIGLIAMENTO','FORMAZIONE','SPORT','AMAZON & CO','VACANZE','ASSICURAZIONE',
  'CARTA PREP BPER'
]
