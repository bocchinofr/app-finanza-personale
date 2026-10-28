// components/PatrimonioAnnuale.tsx
// Vista annuale del patrimonio: aggregati di fine anno (stock) e totali annui
// (flussi) con variazione % rispetto all'anno precedente. Carica da sola tutti
// gli anni, quindi non dipende dal selettore anno della pagina.
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  Liquidita, FondoPensione, AssetPortafoglio, Movimento,
  MESI, CATEGORIE_ENTRATE, CATEGORIE_USCITE, statoAttuale,
} from '@/types'

// Stesso filtro legacy della pagina Patrimonio (asset taggati come fondo pensione nel vecchio approccio)
const CATEGORIA_FONDO_PENSIONE_LEGACY = 'Fondo Pensione'
const PAGINA = 1000

const MESI_LABEL: Record<string, string> = {
  gen: 'Gen', feb: 'Feb', mar: 'Mar', apr: 'Apr', mag: 'Mag', giu: 'Giu',
  lug: 'Lug', ago: 'Ago', set: 'Set', ott: 'Ott', nov: 'Nov', dic: 'Dic',
}

type MovimentoLight = Pick<Movimento, 'anno' | 'mese' | 'categoria' | 'entrate' | 'uscite' | 'portafoglio_id'>
type LiquiditaLight = Pick<Liquidita, 'anno' | 'mese' | 'saldo'>
type FondoLight = Pick<FondoPensione, 'anno' | 'mese' | 'saldo'>

type Colonna = 'patrimonio' | 'fondo' | 'capitale' | 'liquidita' | 'entrate' | 'uscite'

interface RigaAnnuale {
  anno: number
  ultimoMese: string
  parziale: boolean // anno non ancora completo (ultimo mese con dati < dicembre)
  valori: Record<Colonna, number>
  variazioni: Record<Colonna, number | null> // % vs anno precedente
}

