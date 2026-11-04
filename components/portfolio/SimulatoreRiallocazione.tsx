// components/portfolio/SimulatoreRiallocazione.tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ComposizioneEtf } from '@/lib/portfolioLookthrough'
import {
  ModoOperazione, Operazione, StatoPortafoglio, StrumentoSim, simula,
} from '@/lib/portfolioSimulation'
import {
  COLORI_CLASSE, fmtEuro, fmtPct, fmtPp, fmtPrezzo, fmtQta,
} from '@/lib/portfolioFormat'
import AllocazioneDonut from './AllocazioneDonut'
import SimulatoreInfoBox from './SimulatoreInfoBox'

interface Props {
  strumentiReali: StrumentoSim[]
  composizioni: ComposizioneEtf[]
  liquidita: number
  onNuovo: () => void
  onEditComposizione: (id: string) => void
  onElimina: (id: string) => void
}

const MODI_VENDITA: [ModoOperazione, string][] = [
  ['tutto', 'Tutto'], ['percentuale', '% posizione'], ['quantita', 'Quantità'], ['importo', 'Importo €'],
]
const MODI_ACQUISTO: [ModoOperazione, string][] = [['importo', 'Importo €'], ['quantita', 'Quantità']]

function fette(s: StatoPortafoglio) {
  return [
    { nome: 'Azionario', valore: s.azionario, colore: COLORI_CLASSE.azionario },
    { nome: 'Obbligazionario', valore: s.obbligazionario, colore: COLORI_CLASSE.obbligazionario },
    { nome: 'Altro', valore: s.altro, colore: COLORI_CLASSE.altro },
    { nome: 'Liquidità', valore: Math.max(s.liquidita, 0), colore: COLORI_CLASSE.liquidita },
  ]
}

interface RigaConf { nome: string; prima: number; dopo: number }

