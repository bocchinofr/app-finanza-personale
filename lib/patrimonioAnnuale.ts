// lib/patrimonioAnnuale.ts
// Logica della vista annuale del patrimonio: calcolo degli aggregati annuali dai dati
// dettagliati e fusione con gli anni "congelati" in storico_annuale. Usata sia dal
// componente PatrimonioAnnuale sia dalla pagina di import (congelamento prima del sync).
import type { createClient } from '@/lib/supabase'
import {
  Liquidita, FondoPensione, AssetPortafoglio, Movimento,
  MESI, CATEGORIE_ENTRATE, CATEGORIE_USCITE, statoAttuale,
} from '@/types'

type Supabase = ReturnType<typeof createClient>

// Stesso filtro legacy della pagina Patrimonio (asset taggati come fondo pensione nel vecchio approccio)
const CATEGORIA_FONDO_PENSIONE_LEGACY = 'Fondo Pensione'
const PAGINA = 1000
const COLONNE_STORICO = 'anno, fonte, patrimonio_totale, fondo_pensione, capitale_investito, liquidita, entrate, uscite'

export type MovimentoLight = Pick<Movimento, 'anno' | 'mese' | 'categoria' | 'entrate' | 'uscite' | 'portafoglio_id'>
type LiquiditaLight = Pick<Liquidita, 'anno' | 'mese' | 'saldo'>
type FondoLight = Pick<FondoPensione, 'anno' | 'mese' | 'saldo'>

/** Riga di storico_annuale: totali inseriti a mano per anni senza dati dettagliati. */
export interface StoricoManuale {
  anno: number
  fonte: 'manuale' | 'salvato'
  patrimonio_totale: number
  fondo_pensione: number
  capitale_investito: number
  liquidita: number
  entrate: number
  uscite: number
}

export type Colonna = 'patrimonio' | 'fondo' | 'capitale' | 'liquidita' | 'entrate' | 'uscite'

export interface RigaAnnuale {
  anno: number
  ultimoMese: string
  parziale: boolean // anno non ancora completo (ultimo mese con dati < dicembre)
  manuale: boolean // riga letta da storico_annuale (totali, nessun dettaglio)
  fonte: 'manuale' | 'salvato' | null // come è finita in archivio
  inArchivio: boolean // esiste una riga in storico_annuale per quest'anno (anche se si mostra il calcolato)
  valori: Record<Colonna, number>
  variazioni: Record<Colonna, number | null> // % vs anno precedente
}

function varPct(attuale: number, precedente: number | null): number | null {
  if (precedente == null || precedente === 0) return null
  return ((attuale - precedente) / Math.abs(precedente)) * 100
}

function parseDataAcquisto(v: string): { anno: number; meseIdx: number } | null {
  const parti = (v ?? '').split('/')
  if (parti.length !== 3) return null
  const meseNum = Number(parti[1])
  const annoNum = Number(parti[2])
  if (!annoNum || !meseNum || meseNum < 1 || meseNum > 12) return null
  return { anno: annoNum, meseIdx: meseNum - 1 }
}

/** Legge tutte le righe di una query paginando (Supabase limita a 1000 righe per richiesta). */
export async function fetchTutte<T>(
  pagina: (da: number, a: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const tutte: T[] = []
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await pagina(da, da + PAGINA - 1)
    if (error) throw new Error(error.message)
    const righe = (data ?? []) as T[]
    tutte.push(...righe)
    if (righe.length < PAGINA) break
  }
  return tutte
}