function fmtEuro(n: number) {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
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
async function fetchTutte<T>(
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

function costruisciRighe(
  liquidita: LiquiditaLight[],
  fondo: FondoLight[],
  movimenti: MovimentoLight[],
  assetInvestiti: AssetPortafoglio[]
): RigaAnnuale[] {
  const anni = [...new Set([
    ...liquidita.map(l => l.anno),
    ...fondo.map(f => f.anno),
    ...movimenti.map(m => m.anno),
  ])].filter(a => a > 0).sort((a, b) => a - b)

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
    const ultimoIdx = ultimoIdxPerAnno.get(anno) ?? 11
    const liq = saldoFineAnno(liquidita, anno)
    const fon = saldoFineAnno(fondo, anno)
    const cap = capitaleA(anno, ultimoIdx)
    const valori: Record<Colonna, number> = {
      patrimonio: liq + fon + cap,
      fondo: fon,
      capitale: cap,
      liquidita: liq,
      entrate: flussoAnno(anno, ultimoIdx, CATEGORIE_ENTRATE, 'entrate'),
      uscite: flussoAnno(anno, ultimoIdx, CATEGORIE_USCITE, 'uscite'),
    }

    const prec = righe.find(r => r.anno === anno - 1) ?? null
    // Per gli stock si confronta con la fine dell'anno precedente; per i flussi di un anno
    // parziale si confronta lo stesso periodo (stessi mesi) dell'anno precedente.
    const entratePrec = prec ? flussoAnno(anno - 1, ultimoIdx, CATEGORIE_ENTRATE, 'entrate') : null
    const uscitePrec = prec ? flussoAnno(anno - 1, ultimoIdx, CATEGORIE_USCITE, 'uscite') : null

    righe.push({
      anno,
      ultimoMese: MESI[ultimoIdx],
      parziale: ultimoIdx < 11,
      valori,
      variazioni: {
        patrimonio: varPct(valori.patrimonio, prec ? prec.valori.patrimonio : null),
        fondo: varPct(valori.fondo, prec ? prec.valori.fondo : null),
        capitale: varPct(valori.capitale, prec ? prec.valori.capitale : null),
        liquidita: varPct(valori.liquidita, prec ? prec.valori.liquidita : null),
        entrate: varPct(valori.entrate, entratePrec),
        uscite: varPct(valori.uscite, uscitePrec),
      },
    })
  }
  return righe.reverse() // anno più recente in alto, come il riepilogo mensile
}

const COLONNE: { chiave: Colonna; titolo: string; invertiColore?: boolean; evidenzia?: boolean }[] = [
  { chiave: 'patrimonio', titolo: 'Patrimonio totale', evidenzia: true },
  { chiave: 'fondo', titolo: 'Fondo pensione' },
  { chiave: 'capitale', titolo: 'Capitale investito' },
  { chiave: 'liquidita', titolo: 'Liquidità' },
  { chiave: 'entrate', titolo: 'Entrate' },
  { chiave: 'uscite', titolo: 'Uscite', invertiColore: true },
]

function Cella({
  valore, variazione, invertiColore, evidenzia,
}: {
  valore: number
  variazione: number | null
  invertiColore?: boolean
  evidenzia?: boolean
}) {
  const positivo = variazione != null && (invertiColore ? variazione <= 0 : variazione >= 0)
  const tono = variazione == null ? 'text-gray-300' : positivo ? 'text-green-700' : 'text-red-700'
  return (
    <td className="px-3 py-2 text-right align-top border-b border-surface-200/50">
      <p className={`font-mono tabular-nums ${evidenzia ? 'text-gray-900 font-semibold' : 'text-gray-600'}`}>
        {fmtEuro(valore)}
      </p>
      <p className={`font-mono tabular-nums text-[11px] font-medium ${tono}`}>
        {variazione == null ? '–' : `${variazione >= 0 ? '▲ +' : '▼ '}${variazione.toFixed(1)}%`}
      </p>
    </td>
  )
}

export default function PatrimonioAnnuale() {
  const supabase = createClient()
  const [righe, setRighe] = useState<RigaAnnuale[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const [liquidita, fondo, movimenti, portRes] = await Promise.all([
          fetchTutte<LiquiditaLight>((da, a) =>
            supabase.from('liquidita').select('anno, mese, saldo').eq('user_id', user.id).range(da, a)),
          fetchTutte<FondoLight>((da, a) =>
            supabase.from('fondo_pensione').select('anno, mese, saldo').eq('user_id', user.id).range(da, a)),
          fetchTutte<MovimentoLight>((da, a) =>
            supabase.from('movimenti').select('anno, mese, categoria, entrate, uscite, portafoglio_id')
              .eq('user_id', user.id).range(da, a)),
          supabase.from('portafoglio').select('*').eq('user_id', user.id),
        ])
        if (portRes.error) throw new Error(portRes.error.message)
        if (cancelled) return

        const assetInvestiti = ((portRes.data ?? []) as AssetPortafoglio[]).filter(
          a => a.asset !== CATEGORIA_FONDO_PENSIONE_LEGACY && statoAttuale(a).quantita > 0
        )
        setRighe(costruisciRighe(liquidita, fondo, movimenti, assetInvestiti))
      } catch (e) {
        if (!cancelled) setErrore(e instanceof Error ? e.message : 'errore sconosciuto')
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (errore) {
    return (
      <div className="card mt-4 text-sm text-red-700">Vista annuale non disponibile: {errore}</div>
    )
  }
  if (!righe) {
    return <div className="card mt-4 text-sm text-gray-400">Caricamento vista annuale…</div>
  }
  if (righe.length === 0) return null

  return (
    <div className="card mt-4">
      <p className="num-display text-sm font-semibold text-gray-900 mb-3">Vista annuale</p>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide sticky left-0 bg-white">Anno</th>
              {COLONNE.map(c => (
                <th
                  key={c.chiave}
                  className={`text-right px-3 py-2 font-semibold uppercase tracking-wide whitespace-nowrap ${c.evidenzia ? 'text-gray-500' : 'text-gray-400'}`}
                >
                  {c.titolo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {righe.map(r => (
              <tr key={r.anno}>
                <td className="px-3 py-2 align-top text-gray-700 font-medium sticky left-0 bg-white border-b border-surface-200/50 whitespace-nowrap">
                  {r.anno}
                  {r.parziale && (
                    <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                      a {MESI_LABEL[r.ultimoMese]}
                    </span>
                  )}
                </td>
                {COLONNE.map(c => (
                  <Cella
                    key={c.chiave}
                    valore={r.valori[c.chiave]}
                    variazione={r.variazioni[c.chiave]}
                    invertiColore={c.invertiColore}
                    evidenzia={c.evidenzia}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 mt-2">
        Patrimonio, fondo, capitale e liquidità sono valori di fine anno (per l&apos;anno in corso, ultimo mese con dati). Entrate e uscite sono i totali dell&apos;anno; per l&apos;anno in corso la variazione % è sullo stesso periodo dell&apos;anno prima. Il capitale investito è ricostruito come nel riepilogo mensile, quindi il patrimonio può differire dalla card a valore di mercato.
      </p>
    </div>
  )
}
