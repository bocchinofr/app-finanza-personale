// components/portfolio/SimulatoreRiallocazione.tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ComposizioneEtf } from '@/lib/portfolioLookthrough'
import {
  ModoOperazione, Operazione, StatoPortafoglio, StrumentoSim, simula,
} from '@/lib/portfolioSimulation'
import {
  COLORI_CLASSE, fmtEuro, fmtEuroDelta, fmtPct, fmtPp, fmtPrezzo, fmtQta,
} from '@/lib/portfolioFormat'
import KpiCard from '@/components/ui/KpiCard'
import SegmentedControl from '@/components/ui/SegmentedControl'
import AllocazioneDonut from './AllocazioneDonut'
import SimulatoreInfoBox from './SimulatoreInfoBox'

const TH = 'py-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-surface-50 border-b border-surface-200 leading-tight'

interface Props {
  strumentiReali: StrumentoSim[]
  composizioni: ComposizioneEtf[]
  liquidita: number
  onNuovo: () => void
  onEditComposizione: (id: string) => void
  onElimina: (id: string) => void
  /** Acquisto precompilato (es. dal consiglio di accumulo). nonce cambia a ogni richiesta. */
  prefill?: { nonce: number; strumentoId: string; importo: number } | null
  onPrefillConsumed?: () => void
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
  if (calc.length === 0) return <p className="text-[13px] text-gray-400">Nessun dato inserito.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px]">
        <thead>
          <tr>
            <th className={`${TH}`}>{intestazione}</th>
            <th className={`${TH} text-right`}>Prima</th>
            <th className={`${TH} text-right`}>Dopo</th>
            <th className={`${TH} text-right`}>Δ</th>
            <th className={`${TH} w-20`} />
          </tr>
        </thead>
        <tbody>
          {calc.map(c => (
            <tr key={c.nome}>
              <td className="table-td !py-1.5 text-[13px] text-gray-800 truncate max-w-[180px]" title={c.nome}>{c.nome}</td>
              <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums text-gray-500">{fmtPct(c.p, 2)}</td>
              <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums font-medium">{fmtPct(c.d, 2)}</td>
              <td className={`table-td !py-1.5 text-right text-[13px] font-mono tabular-nums ${
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

export default function SimulatoreRiallocazione({
  strumentiReali, composizioni, liquidita, onNuovo, onEditComposizione, onElimina, prefill, onPrefillConsumed,
}: Props) {
  const [ops, setOps] = useState<Operazione[]>([])
  const [liqExtra, setLiqExtra] = useState(0)
  const [tabRis, setTabRis] = useState<'riepilogo' | 'fiscale' | 'esposizioni'>('riepilogo')
  const [vistaEsp, setVistaEsp] = useState<'societa' | 'settori' | 'paesi'>('societa')
  const [libAperta, setLibAperta] = useState(false)
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

  // Acquisto precompilato dal consiglio di accumulo
  const ultimoNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!prefill || ultimoNonce.current === prefill.nonce) return
    ultimoNonce.current = prefill.nonce
    if (!strumentiReali.some(s => s.id === prefill.strumentoId)) return
    contatore.current += 1
    setOps(prev => [...prev, {
      id: `op${contatore.current}`, tipo: 'acquista', strumentoId: prefill.strumentoId,
      modo: 'importo', valore: Math.round(prefill.importo), aliquota: 26, costi: 0,
    }])
    onPrefillConsumed?.()
  }, [prefill, strumentiReali, onPrefillConsumed])

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
    : vistaEsp === 'paesi' ? unisci(prima.lt.paesi, dopo.lt.paesi) : righeSoc

  const spesaTotale = totali.imposta + totali.costi
  const legenda = fette(prima).map((f, i) => ({
    nome: f.nome, colore: f.colore,
    p: prima.patrimonio > 0 ? (f.valore / prima.patrimonio) * 100 : 0,
    d: dopo.patrimonio > 0 ? (fette(dopo)[i].valore / dopo.patrimonio) * 100 : 0,
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SimulatoreInfoBox />
        <span className="text-[11px] text-gray-400">Simulatore di riallocazione · il portafoglio reale non cambia.</span>
      </div>

      <div className="space-y-4">
        {/* ===== Operazioni: barra azioni + box per operazione ===== */}
        <div className="card !p-3 flex flex-wrap items-center gap-2">
          <button onClick={() => aggiungi('vendi')} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors">− Vendi</button>
          <button onClick={() => aggiungi('acquista')} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">+ Acquista</button>
          <button onClick={onNuovo} className="btn-secondary !px-3 !py-1.5 text-[13px]">+ Nuovo strumento</button>
          <label className="ml-auto flex items-center gap-2 text-[11px] text-gray-500" title="Versamento (+) o prelievo (−) di liquidità da includere nella simulazione">
            Variazione liquidità €
            <input
              type="number" step="any" className="input !py-1 !w-24 text-[13px] font-mono"
              value={liqExtra === 0 ? '' : liqExtra} placeholder="0"
              onChange={e => setLiqExtra(Number(e.target.value) || 0)}
            />
          </label>
          {haOp && <button onClick={() => setOps([])} className="text-[12px] font-medium text-gray-400 hover:text-rose-600">Azzera</button>}
        </div>

        {ops.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-surface-200 px-4 py-6 text-center text-[13px] text-gray-400">
            Aggiungi una vendita o un acquisto per vedere l&apos;effetto sul portafoglio.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ops.map(o => {
              const d = dettPerId.get(o.id)
              const elenco = o.tipo === 'vendi' ? strumenti.filter(s => s.qta > 0) : strumenti
              const modi = o.tipo === 'vendi' ? MODI_VENDITA : MODI_ACQUISTO
              return (
                <div key={o.id} className={`rounded-xl border border-surface-200 border-t-4 bg-white p-3 shadow-sm ${o.tipo === 'vendi' ? '!border-t-rose-400' : '!border-t-emerald-500'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.tipo === 'vendi' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {o.tipo === 'vendi' ? 'Vendita' : 'Acquisto'}
                    </span>
                    <select className="input !py-1 text-[13px] flex-1 min-w-0" value={o.strumentoId} onChange={e => aggiorna(o.id, { strumentoId: e.target.value })}>
                      {elenco.map(s => <option key={s.id} value={s.id}>{s.nome}{s.nuovo ? ' (nuovo)' : ''}</option>)}
                    </select>
                    <button onClick={() => rimuovi(o.id)} className="text-gray-300 hover:text-rose-600 px-1 leading-none" aria-label="Rimuovi operazione">✕</button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <label className="text-[11px] font-medium text-gray-500">Modalità
                      <select
                        className="input mt-1 !py-1 text-[13px]" value={o.modo}
                        onChange={e => aggiorna(o.id, { modo: e.target.value as ModoOperazione, valore: e.target.value === 'percentuale' ? 100 : 0 })}
                      >
                        {modi.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    {o.modo !== 'tutto' && (
                      <label className="text-[11px] font-medium text-gray-500">Valore
                        <input
                          type="number" step="any" className="input mt-1 !py-1 text-[13px] font-mono"
                          value={o.valore === 0 ? '' : o.valore} placeholder="0"
                          onChange={e => aggiorna(o.id, { valore: Number(e.target.value) || 0 })}
                        />
                      </label>
                    )}
                    {o.tipo === 'vendi' && (
                      <label className="text-[11px] font-medium text-gray-500" title="Aliquota sulla plusvalenza">Tasse %
                        <input
                          type="number" step="any" className="input mt-1 !py-1 text-[13px] font-mono" value={o.aliquota}
                          onChange={e => aggiorna(o.id, { aliquota: Number(e.target.value) || 0 })}
                        />
                      </label>
                    )}
                    <label className="text-[11px] font-medium text-gray-500" title="Costi di transazione">Costi €
                      <input
                        type="number" step="any" className="input mt-1 !py-1 text-[13px] font-mono" value={o.costi === 0 ? '' : o.costi} placeholder="0"
                        onChange={e => aggiorna(o.id, { costi: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                  {d && d.avvisi.length > 0 && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">{d.avvisi.join(' · ')}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {libreria.length > 0 && (
          <div className="card !p-3">
            <div>
              <button onClick={() => setLibAperta(v => !v)} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 w-full">
                <span>{libAperta ? '▾' : '▸'}</span> Libreria strumenti nuovi ({libreria.length})
              </button>
              {libAperta && (
                <div className="mt-1.5 space-y-1">
                  {libreria.map(c => {
                    const m = c.meta!
                    const ha = c.top_holdings.length + c.settori.length + c.paesi.length > 0
                    return (
                      <div key={c.portafoglio_id} className="flex items-center gap-1.5 text-[13px]">
                        <span className="text-gray-800 truncate flex-1">{m.nome}</span>
                        <span className="font-mono text-[11px] text-gray-400">{m.ticker}{m.leva !== 1 ? ` ${m.leva}x` : ''}</span>
                        {m.leva === 1 && (
                          <button
                            onClick={() => onEditComposizione(c.portafoglio_id)}
                            className={`text-[11px] px-1.5 py-0.5 rounded-full border ${ha ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                          >{ha ? 'Dati' : 'Inserisci'}</button>
                        )}
                        <button onClick={() => onElimina(c.portafoglio_id)} className="text-gray-300 hover:text-rose-600 px-0.5" aria-label="Elimina dalla libreria">✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            </div>
        )}

        {/* ===== Colonna destra: risultati a schede ===== */}
        <div className="space-y-4 min-w-0 panel-in">
          {sim.avvisi.map(a => (
            <div key={a} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-800">{a}</div>
          ))}

          {!haOp ? (
            <div className="card !p-6 text-center text-[13px] text-gray-400">
              I risultati (valore, tasse, esposizioni prima/dopo) appaiono qui appena aggiungi un&apos;operazione.
            </div>
          ) : (
            <>
              {/* KPI riassuntivi */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-start">
                {[
                  { l: 'Patrimonio', v: fmtEuro(dopo.patrimonio), d: dopo.patrimonio - prima.patrimonio, c: '#6b7280' },
                  { l: 'Liquidità', v: fmtEuro(dopo.liquidita), d: dopo.liquidita - prima.liquidita, c: '#4a6fa1' },
                  { l: 'Tasse + costi', v: fmtEuro(spesaTotale), d: 0, c: '#c0504d' },
                  { l: 'Netto da vendite', v: fmtEuro(totali.nettoReinvestibile), d: 0, c: '#3f6b4f' },
                ].map(k => (
                  <KpiCard key={k.l} variant="compact" label={k.l} color={k.c} delta={null} value={k.v}
                    badge={Math.abs(k.d) > 0.5
                      ? <span className={`inline-flex rounded-full text-[11px] font-semibold px-2 py-0.5 ${k.d > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{fmtEuroDelta(k.d)}</span>
                      : undefined} />
                ))}
              </div>

              {/* Schede */}
              <div className="card !p-0 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-surface-100">
                  <SegmentedControl
                    ariaLabel="Risultati della simulazione" value={tabRis} onChange={setTabRis}
                    options={[{ value: 'riepilogo', label: 'Riepilogo' }, { value: 'fiscale', label: 'Fiscalità' }, { value: 'esposizioni', label: 'Esposizioni' }]}
                  />
                </div>

                <div className="p-3">
                  {tabRis === 'riepilogo' && (
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      <div className="md:col-span-2">
                        <div className="grid grid-cols-2 gap-2">
                          {([['Prima', prima], ['Dopo', dopo]] as const).map(([titolo, st]) => (
                            <div key={titolo}>
                              <p className="text-[11px] text-gray-400 text-center uppercase tracking-wide">{titolo}</p>
                              <AllocazioneDonut fette={fette(st)} centro={fmtEuro(st.patrimonio)} altezza={110} />
                            </div>
                          ))}
                        </div>
                        <div className="mt-1.5 space-y-0.5">
                          {legenda.map(f => (
                            <div key={f.nome} className="flex items-center gap-1.5 text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: f.colore }} />
                              <span className="text-gray-500 flex-1">{f.nome}</span>
                              <span className="font-mono tabular-nums text-gray-400">{fmtPct(f.p, 0)}</span>
                              <span className="text-gray-300">→</span>
                              <span className="font-mono tabular-nums text-gray-800 w-9 text-right">{fmtPct(f.d, 0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="md:col-span-3">
                        <p className="text-[11px] text-gray-400 mb-1">Peso per strumento (% patrimonio)</p>
                        <TabellaConfronto righe={righeStrumenti} basePrima={prima.patrimonio} baseDopo={dopo.patrimonio} maxRighe={8} intestazione="Strumento" />
                      </div>
                    </div>
                  )}

                  {tabRis === 'fiscale' && (
                    <div className="space-y-3">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[460px]">
                          <thead>
                            <tr>
                              <th className={`${TH}`}>Operazione</th>
                              <th className={`${TH} text-right`}>Valore</th>
                              <th className={`${TH} text-right`}>Plus</th>
                              <th className={`${TH} text-right`}>Imposta</th>
                              <th className={`${TH} text-right`}>Netto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...vendite, ...acquisti].map(d => (
                              <tr key={d.op.id}>
                                <td className="table-td !py-1.5 text-[13px]">
                                  <span className={d.op.tipo === 'vendi' ? 'text-rose-700' : 'text-emerald-700'}>{d.op.tipo === 'vendi' ? 'V' : 'A'}</span>{' '}
                                  <span className="text-gray-800">{d.strumento.nome}</span>
                                  <span className="block text-[11px] text-gray-400 font-mono">
                                    {fmtQta(d.qta)} q.{d.op.tipo === 'vendi' && <> · PMC {fmtPrezzo(d.pmc)}</>}
                                    {d.op.tipo === 'acquista' && d.strumento.qta > 0 && d.qta > 0 && (
                                      <> · PMC {fmtPrezzo(d.strumento.pmc)} → {fmtPrezzo((d.strumento.qta * d.strumento.pmc + d.lordo) / (d.strumento.qta + d.qta))}</>
                                    )}
                                  </span>
                                </td>
                                <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums">{fmtEuro(d.lordo)}</td>
                                <td className={`table-td !py-1.5 text-right text-[13px] font-mono tabular-nums ${d.plus < 0 ? 'text-rose-600' : ''}`}>
                                  {d.op.tipo === 'vendi' ? fmtEuro(d.plus) : '–'}
                                </td>
                                <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums">{d.op.tipo === 'vendi' ? fmtEuro(d.imposta) : '–'}</td>
                                <td className={`table-td !py-1.5 text-right text-[13px] font-mono tabular-nums font-medium ${d.netto < 0 ? 'text-rose-600' : ''}`}>{fmtEuro(d.netto)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-surface-100 rounded-lg overflow-hidden">
                        {[
                          ['Plus realizzata', fmtEuro(totali.plusRealizzata)],
                          ['Imposta teorica', fmtEuro(totali.imposta)],
                          ['Costi', fmtEuro(totali.costi)],
                          ['Latente residua', fmtEuro(dopo.latente)],
                        ].map(([l, v]) => (
                          <div key={l} className="bg-white px-3 py-1.5">
                            <p className="text-[11px] uppercase tracking-wide text-gray-400">{l}</p>
                            <p className="num-display text-sm font-bold tabular-nums text-gray-900">{v}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-400">Latente prima delle operazioni: {fmtEuro(prima.latente)}. Le perdite non sono compensate.</p>
                    </div>
                  )}

                  {tabRis === 'esposizioni' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex rounded-lg border border-surface-200 p-0.5 text-[11px]">
                          {([['societa', 'Società'], ['settori', 'Settori'], ['paesi', 'Paesi']] as const).map(([k, l]) => (
                            <button
                              key={k} onClick={() => setVistaEsp(k)}
                              className={`px-2.5 py-1 rounded-md ${vistaEsp === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                            >{l}</button>
                          ))}
                        </div>
                        <span className="text-[11px] text-gray-400 text-right">
                          {vistaEsp === 'societa' ? '% patrimonio' : '% azionario'} · copertura dati {fmtPct(prima.coperturaAzionario, 0)} → {fmtPct(dopo.coperturaAzionario, 0)}
                        </span>
                      </div>
                      <TabellaConfronto
                        righe={righeEsp}
                        basePrima={vistaEsp === 'societa' ? prima.patrimonio : prima.azionario}
                        baseDopo={vistaEsp === 'societa' ? dopo.patrimonio : dopo.azionario}
                        maxRighe={8}
                        intestazione={vistaEsp === 'societa' ? 'Società' : vistaEsp === 'settori' ? 'Settore' : 'Paese'}
                      />
                      {vistaEsp === 'societa' && <p className="text-[11px] text-gray-400">Solo società dettagliate nei dati inseriti; gli ETF inversi sottraggono esposizione.</p>}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
