'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Movimento, Liquidita, AssetPortafoglio, MESI } from '@/types'
import { HeatmapCell } from '@/components/charts/HeatmapCell'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Area, AreaChart
} from 'recharts'

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
function fmtShort(n: number) {
  if (Math.abs(n) >= 1000) return `€${(n/1000).toFixed(1)}k`
  return `€${Math.round(n)}`
}

const PIE_COLORS = [
  '#3b69d6','#22c55e','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#a855f7','#eab308','#6366f1','#10b981'
]

const PAGE_SIZE = 25
type SortKey = 'mese' | 'data_operazione' | 'descrizione' | 'importo' | 'categoria' | 'componente'
type SortDir = 'asc' | 'desc'

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 text-xs ${active ? 'text-brand-600' : 'text-gray-300'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )
}

export default function DashboardPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'movimenti' | 'cashflow' | 'portafoglio'>('movimenti')
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [liquidita, setLiquidita] = useState<Liquidita[]>([])
  const [portafoglio, setPortafoglio] = useState<AssetPortafoglio[]>([])
  const [loading, setLoading] = useState(true)
  const [anno, setAnno] = useState(2026)
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, number>>({})
  const [loadingPrezzi, setLoadingPrezzi] = useState(false)

  // Filters
  const [filterComponente, setFilterComponente] = useState('')
  const [filterMese, setFilterMese] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('mese')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [movRes, liqRes, portRes] = await Promise.all([
      supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', anno),
      supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
      supabase.from('portafoglio').select('*').eq('user_id', user.id),
    ])

    setMovimenti((movRes.data as Movimento[]) ?? [])
    setLiquidita((liqRes.data as Liquidita[]) ?? [])
    setPortafoglio((portRes.data as AssetPortafoglio[]) ?? [])
    setLoading(false)
  }, [anno])

  useEffect(() => { loadData() }, [loadData])

  // Prezzi attuali via Yahoo Finance (proxy pubblico)
  async function fetchPrezziAttuali() {
    const tickers = [...new Set(portafoglio.map(a => a.ticker).filter(Boolean))]
    if (tickers.length === 0) return
    setLoadingPrezzi(true)
    const result: Record<string, number> = {}
    await Promise.all(tickers.map(async ticker => {
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`)
        const json = await res.json()
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (price) result[ticker] = price
      } catch { /* ignora errori singoli ticker */ }
    }))
    setPrezziAttuali(result)
    setLoadingPrezzi(false)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const componenti = [...new Set(movimenti.map(m => m.componente).filter(Boolean))].sort()

  const filtered = movimenti.filter(m => {
    if (filterComponente && m.componente !== filterComponente) return false
    if (filterMese && m.mese !== filterMese) return false
    if (filterCat && m.categoria !== filterCat) return false
    if (filterType === 'in' && m.entrate === 0) return false
    if (filterType === 'out' && m.uscite === 0) return false
    if (search && !m.descrizione.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const getMesiIdx = (m: Movimento) => MESI.indexOf(m.mese as typeof MESI[number])
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'mese': cmp = getMesiIdx(a) - getMesiIdx(b); if (cmp === 0) cmp = (a.data_operazione ?? '').localeCompare(b.data_operazione ?? ''); break
      case 'data_operazione': cmp = (a.data_operazione ?? '').localeCompare(b.data_operazione ?? ''); break
      case 'descrizione': cmp = a.descrizione.localeCompare(b.descrizione); break
      case 'importo': cmp = (a.entrate + a.uscite) - (b.entrate + b.uscite); break
      case 'categoria': cmp = a.categoria.localeCompare(b.categoria); break
      case 'componente': cmp = (a.componente ?? '').localeCompare(b.componente ?? ''); break
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalIn = filtered.reduce((s, m) => s + m.entrate, 0)
  const totalOut = filtered.reduce((s, m) => s + m.uscite, 0)
  const saldo = totalIn - totalOut
  const cats = [...new Set(movimenti.map(m => m.categoria))].sort()

  // Liquidità: ultima registrazione disponibile per i movimenti
  const ultimaLiquidita = (() => {
    if (liquidita.length === 0) return null
    const sorted = [...liquidita].sort((a, b) => {
      const mi = MESI.indexOf(a.mese as typeof MESI[number]) - MESI.indexOf(b.mese as typeof MESI[number])
      return mi
    })
    const lastMese = sorted[sorted.length - 1].mese
    const rows = sorted.filter(l => l.mese === lastMese)
    const total = rows.reduce((s, l) => s + l.saldo, 0)
    return { mese: lastMese, total, conti: rows }
  })()

  // Cash Flow data
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

  const cfTotIn  = mesiPresenti.map(ms => Object.values(cfEntrate).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfTotOut = mesiPresenti.map(ms => Object.values(cfUscite).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfTotInv = mesiPresenti.map(ms => Object.values(cfInv).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfRisparmio = mesiPresenti.map((_, i) => cfTotIn[i] - cfTotOut[i] - cfTotInv[i])

  const maxEntrata = Math.max(...Object.values(cfEntrate).flatMap(r => Object.values(r)), 1)
  const maxUscita  = Math.max(...Object.values(cfUscite).flatMap(r => Object.values(r)), 1)
  const maxInv     = Math.max(...Object.values(cfInv).flatMap(r => Object.values(r)), 1)

  const entrateTotals = Object.entries(cfEntrate).map(([cat, vals]) => ({ cat, total: Object.values(vals).reduce((a, b) => a + b, 0) })).filter(d => d.total > 0)
  const usciteTotals  = Object.entries(cfUscite).map(([cat, vals]) => ({ cat, total: Object.values(vals).reduce((a, b) => a + b, 0) })).filter(d => d.total > 0)
  const invTotals     = Object.entries(cfInv).map(([cat, vals]) => ({ cat, total: Object.values(vals).reduce((a, b) => a + b, 0) })).filter(d => d.total > 0)

  const maxEntrataTotal = Math.max(...entrateTotals.map(d => d.total), 0)
  const maxUscitaTotal  = Math.max(...usciteTotals.map(d => d.total), 0)
  const maxInvTotal     = Math.max(...invTotals.map(d => d.total), 0)

  const maxPerEntrata: Record<string, number> = {}
  Object.entries(cfEntrate).forEach(([cat, vals]) => { maxPerEntrata[cat] = Math.max(...Object.values(vals), 0) })
  const maxPerUscita: Record<string, number> = {}
  Object.entries(cfUscite).forEach(([cat, vals]) => { maxPerUscita[cat] = Math.max(...Object.values(vals), 0) })
  const maxPerInv: Record<string, number> = {}
  Object.entries(cfInv).forEach(([cat, vals]) => { maxPerInv[cat] = Math.max(...Object.values(vals), 0) })

  const ytdIn   = cfTotIn.reduce((a, b) => a + b, 0)
  const ytdOut  = cfTotOut.reduce((a, b) => a + b, 0)
  const ytdInv  = cfTotInv.reduce((a, b) => a + b, 0)
  const ytdRisp = cfRisparmio.reduce((a, b) => a + b, 0)

  const lineData = mesiPresenti.map((m, i) => ({
    mese: MESI_LABEL[m],
    Entrate: Math.round(cfTotIn[i]),
    Uscite: Math.round(cfTotOut[i]),
    Risparmio: Math.round(cfRisparmio[i]),
    Liquidità: Math.round(liquidita.filter(l => l.mese === m).reduce((s, l) => s + l.saldo, 0)) || undefined,
  }))

  const rawPieData = Object.entries(cfUscite)
    .map(([cat, vals]) => ({ name: cat, value: Math.round(Object.values(vals).reduce((a, b) => a + b, 0)) }))
    .filter(d => d.value > 0).sort((a, b) => b.value - a.value)
  const top5Pie = rawPieData.slice(0, 5)
  const otherValue = rawPieData.slice(5).reduce((s, d) => s + d.value, 0)
  const pieData = otherValue > 0 ? [...top5Pie, { name: 'Altre', value: otherValue }] : top5Pie
  const topUsciteCats = pieData.slice(0, 5).map(d => d.name)
  const barData = mesiPresenti.map((m, i) => {
    const row: Record<string, number | string> = { mese: MESI_LABEL[m] }
    topUsciteCats.forEach(cat => { row[cat] = Math.round(cfUscite[cat]?.[m] ?? 0) })
    row['Altre'] = Math.round(cfTotOut[i] - topUsciteCats.reduce((s, cat) => s + (cfUscite[cat]?.[m] ?? 0), 0))
    return row
  })

  // Portafoglio
  const assetClasses = [...new Set(portafoglio.map(a => a.asset).filter(Boolean))]
  const valoreCaricoTotale = portafoglio.reduce((s, a) => s + (a.prezzo_acquisto * a.quantita), 0)
  const valoreAttualeTotale = portafoglio.reduce((s, a) => {
    const prezzoAtt = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker] : a.prezzo_acquisto
    return s + (prezzoAtt * a.quantita)
  }, 0)
  const plusminus = valoreAttualeTotale - valoreCaricoTotale

  const piePortafoglio = assetClasses.map(cls => ({
    name: cls,
    value: Math.round(portafoglio.filter(a => a.asset === cls).reduce((s, a) => {
      const p = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker] : a.prezzo_acquisto
      return s + p * a.quantita
    }, 0))
  })).filter(d => d.value > 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>

  if (movimenti.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-sm text-gray-500">Nessun dato per il {anno}.</p>
      <a href="/dashboard/upload" className="btn-primary text-sm">Importa dati</a>
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Dashboard {anno}</h1>
          <p className="text-xs text-gray-400 mt-0.5">{movimenti.length} movimenti totali</p>
        </div>
        <select value={anno} onChange={e => { setAnno(Number(e.target.value)); setPage(1) }} className="input w-24 text-sm">
          {[2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-surface-200">
        {(['movimenti', 'cashflow', 'portafoglio'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${tab === t ? 'border-brand-500 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'movimenti' ? 'Movimenti conto' : t === 'cashflow' ? 'Cash flow' : 'Portafoglio'}
          </button>
        ))}
      </div>

      {/* ===== MOVIMENTI ===== */}
      {tab === 'movimenti' && (
        <>
          {/* Metric cards + liquidità */}
          <div className="grid grid-cols-5 gap-3 mb-5">
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
            {/* Liquidità card */}
            <div className="card py-3 border-blue-100">
              <p className="text-xs text-gray-400 mb-1">
                Liquidità {ultimaLiquidita ? `(${MESI_LABEL[ultimaLiquidita.mese]})` : ''}
              </p>
              {ultimaLiquidita ? (
                <>
                  <p className="text-xl font-semibold text-blue-700">{fmtK(ultimaLiquidita.total)}</p>
                  {ultimaLiquidita.conti.length > 1 && (
                    <p className="text-xs text-gray-400 mt-1">
                      {ultimaLiquidita.conti.map(c => `${c.conto}: ${fmtK(c.saldo)}`).join(' · ')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xl font-semibold text-gray-300">–</p>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            {componenti.length > 0 && (
              <select value={filterComponente} onChange={e => { setFilterComponente(e.target.value); setPage(1) }} className="input w-36 text-xs py-1.5">
                <option value="">Tutti</option>
                {componenti.map(c => <option key={c}>{c}</option>)}
              </select>
            )}
            <select value={filterMese} onChange={e => { setFilterMese(e.target.value); setPage(1) }} className="input w-28 text-xs py-1.5">
              <option value="">Tutti i mesi</option>
              {MESI.map(m => <option key={m} value={m}>{MESI_LABEL[m]}</option>)}
            </select>
            <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1) }} className="input w-44 text-xs py-1.5">
              <option value="">Tutte le categorie</option>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterType} onChange={e => { setFilterType(e.target.value as 'all' | 'in' | 'out'); setPage(1) }} className="input w-36 text-xs py-1.5">
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
                    {([
                      { key: 'mese', label: 'Mese', w: 'w-16' },
                      { key: 'data_operazione', label: 'Data', w: 'w-24' },
                      { key: 'descrizione', label: 'Descrizione', w: '' },
                      { key: 'importo', label: 'Importo', w: 'w-28' },
                      { key: 'categoria', label: 'Categoria', w: 'w-36' },
                      ...(componenti.length > 0 ? [{ key: 'componente', label: 'Comp.', w: 'w-24' }] : []),
                    ] as { key: SortKey; label: string; w: string }[]).map(col => (
                      <th key={col.key} onClick={() => toggleSort(col.key)}
                        className={`table-th cursor-pointer select-none hover:bg-surface-100 ${col.w} ${col.key === 'importo' ? 'text-right' : ''}`}>
                        {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                      </th>
                    ))}
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
                        <td className="table-td max-w-xs"><span className="block truncate text-xs" title={m.descrizione}>{m.descrizione}</span></td>
                        <td className={`table-td text-right text-xs font-medium tabular-nums ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                          {isIn ? '+' : '–'} € {fmt(amt)}
                        </td>
                        <td className="table-td"><span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">{m.categoria}</span></td>
                        {componenti.length > 0 && <td className="table-td text-xs text-gray-400">{m.componente}</td>}
                      </tr>
                    )
                  })}
                  {pageData.length === 0 && <tr><td colSpan={6} className="table-td text-center text-gray-400 py-8">Nessun risultato</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-surface-100">
              <span className="text-xs text-gray-400">{sorted.length} righe</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-2 py-1 text-xs disabled:opacity-30">←</button>
                <span className="text-xs text-gray-600">Pag. {page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-2 py-1 text-xs disabled:opacity-30">→</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== CASH FLOW ===== */}
      {tab === 'cashflow' && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-6">
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

          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Linee: andamento mensile + liquidità */}
            <div className="card col-span-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Andamento mensile</p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={lineData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtK(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Entrate" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Uscite" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Risparmio" stroke="#3b69d6" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
                  {liquidita.length > 0 && (
                    <Line type="monotone" dataKey="Liquidità" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Liquidità per conto nel tempo */}
            {liquidita.length > 0 && (
              <div className="card col-span-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Andamento liquidità per conto</p>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart
                    data={mesiPresenti.map(m => {
                      const row: Record<string, number | string> = { mese: MESI_LABEL[m] }
                      const conti = [...new Set(liquidita.map(l => l.conto))]
                      conti.forEach(c => {
                        row[c] = liquidita.find(l => l.mese === m && l.conto === c)?.saldo ?? 0
                      })
                      return row
                    })}
                    margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                    <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtShort(v)} />
                    <Tooltip formatter={(v: number) => fmtK(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {[...new Set(liquidita.map(l => l.conto))].map((conto, i) => (
                      <Area key={conto} type="monotone" dataKey={conto}
                        stroke={PIE_COLORS[i % PIE_COLORS.length]}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        fillOpacity={0.15} strokeWidth={2} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Barre spese */}
            <div className="card">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Spese per categoria (top 5)</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtShort(v)} />
                  <Tooltip formatter={(v: number) => fmtK(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {[...topUsciteCats, 'Altre'].map((cat, i) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Torta spese */}
            <div className="card">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Distribuzione uscite YTD</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="40%"
                    outerRadius={70} innerRadius={35}
                    label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtK(v)} />
                  <Legend layout="horizontal" verticalAlign="bottom" align="center"
                    wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconSize={10} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Heatmap */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="bg-surface-50 border-b-2 border-surface-200">
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 w-40">Voce</th>
                    {mesiPresenti.map(m => <th key={m} className="px-2 py-2 text-right text-xs font-semibold text-gray-600 w-20">{MESI_LABEL[m]}</th>)}
                    <th className="px-2 py-2 text-right text-xs font-semibold text-gray-600 w-20">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={mesiPresenti.length + 2} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 bg-surface-50 border-y border-surface-200">Entrate</td></tr>
                  {entrateTotals.map(({ cat, total }) => {
                    const vals = cfEntrate[cat]; const rowMax = maxPerEntrata[cat] || maxEntrata
                    return (
                      <tr key={cat} className="border-b border-surface-100">
                        <td className="px-2 py-1.5 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => <HeatmapCell key={m} value={vals[m] ?? 0} max={rowMax} isPositive={true} format={fmtK} />)}
                        <HeatmapCell value={total} max={maxEntrataTotal} isPositive={true} format={fmtK} className="px-1 py-1.5 text-right" />
                      </tr>
                    )
                  })}
                  <tr className="bg-green-50 border-b-2 border-surface-200">
                    <td className="px-2 py-2 text-xs font-semibold text-green-800">Totale entrate</td>
                    {cfTotIn.map((v, i) => <td key={i} className="px-2 py-2 text-xs font-semibold text-right text-green-800">{fmtK(v)}</td>)}
                    <td className="px-2 py-2 text-xs font-bold text-right text-green-900">{fmtK(ytdIn)}</td>
                  </tr>

                  <tr><td colSpan={mesiPresenti.length + 2} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 bg-surface-50 border-y border-surface-200">Uscite</td></tr>
                  {usciteTotals.map(({ cat, total }) => {
                    const vals = cfUscite[cat]; const rowMax = maxPerUscita[cat] || maxUscita
                    return (
                      <tr key={cat} className="border-b border-surface-100">
                        <td className="px-2 py-1.5 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => <HeatmapCell key={m} value={vals[m] ?? 0} max={rowMax} isPositive={false} format={fmtK} />)}
                        <HeatmapCell value={total} max={maxUscitaTotal} isPositive={false} format={fmtK} className="px-1 py-1.5 text-right" />
                      </tr>
                    )
                  })}
                  <tr className="bg-red-50 border-b-2 border-surface-200">
                    <td className="px-2 py-2 text-xs font-semibold text-red-800">Totale uscite</td>
                    {cfTotOut.map((v, i) => <td key={i} className="px-2 py-2 text-xs font-semibold text-right text-red-800">{fmtK(v)}</td>)}
                    <td className="px-2 py-2 text-xs font-bold text-right text-red-900">{fmtK(ytdOut)}</td>
                  </tr>

                  {invTotals.length > 0 && <>
                    <tr><td colSpan={mesiPresenti.length + 2} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 bg-surface-50 border-y border-surface-200">Investimenti</td></tr>
                    {invTotals.map(({ cat, total }) => {
                      const vals = cfInv[cat]; const rowMax = maxPerInv[cat] || maxInv
                      return (
                        <tr key={cat} className="border-b border-surface-100">
                          <td className="px-2 py-1.5 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                          {mesiPresenti.map(m => <HeatmapCell key={m} value={vals[m] ?? 0} max={rowMax} isPositive={true} format={fmtK} />)}
                          <HeatmapCell value={total} max={maxInvTotal} isPositive={true} format={fmtK} className="px-1 py-1.5 text-right" />
                        </tr>
                      )
                    })}
                    <tr className="bg-blue-50 border-b-2 border-surface-200">
                      <td className="px-2 py-2 text-xs font-semibold text-blue-800">Totale investimenti</td>
                      {cfTotInv.map((v, i) => <td key={i} className="px-2 py-2 text-xs font-semibold text-right text-blue-800">{fmtK(v)}</td>)}
                      <td className="px-2 py-2 text-xs font-bold text-right text-blue-900">{fmtK(ytdInv)}</td>
                    </tr>
                  </>}

                  <tr className="border-t-2 border-surface-300">
                    <td className="px-2 py-2.5 text-xs font-bold text-gray-800">Risparmio netto</td>
                    {cfRisparmio.map((v, i) => (
                      <td key={i} className={`px-2 py-2.5 text-xs font-bold text-right ${v >= 0 ? 'text-green-800 bg-green-50' : 'text-red-800 bg-red-50'}`}>{fmtK(v)}</td>
                    ))}
                    <td className={`px-2 py-2.5 text-sm font-bold text-right ${ytdRisp >= 0 ? 'text-green-900 bg-green-100' : 'text-red-900 bg-red-100'}`}>{fmtK(ytdRisp)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===== PORTAFOGLIO ===== */}
      {tab === 'portafoglio' && (
        <>
          {portafoglio.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <p className="text-sm text-gray-500">Nessun asset nel portafoglio.</p>
              <p className="text-xs text-gray-400">Compila il foglio "Anagrafica Portafoglio" e risincronizza.</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                <div className="card py-3">
                  <p className="text-xs text-gray-400 mb-1">Valore di carico</p>
                  <p className="text-xl font-semibold text-gray-900">{fmtK(valoreCaricoTotale)}</p>
                </div>
                <div className="card py-3">
                  <p className="text-xs text-gray-400 mb-1">Valore attuale</p>
                  <p className="text-xl font-semibold text-gray-900">
                    {Object.keys(prezziAttuali).length > 0 ? fmtK(valoreAttualeTotale) : <span className="text-gray-300">–</span>}
                  </p>
                </div>
                <div className="card py-3">
                  <p className="text-xs text-gray-400 mb-1">Plus/Minus latente</p>
                  <p className={`text-xl font-semibold ${plusminus >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {Object.keys(prezziAttuali).length > 0 ? fmtK(plusminus) : <span className="text-gray-300">–</span>}
                  </p>
                </div>
                <div className="card py-3">
                  <p className="text-xs text-gray-400 mb-1">Asset</p>
                  <p className="text-xl font-semibold text-gray-900">{portafoglio.length}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Torta allocazione per asset class */}
                <div className="card">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Allocazione per asset class</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={piePortafoglio} dataKey="value" nameKey="name" cx="50%" cy="40%"
                        outerRadius={70} innerRadius={35}
                        label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                        {piePortafoglio.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtK(v)} />
                      <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconSize={10} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Pulsante prezzi attuali */}
                <div className="card flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Prezzi di mercato</p>
                    <p className="text-xs text-gray-400 mb-4">
                      Recupera i prezzi attuali da Yahoo Finance tramite ticker. I prezzi vengono aggiornati solo in sessione (non salvati nel DB).
                    </p>
                    <button onClick={fetchPrezziAttuali} disabled={loadingPrezzi} className="btn-primary text-sm">
                      {loadingPrezzi ? '⟳ Caricamento…' : '↻ Aggiorna prezzi'}
                    </button>
                    {Object.keys(prezziAttuali).length > 0 && (
                      <p className="text-xs text-green-600 mt-2">
                        ✓ {Object.keys(prezziAttuali).length} prezzi aggiornati
                      </p>
                    )}
                  </div>
                  <div className="mt-4 space-y-1">
                    {[...new Set(portafoglio.map(a => a.asset))].map(cls => {
                      const tot = portafoglio.filter(a => a.asset === cls).reduce((s, a) => {
                        const p = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker] : a.prezzo_acquisto
                        return s + p * a.quantita
                      }, 0)
                      const pct = valoreAttualeTotale > 0 ? (tot / valoreAttualeTotale * 100).toFixed(1) : '0'
                      return (
                        <div key={cls} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">{cls}</span>
                          <span className="font-medium">{fmtK(tot)} <span className="text-gray-400">({pct}%)</span></span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Tabella asset */}
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-th">Asset</th>
                        <th className="table-th">Nome / Ticker</th>
                        <th className="table-th">ISIN</th>
                        <th className="table-th w-20 text-right">Qtà</th>
                        <th className="table-th w-28 text-right">P. acquisto</th>
                        <th className="table-th w-28 text-right">P. attuale</th>
                        <th className="table-th w-28 text-right">Valore carico</th>
                        <th className="table-th w-28 text-right">Valore att.</th>
                        <th className="table-th w-24 text-right">+/–</th>
                        <th className="table-th w-10 text-center">PAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portafoglio.map((a, i) => {
                        const prezzoAtt = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker] : null
                        const valCarico = a.prezzo_acquisto * a.quantita
                        const valAtt = prezzoAtt ? prezzoAtt * a.quantita : null
                        const pm = valAtt ? valAtt - valCarico : null
                        const pmPct = pm && valCarico > 0 ? (pm / valCarico * 100).toFixed(1) : null
                        return (
                          <tr key={i} className="hover:bg-surface-50 transition-colors">
                            <td className="table-td"><span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">{a.asset}</span></td>
                            <td className="table-td">
                              <p className="text-xs font-medium text-gray-700 truncate max-w-36">{a.nome || a.descrizione}</p>
                              {a.ticker && <p className="text-xs text-gray-400">{a.ticker}</p>}
                            </td>
                            <td className="table-td text-xs text-gray-400 font-mono">{a.isin || '–'}</td>
                            <td className="table-td text-right text-xs tabular-nums">{a.quantita.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</td>
                            <td className="table-td text-right text-xs tabular-nums">{fmtK(a.prezzo_acquisto)}</td>
                            <td className="table-td text-right text-xs tabular-nums">
                              {prezzoAtt ? fmtK(prezzoAtt) : <span className="text-gray-300">–</span>}
                            </td>
                            <td className="table-td text-right text-xs font-medium tabular-nums">{fmtK(valCarico)}</td>
                            <td className="table-td text-right text-xs font-medium tabular-nums">
                              {valAtt ? fmtK(valAtt) : <span className="text-gray-300">–</span>}
                            </td>
                            <td className={`table-td text-right text-xs font-medium tabular-nums ${pm ? (pm >= 0 ? 'text-green-700' : 'text-red-600') : ''}`}>
                              {pm ? `${pm >= 0 ? '+' : ''}${fmtK(pm)} (${pmPct}%)` : <span className="text-gray-300">–</span>}
                            </td>
                            <td className="table-td text-center text-xs">{a.pac ? '✓' : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