export function costruisciRighe(
  liquidita: LiquiditaLight[],
  fondo: FondoLight[],
  movimenti: MovimentoLight[],
  assetInvestiti: AssetPortafoglio[],
  manuali: StoricoManuale[],
  annoCorrente: number
): RigaAnnuale[] {
  // Anni con dati dettagliati. Per gli anni passati (< annoCorrente) vince sempre storico_annuale;
  // l'anno in corso resta calcolato (la riga manuale vale solo se non ci sono dati dettagliati).
  const anniCalcolati = new Set([
    ...liquidita.map(l => l.anno),
    ...fondo.map(f => f.anno),
    ...movimenti.map(m => m.anno),
  ])
  const anni = [...new Set([...anniCalcolati, ...manuali.map(m => m.anno)])]
    .filter(a => a > 0).sort((a, b) => a - b)

  const chiave = (anno: number, meseIdx: number) => anno * 12 + meseIdx
  const idxMese = (m: string) => (MESI as readonly string[]).indexOf(m)

  // Ultimo mese con dati per ciascun anno
  const ultimoIdxPerAnno = new Map<number, number>()
  const registra = (anno: number, mese: string) => {
    const i = idxMese(mese)
    if (i < 0) return
    ultimoIdxPerAnno.set(anno, Math.max(ultimoIdxPerAnno.get(anno) ?? -1, i))
  }
  liquidita.forEach(l => registra(l.anno, l.mese))
  fondo.forEach(f => registra(f.anno, f.mese))
  movimenti.forEach(m => registra(m.anno, m.mese))

  // Saldo "fine anno": somma dei saldi nell'ultimo mese valorizzato dell'anno
  function saldoFineAnno(righe: { anno: number; mese: string; saldo: number }[], anno: number): number {
    const dellAnno = righe.filter(r => r.anno === anno)
    const ultimo = Math.max(-1, ...dellAnno.map(r => idxMese(r.mese)))
    if (ultimo < 0) return 0
    return dellAnno.filter(r => idxMese(r.mese) === ultimo).reduce((s, r) => s + (r.saldo ?? 0), 0)
  }

  // Capitale investito ricostruito (stesso metodo del riepilogo mensile): ancora alla
  // data_acquisto = prezzo_acquisto x quantita, poi si sommano i flussi dei movimenti
  // INVESTIMENTI collegati all'asset (uscita = +, entrata = -).
  const flussiInvestimenti = movimenti.filter(m => m.categoria === 'INVESTIMENTI' && m.portafoglio_id)
  function capitaleA(anno: number, meseIdx: number): number {
    const limite = chiave(anno, meseIdx)
    return assetInvestiti.reduce((somma, a) => {
      const acq = parseDataAcquisto(a.data_acquisto)
      if (!acq) return somma
      const ancora = chiave(acq.anno, acq.meseIdx)
      if (ancora > limite) return somma
      const flusso = flussiInvestimenti
        .filter(m => m.portafoglio_id === a.id)
        .filter(m => {
          const k = chiave(m.anno, idxMese(m.mese))
          return k > ancora && k <= limite
        })
        .reduce((s, m) => s + (m.uscite ?? 0) - (m.entrate ?? 0), 0)
      return somma + a.prezzo_acquisto * a.quantita + flusso
    }, 0)
  }

  function flussoAnno(anno: number, fineMeseIdx: number, categorie: string[], campo: 'entrate' | 'uscite'): number {
    return movimenti
      .filter(m => m.anno === anno && idxMese(m.mese) <= fineMeseIdx && categorie.includes(m.categoria))
      .reduce((s, m) => s + (m[campo] ?? 0), 0)
  }

  const righe: RigaAnnuale[] = []
  for (const anno of anni) {
    const inArch = manuali.find(m => m.anno === anno)
    const man = inArch && (anno < annoCorrente || !anniCalcolati.has(anno)) ? inArch : undefined
    const ultimoIdx = man ? 11 : (ultimoIdxPerAnno.get(anno) ?? 11)
    const parziale = ultimoIdx < 11

    let valori: Record<Colonna, number>
    if (man) {
      valori = {
        patrimonio: man.patrimonio_totale,
        fondo: man.fondo_pensione,
        capitale: man.capitale_investito,
        liquidita: man.liquidita,
        entrate: man.entrate,
        uscite: man.uscite,
      }
    } else {
      const liq = saldoFineAnno(liquidita, anno)
      const fon = saldoFineAnno(fondo, anno)
      const cap = capitaleA(anno, ultimoIdx)
      valori = {
        patrimonio: liq + fon + cap,
        fondo: fon,
        capitale: cap,
        liquidita: liq,
        entrate: flussoAnno(anno, ultimoIdx, CATEGORIE_ENTRATE, 'entrate'),
        uscite: flussoAnno(anno, ultimoIdx, CATEGORIE_USCITE, 'uscite'),
      }
    }

    const prec = righe.find(r => r.anno === anno - 1) ?? null
    // Per gli stock si confronta con la fine dell'anno precedente; per i flussi di un anno
    // parziale si confronta lo stesso periodo (stessi mesi) dell'anno precedente.
    // Se l'anno precedente è in archivio (solo totali annui) il confronto sullo stesso periodo
    // non è possibile: per un anno parziale la variazione dei flussi non viene mostrata.
    const flussoPrec = (campo: 'entrate' | 'uscite', categorie: string[]): number | null => {
      if (!prec) return null
      if (prec.manuale) return parziale ? null : prec.valori[campo]
      return flussoAnno(anno - 1, ultimoIdx, categorie, campo)
    }

    righe.push({
      anno,
      ultimoMese: MESI[ultimoIdx],
      parziale,
      manuale: !!man,
      fonte: man ? man.fonte : null,
      inArchivio: !!inArch,
      valori,
      variazioni: {
        patrimonio: varPct(valori.patrimonio, prec ? prec.valori.patrimonio : null),
        fondo: varPct(valori.fondo, prec ? prec.valori.fondo : null),
        capitale: varPct(valori.capitale, prec ? prec.valori.capitale : null),
        liquidita: varPct(valori.liquidita, prec ? prec.valori.liquidita : null),
        entrate: varPct(valori.entrate, flussoPrec('entrate', CATEGORIE_ENTRATE)),
        uscite: varPct(valori.uscite, flussoPrec('uscite', CATEGORIE_USCITE)),
      },
    })
  }
  return righe.reverse() // anno più recente in alto, come il riepilogo mensile
}


