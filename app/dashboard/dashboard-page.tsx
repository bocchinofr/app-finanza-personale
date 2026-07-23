'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Movimento, Liquidita, AssetPortafoglio, MESI } from '@/types'
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
function fmtPrice(n: number) {
  return `€${fmt(n)}`
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

// Colori base per la heatmap (min saturazione → max saturazione)
const HEAT_COLORS: Record<'green' | 'red' | 'blue' | 'amber', { light: string; dark: string; textLight: string; textDark: string }> = {
  green: {
    light: '#f0fdf4',   // sfondo chiarissimo (min)
    dark: '#15803d',    // sfondo saturo (max)
    textLight: '#15803d',
    textDark: '#0a3a1c',
  },
  red: {
    light: '#fef2f2',
    dark: '#ff7373',
    textLight: '#b91c1c',
    textDark: '#6b1616',
  },
  blue: {
    light: '#eff6ff',
    dark: '#3e66d2',
    textLight: '#1d4ed8',
    textDark: '#0f2664',
  },
  amber: {
    light: '#fffbeb',   // vicino al massimo → colore quasi assente
    dark: '#b45309',    // molto sotto il massimo → colore pieno
    textLight: '#b45309',
    textDark: '#78350f',
  },
};

// Scostamento (%) dal massimo 52 settimane oltre il quale il badge raggiunge l'intensità massima.
// Modifica questo valore per rendere la scala più o meno sensibile.
const HIGH_DEVIATION_SCALE_MAX = 30

function interpolateColor(color1: string, color2: string, t: number): string {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);
  const r = Math.round(((c1 >> 16) & 0xff) + (((c2 >> 16) & 0xff) - ((c1 >> 16) & 0xff)) * t);
  const g = Math.round(((c1 >> 8) & 0xff) + (((c2 >> 8) & 0xff) - ((c1 >> 8) & 0xff)) * t);
  const b = Math.round((c1 & 0xff) + ((c2 & 0xff) - (c1 & 0xff)) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function HeatCell({ value, max, palette, format }: { 
  value: number; max: number; palette: 'green' | 'red' | 'blue'; format: (n: number) => string 
}) {
  // Ignora valori <= 1
  if (value <= 1) {
    return (
      <td className="text-center p-1">
        <div className="bg-surface-50 text-gray-300 py-2 rounded-lg text-xs">–</div>
      </td>
    );
  }

  const min = 1;
  const clampedMax = Math.max(max, min + 1); // evita divisione per 0 se max <= 1
  const t = (value - min) / (clampedMax - min); // 0 → 1
  const bg = interpolateColor(HEAT_COLORS[palette].light, HEAT_COLORS[palette].dark, Math.min(t, 1));
  const textColor = t > 0.5 ? HEAT_COLORS[palette].textDark : HEAT_COLORS[palette].textLight;

  return (
    <td className="text-center p-1">
      <div
        className="py-2 rounded-lg text-xs transition-transform duration-150 hover:scale-105 hover:shadow-md"
        style={{ backgroundColor: bg, color: textColor, fontWeight: 500 + Math.round(t * 300) }}
      >
        {format(value)}
      </div>
    </td>
  );
}

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
  type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, QuoteInfo>>({})
  const [loadingPrezzi, setLoadingPrezzi] = useState(false)

  // Filters
  const [filterComponente, setFilterComponente] = useState('')
  const [expandedAssetRow, setExpandedAssetRow] = useState<number | null>(null)
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

  // Prezzi attuali via Yahoo Finance, recuperati tramite la nostra API route
  // (la chiamata diretta a Yahoo dal browser viene bloccata da CORS)
  async function fetchPrezziAttuali() {
    const tickers = [...new Set(portafoglio.map(a => a.ticker).filter(Boolean))]
    if (tickers.length === 0) return
    setLoadingPrezzi(true)
    try {
      const res = await fetch(`/api/quote?tickers=${tickers.join(',')}`)
      if (!res.ok) throw new Error(`API prezzi: ${res.status}`)
      const json = await res.json()
      setPrezziAttuali(json)
    } catch (err) {
      console.error('Errore nel recupero dei prezzi', err)
    } finally {
      setLoadingPrezzi(false)
    }
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
  const nMesi = mesiPresenti.length || 1
  const mediaEntrateMensili = ytdIn / nMesi
  const mediaUsciteMensili = ytdOut / nMesi
  const pctInvestitoSuEntrate = ytdIn > 0 ? (ytdInv / ytdIn) * 100 : 0
  const savingRate = ytdIn > 0 ? (ytdRisp / ytdIn) * 100 : 0

  const lineData = mesiPresenti.map((m, i) => ({
    mese: MESI_LABEL[m],
    Entrate: Math.round(cfTotIn[i]),
    Uscite: Math.round(cfTotOut[i]),
    Risparmio: Math.round(cfRisparmio[i]),
    Liquidità: Math.round(liquidita.filter(l => l.mese === m).reduce((s, l) => s + l.saldo, 0)) || undefined,
  }))

  const lineSeries: { key: string; color: string; dash?: boolean }[] = [
    { key: 'Entrate', color: '#22c55e' },
    { key: 'Uscite', color: '#ef4444' },
    { key: 'Risparmio', color: '#3b69d6', dash: true },
    ...(liquidita.length > 0 ? [{ key: 'Liquidità', color: '#8b5cf6' }] : []),
  ]

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
    const prezzoAtt = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : a.prezzo_acquisto
    return s + (prezzoAtt * a.quantita)
  }, 0)
  const plusminus = valoreAttualeTotale - valoreCaricoTotale

  const usaValoreMonetario = valoreCaricoTotale > 0
  const piePortafoglio = assetClasses.map(cls => {
    const assetsInClass = portafoglio.filter(a => a.asset === cls)
    const valore = assetsInClass.reduce((s, a) => {
      const p = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : a.prezzo_acquisto
      return s + p * a.quantita
    }, 0)
    return {
      name: cls,
      value: usaValoreMonetario ? Math.round(valore) : assetsInClass.length,
    }
  }).filter(d => d.value > 0)

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
          {/* Metric cards + liquidità - stile Stitch (icona, valore, badge con metrica reale) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            {[
              {
                label: 'Entrate', val: `€ ${fmt(totalIn)}`, color: 'text-green-700', icon: '↑', iconBg: 'bg-green-100 text-green-700',
                badge: `${(totalIn + totalOut) > 0 ? ((totalIn / (totalIn + totalOut)) * 100).toFixed(0) : 0}% del totale flussi`, badgeBg: 'bg-green-50 text-green-700',
              },
              {
                label: 'Uscite', val: `€ ${fmt(totalOut)}`, color: 'text-red-600', icon: '↓', iconBg: 'bg-red-100 text-red-600',
                badge: `${(totalIn + totalOut) > 0 ? ((totalOut / (totalIn + totalOut)) * 100).toFixed(0) : 0}% del totale flussi`, badgeBg: 'bg-red-50 text-red-600',
              },
              {
                label: 'Saldo', val: `€ ${fmt(saldo)}`, color: saldo >= 0 ? 'text-green-700' : 'text-red-600', icon: '●', iconBg: saldo >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600',
                badge: `Saving rate ${totalIn > 0 ? ((saldo / totalIn) * 100).toFixed(0) : 0}%`, badgeBg: saldo >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600',
              },
              {
                label: 'Movimenti', val: filtered.length.toString(), color: 'text-gray-900', icon: '≡', iconBg: 'bg-gray-100 text-gray-600',
                badge: `${componenti.length || 1} cont${componenti.length === 1 ? 'o' : 'i'}`, badgeBg: 'bg-surface-100 text-gray-600',
              },
            ].map(c => (
              <div key={c.label} className="card p-4 transition-transform hover:scale-[1.01]">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
                  <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${c.iconBg}`}>{c.icon}</span>
                </div>
                <p className={`text-xl font-bold tabular-nums ${c.color}`}>{c.val}</p>
                <div className="mt-2.5">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.badgeBg}`}>{c.badge}</span>
                </div>
              </div>
            ))}

            {/* Liquidità card */}
            <div className="card p-4 transition-transform hover:scale-[1.01] border-blue-100">
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Liquidità {ultimaLiquidita ? `(${MESI_LABEL[ultimaLiquidita.mese]})` : ''}
                </p>
                <span className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold bg-blue-100 text-blue-700">€</span>
              </div>
              {ultimaLiquidita ? (
                <>
                  <p className="text-xl font-bold tabular-nums text-blue-700">{fmtK(ultimaLiquidita.total)}</p>
                  <div className="mt-2.5">
                    {ultimaLiquidita.conti.length > 1 ? (
                      <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {ultimaLiquidita.conti.map(c => `${c.conto}: ${fmtK(c.saldo)}`).join(' · ')}
                      </span>
                    ) : (
                      <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Ultimo saldo registrato</span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xl font-bold tabular-nums text-gray-300">–</p>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            {componenti.length > 0 && (
              <select value={filterComponente} onChange={e => { setFilterComponente(e.target.value); setPage(1) }} className="input w-[calc(50%-0.25rem)] sm:w-36 text-xs py-1.5">
                <option value="">Tutti</option>
                {componenti.map(c => <option key={c}>{c}</option>)}
              </select>
            )}
            <select value={filterMese} onChange={e => { setFilterMese(e.target.value); setPage(1) }} className="input w-[calc(50%-0.25rem)] sm:w-28 text-xs py-1.5">
              <option value="">Tutti i mesi</option>
              {MESI.map(m => <option key={m} value={m}>{MESI_LABEL[m]}</option>)}
            </select>
            <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1) }} className="input w-[calc(50%-0.25rem)] sm:w-44 text-xs py-1.5">
              <option value="">Tutte le categorie</option>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterType} onChange={e => { setFilterType(e.target.value as 'all' | 'in' | 'out'); setPage(1) }} className="input w-[calc(50%-0.25rem)] sm:w-36 text-xs py-1.5">
              <option value="all">Entrate + Uscite</option>
              <option value="in">Solo entrate</option>
              <option value="out">Solo uscite</option>
            </select>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cerca descrizione…" className="input flex-1 min-w-[calc(100%-0.5rem)] sm:min-w-32 text-xs py-1.5" />
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
          {/* KPI Cards - stile Stitch (icona, valore, badge con metrica reale) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Entrate YTD', val: fmtK(ytdIn), color: 'text-green-700', icon: '↑', iconBg: 'bg-green-100 text-green-700', badge: `Media mensile ${fmtK(mediaEntrateMensili)}`, badgeBg: 'bg-green-50 text-green-700' },
              { label: 'Uscite YTD', val: fmtK(ytdOut), color: 'text-red-600', icon: '↓', iconBg: 'bg-red-100 text-red-600', badge: `Media mensile ${fmtK(mediaUsciteMensili)}`, badgeBg: 'bg-red-50 text-red-600' },
              { label: 'Investimenti YTD', val: fmtK(ytdInv), color: 'text-blue-700', icon: '◆', iconBg: 'bg-blue-100 text-blue-700', badge: `${pctInvestitoSuEntrate.toFixed(0)}% delle entrate`, badgeBg: 'bg-blue-50 text-blue-700' },
              { label: 'Risparmio netto YTD', val: fmtK(ytdRisp), color: ytdRisp >= 0 ? 'text-green-700' : 'text-red-600', icon: '●', iconBg: ytdRisp >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600', badge: `Saving rate ${savingRate.toFixed(0)}%`, badgeBg: ytdRisp >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600' },
            ].map(c => (
              <div key={c.label} className="card p-5 transition-transform hover:scale-[1.01]">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
                  <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${c.iconBg}`}>{c.icon}</span>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${c.color}`}>{c.val}</p>
                <div className="mt-3">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.badgeBg}`}>{c.badge}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Bento: barre spese (8 col) + donut distribuzione (4 col) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
            {/* Barre spese - raggruppate per categoria */}
            <div className="card lg:col-span-8">
              <p className="text-sm font-semibold text-gray-900">Spese per categoria (top 5)</p>
              <p className="text-xs text-gray-400 mt-0.5 mb-4">Confronto mensile per categoria di spesa</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" vertical={false} />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtShort(v)} />
                  <Tooltip formatter={(v: number) => fmtK(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {[...topUsciteCats, 'Altre'].map((cat, i) => (
                    <Bar key={cat} dataKey={cat} fill={PIE_COLORS[i % PIE_COLORS.length]} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Torta spese - donut con totale al centro + legenda a lista */}
            <div className="card lg:col-span-4 flex flex-col">
              <p className="text-sm font-semibold text-gray-900">Distribuzione uscite YTD</p>
              <p className="text-xs text-gray-400 mt-0.5 mb-4">Spesa complessiva per categoria</p>
              <div className="relative flex items-center justify-center" style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} innerRadius={55}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtK(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Totale uscite</p>
                  <p className="text-lg font-bold text-gray-900">{fmtK(ytdOut)}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-gray-600">{d.name}</span>
                    </div>
                    <span className="font-semibold text-gray-800">{ytdOut > 0 ? `${((d.value / ytdOut) * 100).toFixed(0)}%` : '–'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Andamento mensile - full width, legenda in header, punti "hollow" */}
          <div className="card mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Andamento mensile</p>
                <p className="text-xs text-gray-400 mt-0.5">Entrate, uscite e risparmio nel tempo</p>
              </div>
              <div className="flex items-center gap-4">
                {lineSeries.map(s => (
                  <span key={s.key} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: s.color }}>
                    <span className="w-3 inline-block" style={{ borderTop: `2px ${s.dash ? 'dashed' : 'solid'} ${s.color}` }} />
                    {s.key}
                  </span>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={lineData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" vertical={false} />
                <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtK(v)} />
                {lineSeries.map(s => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2}
                    strokeDasharray={s.dash ? '4 2' : undefined}
                    dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Liquidità per conto nel tempo */}
          {liquidita.length > 0 && (
            <div className="card mb-6">
              <p className="text-sm font-semibold text-gray-900">Andamento liquidità per conto</p>
              <p className="text-xs text-gray-400 mt-0.5 mb-4">Saldo mensile per conto</p>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" vertical={false} />
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

          {/* Heatmap */}
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">Analisi mensile per categoria</p>
                <p className="text-xs text-gray-400 mt-0.5">Intensità del colore proporzionale al peso della voce nel mese</p>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-semibold text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEAT_COLORS.green.dark }} />Entrate</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEAT_COLORS.red.dark }} />Uscite</span>
                {invTotals.length > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEAT_COLORS.blue.dark }} />Investimenti</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="sticky left-0 z-10 bg-white py-2.5 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 w-40">Voce / Categoria</th>
                    {mesiPresenti.map(m => <th key={m} className="py-2.5 px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400 min-w-[80px]">{MESI_LABEL[m]}</th>)}
                    <th className="py-2.5 px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-600 bg-surface-50 min-w-[100px]">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Entrate */}
                  <tr className="bg-green-50/60">
                    <td colSpan={mesiPresenti.length + 2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-green-700 border-y border-green-100">Entrate</td>
                  </tr>
                  {entrateTotals.map(({ cat, total }) => {
                    const vals = cfEntrate[cat];
                    return (
                      <tr key={cat} className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => <HeatCell key={m} value={vals[m] ?? 0} max={maxEntrata} palette="green" format={fmtK} />)}
                        <td className="py-1.5 px-3 text-right text-xs font-bold bg-surface-50">{fmtK(total)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-green-50 border-b-2 border-surface-200">
                    <td className="sticky left-0 z-10 bg-green-50 py-2 px-3 text-xs font-bold text-green-800">Totale entrate</td>
                    {cfTotIn.map((v, i) => <td key={i} className="py-2 px-2 text-xs font-semibold text-center text-green-800">{fmtK(v)}</td>)}
                    <td className="py-2 px-3 text-xs font-extrabold text-right text-green-900 bg-green-100">{fmtK(ytdIn)}</td>
                  </tr>

                  {/* Uscite */}
                  <tr className="bg-red-50/60">
                    <td colSpan={mesiPresenti.length + 2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-red-700 border-y border-red-100">Uscite</td>
                  </tr>
                  {usciteTotals.map(({ cat, total }) => {
                    const vals = cfUscite[cat];
                    return (
                      <tr key={cat} className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => <HeatCell key={m} value={vals[m] ?? 0} max={maxUscita} palette="red" format={fmtK} />)}
                        <td className="py-1.5 px-3 text-right text-xs font-bold bg-surface-50">{fmtK(total)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-red-50 border-b-2 border-surface-200">
                    <td className="sticky left-0 z-10 bg-red-50 py-2 px-3 text-xs font-bold text-red-800">Totale uscite</td>
                    {cfTotOut.map((v, i) => <td key={i} className="py-2 px-2 text-xs font-semibold text-center text-red-800">{fmtK(v)}</td>)}
                    <td className="py-2 px-3 text-xs font-extrabold text-right text-red-900 bg-red-100">{fmtK(ytdOut)}</td>
                  </tr>

                  {/* Investimenti */}
                  {invTotals.length > 0 && <>
                    <tr className="bg-blue-50/60">
                      <td colSpan={mesiPresenti.length + 2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-blue-700 border-y border-blue-100">Investimenti</td>
                    </tr>
                    {invTotals.map(({ cat, total }) => {
                      const vals = cfInv[cat];
                      return (
                        <tr key={cat} className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                          {mesiPresenti.map(m => <HeatCell key={m} value={vals[m] ?? 0} max={maxInv} palette="blue" format={fmtK} />)}
                          <td className="py-1.5 px-3 text-right text-xs font-bold bg-surface-50">{fmtK(total)}</td>
                        </tr>
                      )
                    })}
                    <tr className="bg-blue-50 border-b-2 border-surface-200">
                      <td className="sticky left-0 z-10 bg-blue-50 py-2 px-3 text-xs font-bold text-blue-800">Totale investimenti</td>
                      {cfTotInv.map((v, i) => <td key={i} className="py-2 px-2 text-xs font-semibold text-center text-blue-800">{fmtK(v)}</td>)}
                      <td className="py-2 px-3 text-xs font-extrabold text-right text-blue-900 bg-blue-100">{fmtK(ytdInv)}</td>
                    </tr>
                  </>}
                </tbody>
                <tfoot>
                  <tr className={`border-t-2 ${ytdRisp >= 0 ? 'border-green-500' : 'border-red-500'}`}>
                    <td className={`sticky left-0 z-10 py-2.5 px-3 text-xs font-bold text-gray-800 ${ytdRisp >= 0 ? 'bg-green-50/50' : 'bg-red-50/50'}`}>Risparmio netto</td>
                    {cfRisparmio.map((v, i) => (
                      <td key={i} className={`py-2.5 px-2 text-xs font-bold text-center ${v >= 0 ? 'text-green-800 bg-green-50/50' : 'text-red-800 bg-red-50/50'}`}>{fmtK(v)}</td>
                    ))}
                    <td className={`py-2.5 px-3 text-sm font-extrabold text-right text-white ${ytdRisp >= 0 ? 'bg-green-600' : 'bg-red-600'}`}>{fmtK(ytdRisp)}</td>
                  </tr>
                </tfoot>
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
              <p className="text-xs text-gray-400">
                {`Compila il foglio "Anagrafica Portafoglio" e risincronizza.`}
              </p>
            </div>
          ) : (
            <>
              {/* Summary cards - stile Stitch (icona, valore, badge con metrica reale) */}
              {(() => {
                const hasPrezzi = Object.keys(prezziAttuali).length > 0
                const pctPlusMinus = valoreCaricoTotale > 0 ? (plusminus / valoreCaricoTotale) * 100 : 0
                const cards = [
                  {
                    label: 'Valore di carico', val: fmtK(valoreCaricoTotale), color: 'text-gray-900', icon: '◆', iconBg: 'bg-blue-100 text-blue-700',
                    badge: `${portafoglio.length} asset`, badgeBg: 'bg-blue-50 text-blue-700',
                  },
                  {
                    label: 'Valore attuale', val: hasPrezzi ? fmtK(valoreAttualeTotale) : '–', color: hasPrezzi ? 'text-gray-900' : 'text-gray-300', icon: '↑', iconBg: 'bg-brand-100 text-brand-700',
                    badge: hasPrezzi ? `${pctPlusMinus >= 0 ? '+' : ''}${pctPlusMinus.toFixed(1)}% vs carico` : 'In attesa di quotazioni', badgeBg: 'bg-surface-100 text-gray-600',
                  },
                  {
                    label: 'Plus/Minus latente', val: hasPrezzi ? fmtK(plusminus) : '–', color: !hasPrezzi ? 'text-gray-300' : plusminus >= 0 ? 'text-green-700' : 'text-red-600',
                    icon: '●', iconBg: !hasPrezzi ? 'bg-gray-100 text-gray-400' : plusminus >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600',
                    badge: hasPrezzi ? `${pctPlusMinus >= 0 ? '+' : ''}${pctPlusMinus.toFixed(1)}% sul capitale` : 'Nessuna quotazione', badgeBg: !hasPrezzi ? 'bg-surface-100 text-gray-600' : plusminus >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600',
                  },
                  {
                    label: 'Asset', val: portafoglio.length.toString(), color: 'text-gray-900', icon: '≡', iconBg: 'bg-gray-100 text-gray-600',
                    badge: `${assetClasses.length || 1} asset class`, badgeBg: 'bg-surface-100 text-gray-600',
                  },
                ]
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    {cards.map(c => (
                      <div key={c.label} className="card p-4 transition-transform hover:scale-[1.01]">
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
                          <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${c.iconBg}`}>{c.icon}</span>
                        </div>
                        <p className={`text-xl font-bold tabular-nums ${c.color}`}>{c.val}</p>
                        <div className="mt-2.5">
                          <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.badgeBg}`}>{c.badge}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                {/* Torta allocazione per asset class */}
                <div className="card">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Allocazione per asset class</p>
                  {!usaValoreMonetario && (
                    <p className="text-[10px] text-gray-400 mb-3">Nessuna quantità inserita: conteggio per numero di asset</p>
                  )}
                  <ResponsiveContainer width="100%" height={usaValoreMonetario ? 240 : 224}>
                    <PieChart>
                      <Pie data={piePortafoglio} dataKey="value" nameKey="name" cx="50%" cy="40%"
                        outerRadius={70} innerRadius={35}
                        label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                        {piePortafoglio.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => usaValoreMonetario ? fmtK(v) : `${v} asset`} />
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
                      const assetsInClass = portafoglio.filter(a => a.asset === cls)
                      const tot = assetsInClass.reduce((s, a) => {
                        const p = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : a.prezzo_acquisto
                        return s + p * a.quantita
                      }, 0)
                      const pct = valoreAttualeTotale > 0 ? (tot / valoreAttualeTotale * 100).toFixed(1) : '0'
                      return (
                        <div key={cls} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">{cls}</span>
                          <span className="font-medium">
                            {usaValoreMonetario
                              ? <>{fmtK(tot)} <span className="text-gray-400">({pct}%)</span></>
                              : <span className="text-gray-400">{assetsInClass.length} asset</span>}
                          </span>
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
                        <th className="table-th w-24 text-center">Da massimo</th>
                        <th className="table-th w-24 text-center">Var. mese</th>
                        <th className="table-th w-28 text-right">Valore carico</th>
                        <th className="table-th w-28 text-right">Valore att.</th>
                        <th className="table-th w-24 text-right">+/–</th>
                        <th className="table-th w-10 text-center">PAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portafoglio.map((a, i) => {
                        const quote = a.ticker ? prezziAttuali[a.ticker] : undefined
                        const prezzoAtt = quote ? quote.price : null
                        const valCarico = a.prezzo_acquisto * a.quantita
                        const valAtt = prezzoAtt ? prezzoAtt * a.quantita : null
                        const pm = valAtt ? valAtt - valCarico : null
                        const pmPct = pm && valCarico > 0 ? (pm / valCarico * 100).toFixed(1) : null
                        const highDev = quote?.changeFromHigh ?? null
                        const highT = highDev != null ? Math.min(Math.abs(highDev) / HIGH_DEVIATION_SCALE_MAX, 1) : 0
                        const highBg = highDev != null ? interpolateColor(HEAT_COLORS.amber.light, HEAT_COLORS.amber.dark, highT) : undefined
                        const highText = highDev != null ? (highT > 0.5 ? HEAT_COLORS.amber.textDark : HEAT_COLORS.amber.textLight) : undefined
                        return (
                          <tr key={i} className="hover:bg-surface-50 transition-colors">
                            <td className="table-td"><span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">{a.asset}</span></td>
                            <td className="table-td">
                              <p
                                className={`text-xs font-medium text-gray-700 cursor-pointer hover:text-brand-600 ${expandedAssetRow === i ? 'whitespace-normal break-words' : 'truncate max-w-36'}`}
                                title={a.nome || a.descrizione}
                                onClick={() => setExpandedAssetRow(expandedAssetRow === i ? null : i)}
                              >
                                {a.nome || a.descrizione}
                              </p>
                              {a.ticker && <p className="text-xs text-gray-400">{a.ticker}</p>}
                            </td>
                            <td className="table-td text-xs text-gray-400 font-mono">{a.isin || '–'}</td>
                            <td className="table-td text-right text-xs tabular-nums">{a.quantita.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</td>
                            <td className="table-td text-right text-xs tabular-nums">{fmtPrice(a.prezzo_acquisto)}</td>
                            <td className="table-td text-right text-xs tabular-nums">
                              {prezzoAtt ? fmtPrice(prezzoAtt) : <span className="text-gray-300">–</span>}
                            </td>
                            <td className="table-td text-center">
                              {quote?.changeFromHigh != null ? (
                                <span
                                  className="inline-block min-w-16 px-2 py-1 rounded-md text-xs font-semibold tabular-nums transition-transform hover:scale-105"
                                  style={{ backgroundColor: highBg, color: highText }}
                                  title="Variazione dal massimo a 52 settimane"
                                >
                                  {quote.changeFromHigh.toFixed(1)}%
                                </span>
                              ) : <span className="text-gray-300 text-xs">–</span>}
                            </td>
                            <td className="table-td text-center">
                              {quote?.changeFromMonth != null ? (
                                <span
                                  className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-xs font-medium tabular-nums ${quote.changeFromMonth >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
                                  title="Variazione rispetto a circa 30 giorni fa"
                                >
                                  {quote.changeFromMonth >= 0 ? '▲' : '▼'} {Math.abs(quote.changeFromMonth).toFixed(1)}%
                                </span>
                              ) : <span className="text-gray-300 text-xs">–</span>}
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