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
  riconciliato?: boolean
  portafoglio_id?: string | null
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
  // Stato attuale gestito dall'app (mai sovrascritto dal sync col foglio Google
  // dopo la prima inizializzazione). Fallback ai campi "anagrafica" sopra
  // finché non c'è stata almeno una riconciliazione.
  quantita_attuale?: number | null
  prezzo_carico_attuale?: number | null
  ultimo_aggiornamento_at?: string | null
  // Classificazione per il rapporto azionario/obbligazionario e per la
  // riserva di accumulo. Nullo finché l'utente non lo imposta.
  classe_rischio?: 'azionario' | 'obbligazionario' | 'altro' | null
  // Capitale "libero": se true, il valore attuale dell'asset concorre
  // al calcolo del capitale disponibile per accumulo sui crolli.
  svincolato?: boolean
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
  // Dimensioni del profilo di rischio (questionario in /dashboard/profilo)
  risk_profile_label?: string | null
  behavior_label?: string | null
  equity_pct?: number | null
  // Drawdown massimo considerato nella formula di scaling per il capitale
  // suggerito in accumulo (default 0.30 = 30%)
  dd_max?: number
}

// Flag di svincolo per conto di liquidità: decoupled dalla riga mensile
// (altrimenti andrebbe re-impostato ogni mese al sync).
export interface ContoFlag {
  id?: string
  user_id?: string
  conto: string
  svincolata: boolean
}

// Un asset o conto è considerato "in profilo dinamico" (accumulo attivabile)
// solo se il comportamento dichiarato è "accumula sui crolli".
export const PROFILO_DINAMICO_LABEL = 'Contrarian (accumula sui crolli)'

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

// Restituisce lo stato "attuale" di un asset: usa i campi aggiornati
// dall'app se presenti, altrimenti ricade sui valori di anagrafica del foglio.
export function statoAttuale(a: AssetPortafoglio): { quantita: number; prezzoCarico: number } {
  return {
    quantita: a.quantita_attuale ?? a.quantita,
    prezzoCarico: a.prezzo_carico_attuale ?? a.prezzo_acquisto,
  }
}
