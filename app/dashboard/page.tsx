'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Movimento, MESI } from '@/types'
import { HeatmapCell } from '@/components/charts/HeatmapCell'

const MESI_LABEL: Record<string, string> = {
  gen:'Gen',feb:'Feb',mar:'Mar',apr:'Apr',mag:'Mag',giu:'Giu',
  lug:'Lug',ago:'Ago',set:'Set',ott:'Ott',nov:'Nov',dic:'Dic'
}

const CATEGORIE_ENTRATE = new Set([
  'STIPENDIO G','STIPENDIO F','ASSEGNO UNICO','BONUS NIDO','RIMBORSI','INTERESSI','VENDITA TITOLI'
])
const CATEGORIE_INVESTIMENTI = new Set(['INVESTIMENTI'])

function fmt(n: number) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtK(n: number) {
  if (n === 0) return '–'
  return `€${Math.round(n).toLocaleString('it-IT')}`
}

const PAGE_SIZE = 25

export default function DashboardPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'movimenti'|'cashflow'>('movimenti')
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [anno, setAnno] = useState(2026)

  // Filters
  const [filterPersona, setFilterPersona] = useState<'all'|'G'|'F'>('all')
  const [filterMese, setFilterMese] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterType, setFilterType] = useState<'all'|'in'|'out'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data } = await supabase
      .from('movimenti')
      .select('*')
      .eq('user_id', user.id)
      .eq('anno', anno)
      .order('mese', { ascending: true })

    setMovimenti((data as Movimento[]) ?? [])
    setLoading(false)
  }, [anno])

  useEffect(() => { loadData() }, [loadData])

  // Filtered movimenti
  const filtered = movimenti.filter(m => {
    if (filterPersona !== 'all' && m.persona !== filterPersona) return false
    if (filterMese && m.mese !== filterMese) return false
    if (filterCat && m.categoria !== filterCat) return false
    if (filterType === 'in' && m.entrate === 0) return false
    if (filterType === 'out' && m.uscite === 0) return false
    if (search && !m.descrizione.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const mi = MESI.indexOf(a.mese as typeof MESI[number]) - MESI.indexOf(b.mese as typeof MESI[number])
    return mi !== 0 ? mi : (a.data_operazione ?? '').localeCompare(b.data_operazione ?? '')
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totalIn = filtered.reduce((s, m) => s + m.entrate, 0)
  const totalOut = filtered.reduce((s, m) => s + m.uscite, 0)
  const saldo = totalIn - totalOut

  const cats = [...new Set(movimenti.map(m => m.categoria))].sort()

  // --- Cash Flow data ---
  const mesiPresenti = MESI.filter(m => movimenti.some(r => r.mese === m))

  const cfEntrate: Record<string, Record<string, number>> = {}
  const cfUscite: Record<string, Record<string, number>> = {}
  const cfInv: Record<string, Record<string, number>> = {}

  for (const m of movimenti) {
    const cat = m.categoria
    const isEntrata = CATEGORIE_ENTRATE.has(cat)
    const isInv = CATEGORIE_INVESTIMENTI.has(cat)
    const target = isInv ? cfInv : isEntrata ? cfEntrate : cfUscite
    if (!target[cat]) target[cat] = {}
    target[cat][m.mese] = (target[cat][m.mese] ?? 0) + (m.entrate > 0 ? m.entrate : m.uscite)
  }

  const cfTotIn = mesiPresenti.map(ms => Object.values(cfEntrate).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfTotOut = mesiPresenti.map(ms => Object.values(cfUscite).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfTotInv = mesiPresenti.map(ms => Object.values(cfInv).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfRisparmio = mesiPresenti.map((_, i) => cfTotIn[i] - cfTotOut[i] - cfTotInv[i])

  const maxEntrata = Math.max(...Object.values(cfEntrate).flatMap(r => Object.values(r)), 1)
  const maxUscita = Math.max(...Object.values(cfUscite).flatMap(r => Object.values(r)), 1)
  const maxInv = Math.max(...Object.values(cfInv).flatMap(r => Object.values(r)), 1)

  const ytdIn = cfTotIn.reduce((a, b) => a + b, 0)
  const ytdOut = cfTotOut.reduce((a, b) => a + b, 0)
  const ytdInv = cfTotInv.reduce((a, b) => a + b, 0)
  const ytdRisp = cfRisparmio.reduce((a, b) => a + b, 0)

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  )

  if (movimenti.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-sm text-gray-500">Nessun dato per il {anno}.</p>
      <a href="/dashboard/upload" className="btn-primary text-sm">Carica file Excel</a>
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Dashboard {anno}</h1>
          <p className="text-xs text-gray-400 mt-0.5">{movimenti.length} movimenti totali</p>
        </div>
        <select value={anno} onChange={e => { setAnno(Number(e.target.value)); setPage(1) }}
          className="input w-24 text-sm">
          {[2024,2025,2026].map(y => <option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-surface-200">
        {(['movimenti', 'cashflow'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${tab === t ? 'border-brand-500 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'movimenti' ? 'Movimenti conto' : 'Cash flow'}
          </button>
        ))}
      </div>

      {/* ===== MOVIMENTI ===== */}
      {tab === 'movimenti' && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Entrate', val: `€ ${fmt(totalIn)}`, color: 'text-green-700' },
              { label: 'Uscite', val: `€ ${fmt(totalOut)}`, color: 'text-red-600' },
              { label: 'Saldo', val: `€ ${fmt(saldo)}`, color: saldo >= 0 ? 'text-green-700' : 'text-red-600' },
              { label: 'Movimenti', val: filtered.length.toString(), color: 'text-gray-900' },
            ].map(c => (
              <div key={c.label} className="card py-3">
                <p className="text-xs text-gray-400 mb-1">{c.label}</p>
                <p className={`text-xl font-semibold ${c.color}`}>{c.val}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <div className="flex rounded-lg border border-surface-200 overflow-hidden text-xs">
              {(['all','G','F'] as const).map(p => (
                <button key={p} onClick={() => { setFilterPersona(p); setPage(1) }}
                  className={`px-3 py-1.5 font-medium transition-colors
                    ${filterPersona === p ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-surface-50'}`}>
                  {p === 'all' ? 'Tutti' : p}
                </button>
              ))}
            </div>

            <select value={filterMese} onChange={e => { setFilterMese(e.target.value); setPage(1) }}
              className="input w-32 text-xs py-1.5">
              <option value="">Tutti i mesi</option>
              {MESI.map(m => <option key={m} value={m}>{MESI_LABEL[m]}</option>)}
            </select>

            <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1) }}
              className="input w-44 text-xs py-1.5">
              <option value="">Tutte le categorie</option>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>

            <select value={filterType} onChange={e => { setFilterType(e.target.value as 'all'|'in'|'out'); setPage(1) }}
              className="input w-36 text-xs py-1.5">
              <option value="all">Entrate + Uscite</option>
              <option value="in">Solo entrate</option>
              <option value="out">Solo uscite</option>
            </select>

            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cerca descrizione…" className="input flex-1 min-w-32 text-xs py-1.5" />
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th w-12">Mese</th>
                    <th className="table-th w-24">Data</th>
                    <th className="table-th">Descrizione</th>
                    <th className="table-th w-28 text-right">Importo</th>
                    <th className="table-th w-20">Tipo</th>
                    <th className="table-th w-36">Categoria</th>
                    <th className="table-th w-8 text-center">P</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((m, i) => {
                    const isIn = m.entrate > 0
                    const amt = isIn ? m.entrate : m.uscite
                    return (
                      <tr key={i} className="hover:bg-surface-50 transition-colors">
                        <td className="table-td text-gray-400 text-xs">{m.mese}</td>
                        <td className="table-td text-gray-400 text-xs">{m.data_operazione}</td>
                        <td className="table-td max-w-xs">
                          <span className="block truncate text-xs" title={m.descrizione}>{m.descrizione}</span>
                        </td>
                        <td className={`table-td text-right text-xs font-medium tabular-nums
                          ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                          {isIn ? '+' : '–'} € {fmt(amt)}
                        </td>
                        <td className="table-td">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                            ${isIn ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                            {isIn ? 'Entrata' : 'Uscita'}
                          </span>
                        </td>
                        <td className="table-td">
                          <span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {m.categoria}
                          </span>
                        </td>
                        <td className="table-td text-center text-xs font-medium text-gray-400">{m.persona}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-surface-100">
              <span className="text-xs text-gray-400">{sorted.length} righe</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                  className="btn-secondary px-2 py-1 text-xs disabled:opacity-30">←</button>
                <span className="text-xs text-gray-600">Pag. {page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                  className="btn-secondary px-2 py-1 text-xs disabled:opacity-30">→</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== CASH FLOW ===== */}
      {tab === 'cashflow' && (
        <>
          {/* YTD Summary */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Entrate YTD', val: fmtK(ytdIn), color: 'text-green-700' },
              { label: 'Uscite YTD', val: fmtK(ytdOut), color: 'text-red-600' },
              { label: 'Investimenti YTD', val: fmtK(ytdInv), color: 'text-blue-700' },
              { label: 'Risparmio netto YTD', val: fmtK(ytdRisp), color: ytdRisp >= 0 ? 'text-green-700' : 'text-red-600' },
            ].map(c => (
              <div key={c.label} className="card py-3">
                <p className="text-xs text-gray-400 mb-1">{c.label}</p>
                <p className={`text-xl font-semibold ${c.color}`}>{c.val}</p>
              </div>
            ))}
          </div>

          {/* Heatmap table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="bg-surface-50 border-b border-surface-200">
                    <th className="table-th w-40">Voce</th>
                    {mesiPresenti.map(m => (
                      <th key={m} className="table-th text-right w-24">{MESI_LABEL[m]}</th>
                    ))}
                    <th className="table-th text-right w-24">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ENTRATE */}
                  <tr>
                    <td colSpan={mesiPresenti.length + 2}
                      className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 bg-surface-50 border-y border-surface-200">
                      Entrate
                    </td>
                  </tr>
                  {Object.entries(cfEntrate).map(([cat, vals]) => {
                    const tot = Object.values(vals).reduce((a,b)=>a+b,0)
                    if (tot === 0) return null
                    return (
                      <tr key={cat} className="hover:brightness-95 transition-all">
                        <td className="px-3 py-1.5 text-xs text-gray-600 border-b border-surface-100 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => (
                          <HeatmapCell key={m} value={vals[m]??0} max={maxEntrata} isPositive={true} format={fmtK} />
                        ))}
                        <td className="px-3 py-1.5 text-xs font-semibold text-right text-green-800 bg-green-50 border-b border-surface-100">
                          {fmtK(tot)}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="bg-green-50">
                    <td className="px-3 py-2 text-xs font-semibold text-green-800 border-b border-surface-200">Totale entrate</td>
                    {cfTotIn.map((v, i) => (
                      <td key={i} className="px-3 py-2 text-xs font-semibold text-right text-green-800 border-b border-surface-200">{fmtK(v)}</td>
                    ))}
                    <td className="px-3 py-2 text-xs font-bold text-right text-green-900 border-b border-surface-200">{fmtK(ytdIn)}</td>
                  </tr>

                  {/* USCITE */}
                  <tr>
                    <td colSpan={mesiPresenti.length + 2}
                      className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 bg-surface-50 border-y border-surface-200">
                      Uscite
                    </td>
                  </tr>
                  {Object.entries(cfUscite).map(([cat, vals]) => {
                    const tot = Object.values(vals).reduce((a,b)=>a+b,0)
                    if (tot === 0) return null
                    return (
                      <tr key={cat} className="hover:brightness-95 transition-all">
                        <td className="px-3 py-1.5 text-xs text-gray-600 border-b border-surface-100 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => (
                          <HeatmapCell key={m} value={vals[m]??0} max={maxUscita} isPositive={false} format={fmtK} />
                        ))}
                        <td className="px-3 py-1.5 text-xs font-semibold text-right text-red-800 bg-red-50 border-b border-surface-100">
                          {fmtK(tot)}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="bg-red-50">
                    <td className="px-3 py-2 text-xs font-semibold text-red-800 border-b border-surface-200">Totale uscite</td>
                    {cfTotOut.map((v, i) => (
                      <td key={i} className="px-3 py-2 text-xs font-semibold text-right text-red-800 border-b border-surface-200">{fmtK(v)}</td>
                    ))}
                    <td className="px-3 py-2 text-xs font-bold text-right text-red-900 border-b border-surface-200">{fmtK(ytdOut)}</td>
                  </tr>

                  {/* INVESTIMENTI */}
                  {Object.keys(cfInv).length > 0 && <>
                    <tr>
                      <td colSpan={mesiPresenti.length + 2}
                        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 bg-surface-50 border-y border-surface-200">
                        Investimenti
                      </td>
                    </tr>
                    {Object.entries(cfInv).map(([cat, vals]) => {
                      const tot = Object.values(vals).reduce((a,b)=>a+b,0)
                      if (tot === 0) return null
                      return (
                        <tr key={cat} className="hover:brightness-95 transition-all">
                          <td className="px-3 py-1.5 text-xs text-gray-600 border-b border-surface-100 whitespace-nowrap">{cat}</td>
                          {mesiPresenti.map(m => (
                            <HeatmapCell key={m} value={vals[m]??0} max={maxInv} isPositive={true} format={fmtK} />
                          ))}
                          <td className="px-3 py-1.5 text-xs font-semibold text-right text-blue-800 bg-blue-50 border-b border-surface-100">
                            {fmtK(tot)}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-blue-50">
                      <td className="px-3 py-2 text-xs font-semibold text-blue-800 border-b border-surface-200">Totale investimenti</td>
                      {cfTotInv.map((v, i) => (
                        <td key={i} className="px-3 py-2 text-xs font-semibold text-right text-blue-800 border-b border-surface-200">{fmtK(v)}</td>
                      ))}
                      <td className="px-3 py-2 text-xs font-bold text-right text-blue-900 border-b border-surface-200">{fmtK(ytdInv)}</td>
                    </tr>
                  </>}

                  {/* RISPARMIO NETTO */}
                  <tr className="border-t-2 border-surface-300">
                    <td className="px-3 py-2.5 text-xs font-bold text-gray-800">Risparmio netto</td>
                    {cfRisparmio.map((v, i) => (
                      <td key={i} className={`px-3 py-2.5 text-xs font-bold text-right
                        ${v >= 0 ? 'text-green-800 bg-green-50' : 'text-red-800 bg-red-50'}`}>
                        {fmtK(v)}
                      </td>
                    ))}
                    <td className={`px-3 py-2.5 text-sm font-bold text-right
                      ${ytdRisp >= 0 ? 'text-green-900 bg-green-100' : 'text-red-900 bg-red-100'}`}>
                      {fmtK(ytdRisp)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