function rigaStorico(r: Record<string, unknown>): StoricoManuale {
  return {
    anno: Number(r.anno),
    fonte: r.fonte === 'salvato' ? 'salvato' : 'manuale',
    patrimonio_totale: Number(r.patrimonio_totale) || 0,
    fondo_pensione: Number(r.fondo_pensione) || 0,
    capitale_investito: Number(r.capitale_investito) || 0,
    liquidita: Number(r.liquidita) || 0,
    entrate: Number(r.entrate) || 0,
    uscite: Number(r.uscite) || 0,
  }
}

/** Carica tutti i dati e costruisce le righe. Con ignoraStorico si ottiene il solo calcolato. */
export async function caricaRigheAnnuali(
  supabase: Supabase,
  userId: string,
  opzioni: { ignoraStorico?: boolean } = {}
): Promise<RigaAnnuale[]> {
  const [liquidita, fondo, movimenti, portRes, storRes] = await Promise.all([
    fetchTutte<LiquiditaLight>((da, a) =>
      supabase.from('liquidita').select('anno, mese, saldo').eq('user_id', userId).range(da, a)),
    fetchTutte<FondoLight>((da, a) =>
      supabase.from('fondo_pensione').select('anno, mese, saldo').eq('user_id', userId).range(da, a)),
    fetchTutte<MovimentoLight>((da, a) =>
      supabase.from('movimenti').select('anno, mese, categoria, entrate, uscite, portafoglio_id')
        .eq('user_id', userId).range(da, a)),
    supabase.from('portafoglio').select('*').eq('user_id', userId),
    opzioni.ignoraStorico
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : supabase.from('storico_annuale').select(COLONNE_STORICO).eq('user_id', userId),
  ])
  if (portRes.error) throw new Error(portRes.error.message)

  const assetInvestiti = ((portRes.data ?? []) as AssetPortafoglio[]).filter(
    a => a.asset !== CATEGORIA_FONDO_PENSIONE_LEGACY && statoAttuale(a).quantita > 0
  )
  // Se la tabella non esiste o la query fallisce, la vista resta quella calcolata
  const manuali = storRes.error ? [] : ((storRes.data ?? []) as unknown as Record<string, unknown>[]).map(rigaStorico)

  return costruisciRighe(liquidita, fondo, movimenti, assetInvestiti, manuali, new Date().getFullYear())
}

/** Congela in storico_annuale i totali calcolati di un anno (sovrascrive la riga esistente). */
export async function congelaAnno(supabase: Supabase, userId: string, anno: number): Promise<void> {
  const righe = await caricaRigheAnnuali(supabase, userId, { ignoraStorico: true })
  const r = righe.find(x => x.anno === anno)
  if (!r) throw new Error(`Nessun dato del ${anno} da salvare.`)
  const { error } = await supabase.from('storico_annuale').upsert({
    user_id: userId,
    anno,
    fonte: 'salvato',
    patrimonio_totale: r.valori.patrimonio,
    fondo_pensione: r.valori.fondo,
    capitale_investito: r.valori.capitale,
    liquidita: r.valori.liquidita,
    entrate: r.valori.entrate,
    uscite: r.valori.uscite,
  }, { onConflict: 'user_id,anno' })
  if (error) throw new Error(error.message)
}

/** Serve congelare `anno`? Vero se non è in archivio, ha dati dettagliati e non c'è ancora nulla di `anno + 1`. */
export async function serveCongelamento(supabase: Supabase, userId: string, annoNuovo: number): Promise<boolean> {
  const prec = annoNuovo - 1
  const [nuovi, archiviati] = await Promise.all([
    supabase.from('movimenti').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('anno', annoNuovo),
    supabase.from('storico_annuale').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('anno', prec),
  ])
  if (nuovi.error || archiviati.error) return false // nel dubbio non blocco il sync
  if ((nuovi.count ?? 0) > 0 || (archiviati.count ?? 0) > 0) return false
  const righe = await caricaRigheAnnuali(supabase, userId, { ignoraStorico: true })
  return righe.some(r => r.anno === prec)
}