function TabellaConfronto({
  righe, basePrima, baseDopo, maxRighe = 10, intestazione,
}: {
  righe: RigaConf[]; basePrima: number; baseDopo: number; maxRighe?: number; intestazione: string
}) {
  const calc = righe.map(r => {
    const p = basePrima > 0 ? (r.prima / basePrima) * 100 : 0
    const d = baseDopo > 0 ? (r.dopo / baseDopo) * 100 : 0
    return { ...r, p, d, delta: d - p }
  }).sort((a, b) => Math.max(Math.abs(b.p), Math.abs(b.d)) - Math.max(Math.abs(a.p), Math.abs(a.d))).slice(0, maxRighe)
  const maxDelta = Math.max(...calc.map(c => Math.abs(c.delta)), 0.01)
  if (calc.length === 0) return <p className="text-xs text-gray-400">Nessun dato inserito.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px]">
        <thead>
          <tr>
            <th className="table-th">{intestazione}</th>
            <th className="table-th text-right">Prima</th>
            <th className="table-th text-right">Dopo</th>
            <th className="table-th text-right">Δ</th>
            <th className="table-th w-28" />
          </tr>
        </thead>
        <tbody>
          {calc.map(c => (
            <tr key={c.nome}>
              <td className="table-td !py-1.5 text-xs text-gray-800 truncate max-w-[180px]" title={c.nome}>{c.nome}</td>
              <td className="table-td !py-1.5 text-right text-xs font-mono tabular-nums text-gray-500">{fmtPct(c.p, 2)}</td>
              <td className="table-td !py-1.5 text-right text-xs font-mono tabular-nums font-medium">{fmtPct(c.d, 2)}</td>
              <td className={`table-td !py-1.5 text-right text-xs font-mono tabular-nums ${
                Math.abs(c.delta) < 0.005 ? 'text-gray-400' : c.delta > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                {fmtPp(c.delta)}
              </td>
              <td className="table-td !py-1.5">
                <div className="relative h-2 rounded-full bg-surface-100">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-surface-300" />
                  <div
                    className={`absolute inset-y-0 rounded-full ${c.delta >= 0 ? 'bg-emerald-500 left-1/2' : 'bg-rose-400 right-1/2'}`}
                    style={{ width: `${(Math.abs(c.delta) / maxDelta) * 50}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function unisci(
  prima: { nome: string; euro: number }[], dopo: { nome: string; euro: number }[],
): RigaConf[] {
  const m = new Map<string, RigaConf>()
  for (const x of prima) m.set(x.nome, { nome: x.nome, prima: x.euro, dopo: 0 })
  for (const x of dopo) {
    const cur = m.get(x.nome) ?? { nome: x.nome, prima: 0, dopo: 0 }
    cur.dopo = x.euro
    m.set(x.nome, cur)
  }
  return [...m.values()]
}

function KpiConf({ label, prima, dopo, formato = fmtEuro, invertiColori }: {
  label: string; prima: number; dopo: number; formato?: (n: number) => string; invertiColori?: boolean
}) {
  const delta = dopo - prima
  const bene = invertiColori ? delta < 0 : delta > 0
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="num-display text-lg font-bold tabular-nums text-gray-900">{formato(dopo)}</p>
      <p className="text-[11px] font-mono tabular-nums text-gray-400">
        da {formato(prima)}{' '}
        {Math.abs(delta) > 0.5 && (
          <span className={bene ? 'text-emerald-700' : 'text-rose-600'}>({delta > 0 ? '+' : ''}{formato(delta)})</span>
        )}
      </p>
    </div>
  )
}

export default function SimulatoreRiallocazione({
  strumentiReali, composizioni, liquidita, onNuovo, onEditComposizione, onElimina,
}: Props) {
  const [ops, setOps] = useState<Operazione[]>([])
  const [liqExtra, setLiqExtra] = useState(0)
  const [vistaEsp, setVistaEsp] = useState<'settori' | 'paesi'>('settori')
  const [quote, setQuote] = useState<Record<string, number>>({})
  const contatore = useRef(0)

  const libreria = useMemo(() => composizioni.filter(c => c.portafoglio_id.startsWith('sim:') && c.meta), [composizioni])

  // Prezzi live degli strumenti nuovi (con cambio EUR/USD per quelli in dollari)
  useEffect(() => {
    if (libreria.length === 0) return
    const tickers = libreria.map(c => c.meta!.ticker)
    const serveFx = libreria.some(c => c.meta!.valuta === 'USD')
    const simboli = [...new Set([...tickers, ...(serveFx ? ['EURUSD=X'] : [])])]
    let annullato = false
    fetch(`/api/quote?tickers=${encodeURIComponent(simboli.join(','))}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j || annullato) return
        const fx: number | undefined = j['EURUSD=X']?.price
        const out: Record<string, number> = {}
        for (const c of libreria) {
          const p: number | undefined = j[c.meta!.ticker]?.price
          if (!p) continue
          if (c.meta!.valuta === 'USD') { if (fx) out[c.portafoglio_id] = p / fx } else out[c.portafoglio_id] = p
        }
        setQuote(out)
      })
      .catch(() => { /* resta l'ultimo prezzo salvato */ })
    return () => { annullato = true }
  }, [libreria])

  const strumentiNuovi: StrumentoSim[] = useMemo(() => libreria.map(c => ({
    id: c.portafoglio_id, nome: c.meta!.nome, ticker: c.meta!.ticker, classe: c.meta!.classe,
    qta: 0, pmc: 0, prezzo: quote[c.portafoglio_id] ?? c.meta!.prezzo ?? 0,
    leva: c.meta!.leva || 1, riferimentoId: c.meta!.riferimentoId ?? null, nuovo: true,
  })), [libreria, quote])

  const strumenti = useMemo(() => [...strumentiReali, ...strumentiNuovi], [strumentiReali, strumentiNuovi])

  // Operazioni su strumenti eliminati dalla libreria: rimosse
  useEffect(() => {
    setOps(prev => {
      const valide = prev.filter(o => strumenti.some(s => s.id === o.strumentoId))
      return valide.length === prev.length ? prev : valide
    })
  }, [strumenti])

  const sim = useMemo(
    () => simula(strumenti, liquidita, ops, composizioni, liqExtra),
    [strumenti, liquidita, ops, composizioni, liqExtra]
  )
  const dettPerId = new Map(sim.dettagli.map(d => [d.op.id, d]))

  function aggiungi(tipo: 'vendi' | 'acquista') {
    const base = tipo === 'vendi' ? strumentiReali.find(s => s.qta > 0 && s.classe === 'azionario') ?? strumentiReali.find(s => s.qta > 0) : strumenti[0]
    if (!base) return
    contatore.current += 1
    setOps(prev => [...prev, {
      id: `op${contatore.current}`, tipo, strumentoId: base.id,
      modo: tipo === 'vendi' ? 'percentuale' : 'importo', valore: tipo === 'vendi' ? 100 : 0, aliquota: 26, costi: 0,
    }])
  }
  const aggiorna = (id: string, patch: Partial<Operazione>) => setOps(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)))
  const rimuovi = (id: string) => setOps(prev => prev.filter(o => o.id !== id))

  const { prima, dopo, totali } = sim
  const haOp = ops.length > 0
  const vendite = sim.dettagli.filter(d => d.op.tipo === 'vendi')
  const acquisti = sim.dettagli.filter(d => d.op.tipo === 'acquista')

  const righeStrumenti = strumenti.map(s => {
    const a = prima.posizioni.find(p => p.s.id === s.id)?.valore ?? 0
    const b = dopo.posizioni.find(p => p.s.id === s.id)?.valore ?? 0
    return { nome: s.nome, prima: a, dopo: b }
  }).filter(r => r.prima > 0 || r.dopo > 0)

  const righeSoc = unisci(
    prima.lt.societa.map(s => ({ nome: s.nome, euro: s.euro })),
    dopo.lt.societa.map(s => ({ nome: s.nome, euro: s.euro })),
  )
  const righeEsp = vistaEsp === 'settori'
    ? unisci(prima.lt.settori, dopo.lt.settori)
    : unisci(prima.lt.paesi, dopo.lt.paesi)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Simulatore di riallocazione</h3>
        <SimulatoreInfoBox />
        <span className="text-[11px] text-gray-400">Nessuna operazione viene eseguita: il portafoglio reale non cambia.</span>
      </div>

      {/* Operazioni */}
      <div className="card !p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => aggiungi('vendi')} className="btn-secondary text-xs">− Vendi</button>
          <button onClick={() => aggiungi('acquista')} className="btn-secondary text-xs">+ Acquista</button>
          <button onClick={onNuovo} className="btn-secondary text-xs">+ Nuovo strumento</button>
          <div className="flex items-center gap-1.5 ml-auto text-xs text-gray-500">
            <span>Variazione liquidità €</span>
            <input
              type="number" step="any" className="input !w-24 text-xs font-mono"
              value={liqExtra === 0 ? '' : liqExtra} placeholder="0"
              onChange={e => setLiqExtra(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        {ops.length === 0 && (
          <p className="text-xs text-gray-400 py-2">
            Aggiungi una vendita o un acquisto per vedere l&apos;effetto su portafoglio, esposizioni e tasse.
          </p>
        )}

        {ops.map(o => {
          const d = dettPerId.get(o.id)
          const elenco = o.tipo === 'vendi' ? strumenti.filter(s => s.qta > 0) : strumenti
          const modi = o.tipo === 'vendi' ? MODI_VENDITA : MODI_ACQUISTO
          return (
            <div key={o.id} className="rounded-lg border border-surface-200 bg-surface-50/50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-md ${o.tipo === 'vendi' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {o.tipo === 'vendi' ? 'VENDI' : 'ACQUISTA'}
                </span>
                <select className="input !w-auto text-xs min-w-[150px] flex-1 sm:flex-none" value={o.strumentoId} onChange={e => aggiorna(o.id, { strumentoId: e.target.value })}>
                  {elenco.map(s => <option key={s.id} value={s.id}>{s.nome}{s.nuovo ? ' (nuovo)' : ''}</option>)}
                </select>
                <select
                  className="input !w-auto text-xs" value={o.modo}
                  onChange={e => aggiorna(o.id, { modo: e.target.value as ModoOperazione, valore: e.target.value === 'percentuale' ? 100 : 0 })}
                >
                  {modi.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {o.modo !== 'tutto' && (
                  <input
                    type="number" step="any" className="input !w-24 text-xs font-mono"
                    value={o.valore === 0 ? '' : o.valore} placeholder="0"
                    onChange={e => aggiorna(o.id, { valore: Number(e.target.value) || 0 })}
                  />
                )}
                {o.tipo === 'vendi' && (
                  <label className="flex items-center gap-1 text-[11px] text-gray-500">
                    Imposta %
                    <input
                      type="number" step="any" className="input !w-16 text-xs font-mono" value={o.aliquota}
                      onChange={e => aggiorna(o.id, { aliquota: Number(e.target.value) || 0 })}
                    />
                  </label>
                )}
                <label className="flex items-center gap-1 text-[11px] text-gray-500">
                  Costi €
                  <input
                    type="number" step="any" className="input !w-16 text-xs font-mono" value={o.costi === 0 ? '' : o.costi} placeholder="0"
                    onChange={e => aggiorna(o.id, { costi: Number(e.target.value) || 0 })}
                  />
                </label>
                <button onClick={() => rimuovi(o.id)} className="ml-auto text-gray-400 hover:text-rose-600 px-1" aria-label="Rimuovi operazione">✕</button>
              </div>
              {d && (
                <p className="text-[11px] text-gray-500 mt-1.5 font-mono tabular-nums">
                  {fmtQta(d.qta)} quote × {fmtPrezzo(d.strumento.prezzo)} = {fmtEuro(d.lordo)}
                  {o.tipo === 'vendi' && <> · plus {fmtEuro(d.plus)} · imposta {fmtEuro(d.imposta)} · netto {fmtEuro(d.netto)}</>}
                  {d.avvisi.map(a => <span key={a} className="text-amber-700"> · {a}</span>)}
                </p>
              )}
            </div>
          )
        })}

        {libreria.length > 0 && (
          <div className="pt-2 border-t border-surface-100">
            <p className="text-[11px] text-gray-400 mb-1.5">Libreria strumenti nuovi</p>
            <div className="flex flex-wrap gap-2">
              {libreria.map(c => {
                const m = c.meta!
                const ha = c.top_holdings.length + c.settori.length + c.paesi.length > 0
                return (
                  <span key={c.portafoglio_id} className="inline-flex items-center gap-1.5 text-xs pl-2.5 pr-1 py-1 rounded-full bg-white border border-surface-200">
                    <span className="text-gray-800">{m.nome}</span>
                    <span className="font-mono text-gray-400">{m.ticker}{m.leva !== 1 ? ` ${m.leva}x` : ''}</span>
                    {m.leva === 1 && (
                      <button
                        onClick={() => onEditComposizione(c.portafoglio_id)}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border ${ha ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                      >{ha ? 'Dati' : 'Inserisci dati'}</button>
                    )}
                    <button onClick={() => onElimina(c.portafoglio_id)} className="text-gray-300 hover:text-rose-600 px-1" aria-label="Elimina dalla libreria">✕</button>
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {sim.avvisi.map(a => (
        <div key={a} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{a}</div>
      ))}

      {haOp && (
        <>
          {/* KPI prima/dopo */}
          <div className="card !p-0 grid grid-cols-2 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-surface-100">
            <KpiConf label="Patrimonio finanziario" prima={prima.patrimonio} dopo={dopo.patrimonio} />
            <KpiConf label="Liquidità" prima={prima.liquidita} dopo={dopo.liquidita} />
            <KpiConf
              label="Azionario / patrimonio" formato={n => fmtPct(n)}
              prima={prima.patrimonio > 0 ? (prima.azionario / prima.patrimonio) * 100 : 0}
              dopo={dopo.patrimonio > 0 ? (dopo.azionario / dopo.patrimonio) * 100 : 0}
            />
            <KpiConf label="Plusvalenza latente" prima={prima.latente} dopo={dopo.latente} />
            <KpiConf label="Copertura dati" formato={n => fmtPct(n, 0)} prima={prima.coperturaAzionario} dopo={dopo.coperturaAzionario} />
          </div>

          {/* Fiscalità */}
          <div className="card !p-0 overflow-hidden">
            <p className="text-xs font-semibold text-gray-800 px-4 pt-3 pb-2">Operazioni e fiscalità</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <th className="table-th">Operazione</th>
                    <th className="table-th text-right">Quote</th>
                    <th className="table-th text-right">PMC</th>
                    <th className="table-th text-right">Valore</th>
                    <th className="table-th text-right">Plus realizzata</th>
                    <th className="table-th text-right">Imposta</th>
                    <th className="table-th text-right">Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {[...vendite, ...acquisti].map(d => (
                    <tr key={d.op.id}>
                      <td className="table-td !py-1.5 text-xs">
                        <span className={d.op.tipo === 'vendi' ? 'text-rose-700' : 'text-emerald-700'}>{d.op.tipo === 'vendi' ? 'Vendita' : 'Acquisto'}</span>{' '}
                        <span className="text-gray-800">{d.strumento.nome}</span>
                      </td>
                      <td className="table-td !py-1.5 text-right text-xs font-mono tabular-nums">{fmtQta(d.qta)}</td>
                      <td className="table-td !py-1.5 text-right text-xs font-mono tabular-nums text-gray-500">{d.op.tipo === 'vendi' ? fmtPrezzo(d.pmc) : '–'}</td>
                      <td className="table-td !py-1.5 text-right text-xs font-mono tabular-nums">{fmtEuro(d.lordo)}</td>
                      <td className={`table-td !py-1.5 text-right text-xs font-mono tabular-nums ${d.plus >= 0 ? 'text-gray-800' : 'text-rose-600'}`}>
                        {d.op.tipo === 'vendi' ? fmtEuro(d.plus) : '–'}
                      </td>
                      <td className="table-td !py-1.5 text-right text-xs font-mono tabular-nums">{d.op.tipo === 'vendi' ? fmtEuro(d.imposta) : '–'}</td>
                      <td className={`table-td !py-1.5 text-right text-xs font-mono tabular-nums font-medium ${d.netto < 0 ? 'text-rose-600' : ''}`}>{fmtEuro(d.netto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-surface-100 border-t border-surface-100">
              {[
                ['Plusvalenza realizzata', fmtEuro(totali.plusRealizzata)],
                ['Imposta teorica', fmtEuro(totali.imposta)],
                ['Costi di transazione', fmtEuro(totali.costi)],
                ['Capitale netto da vendite', fmtEuro(totali.nettoReinvestibile)],
              ].map(([l, v]) => (
                <div key={l} className="bg-white px-4 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{l}</p>
                  <p className="num-display text-base font-bold tabular-nums text-gray-900">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 px-4 py-2">
              Plusvalenza latente residua sui titoli dopo le operazioni: {fmtEuro(dopo.latente)} (prima {fmtEuro(prima.latente)}). Le perdite non sono compensate.
            </p>
          </div>

          {/* Asset class prima/dopo */}
          <div className="card !p-4">
            <p className="text-xs font-semibold text-gray-800 mb-2">Allocazione per asset class</p>
            <div className="grid grid-cols-2 gap-4">
              {([['Prima', prima], ['Dopo', dopo]] as const).map(([titolo, st]) => (
                <div key={titolo}>
                  <p className="text-[11px] text-gray-400 text-center">{titolo}</p>
                  <AllocazioneDonut fette={fette(st)} centro={fmtEuro(st.patrimonio)} altezza={130} />
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
                    {fette(st).map(f => (
                      <span key={f.nome} className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: f.colore }} />
                        {f.nome} <span className="font-mono tabular-nums text-gray-700">{st.patrimonio > 0 ? fmtPct((f.valore / st.patrimonio) * 100, 0) : '–'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strumenti e società */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="card !p-4">
              <p className="text-xs font-semibold text-gray-800 mb-2">Peso per strumento (% patrimonio)</p>
              <TabellaConfronto righe={righeStrumenti} basePrima={prima.patrimonio} baseDopo={dopo.patrimonio} maxRighe={12} intestazione="Strumento" />
            </div>
            <div className="card !p-4">
              <p className="text-xs font-semibold text-gray-800 mb-2">Esposizione alle società (% patrimonio)</p>
              <TabellaConfronto righe={righeSoc} basePrima={prima.patrimonio} baseDopo={dopo.patrimonio} intestazione="Società" />
              <p className="text-[11px] text-gray-400 mt-2">Solo società dettagliate nei dati inseriti; gli ETF inversi sottraggono esposizione.</p>
            </div>
          </div>

          {/* Settori / paesi */}
          <div className="card !p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">Esposizione per {vistaEsp === 'settori' ? 'settore' : 'paese'} (% azionario)</p>
              <div className="inline-flex rounded-lg border border-surface-200 p-0.5 text-[11px]">
                {(['settori', 'paesi'] as const).map(v => (
                  <button
                    key={v} onClick={() => setVistaEsp(v)}
                    className={`px-2.5 py-1 rounded-md capitalize ${vistaEsp === v ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                  >{v}</button>
                ))}
              </div>
            </div>
            <TabellaConfronto
              righe={righeEsp} basePrima={prima.azionario} baseDopo={dopo.azionario} maxRighe={12}
              intestazione={vistaEsp === 'settori' ? 'Settore' : 'Paese'}
            />
          </div>
        </>
      )}
    </div>
  )
}
