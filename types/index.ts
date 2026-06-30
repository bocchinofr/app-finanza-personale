export type Persona = 'G' | 'F'

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
  persona: Persona
  anno: number
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
