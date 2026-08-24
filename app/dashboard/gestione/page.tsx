'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Movimento, Liquidita, AssetPortafoglio, AlertSoglia, Profilo, MESI, statoAttuale } from '@/types'
import RiservaAccumulo from '@/components/RiservaAccumulo'
import { useAnno } from '@/lib/AnnoContext'
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

// Colori base per la heatmap (min saturazione → max saturazione), allineati al tema Foglio Vivo
const HEAT_COLORS: Record<'green' | 'red' | 'blue' | 'amber', { light: string; dark: string; textLight: string; textDark: string }> = {
  green: {
    light: '#f4f7ef',   // quasi trasparente sulla carta (min)
    dark: '#7ca881',    // verde salvia pieno (max) — brand-700
    textLight: '#3f6b4f',
    textDark: '#162b19',
  },
  red: {
    light: '#faf4f2',
    dark: '#db8474',    // terracotta, coerente con la palette "uscite" scelta nel prototipo
    textLight: '#af4b3a',
    textDark: '#5c2419',
  },
  blue: {
    light: '#eef2f6',
    dark: '#7a9cc7',    // blu ardesia — accent2, usato per gli investimenti
    textLight: '#3c5a82',
    textDark: '#22374f',
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
        className="py-2 rounded-lg text-xs font-mono tabular-nums transition-transform duration-150 hover:scale-105 hover:shadow-md"
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
  const { anno } = useAnno()
  type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, QuoteInfo>>({})
  const [loadingPrezzi, setLoadingPrezzi] = useState(false)
  const [savingSnapshot, setSavingSnapshot] = useState(false)
  const [snapshotSalvato, setSnapshotSalvato] = useState<number | null>(null)
  const [portafoglioStorico, setPortafoglioStorico] = useState<
    { mese: string; portafoglio_id: string; prezzo: number }[]
  >([])

  // Soglie di allerta portafoglio
  const [soglie, setSoglie] = useState<AlertSoglia[]>([])
  const [profilo, setProfilo] = useState<Profilo | null>(null)
  const [showSoglieForm, setShowSoglieForm] = useState(false)
  const [globalSogliaMax, setGlobalSogliaMax] = useState(15)
  const [globalSogliaMese, setGlobalSogliaMese] = useState(10)
  const [draftSoglie, setDraftSoglie] = useState<Record<string, { massimo: number; mensile: number; attivo: boolean }>>({})
  const [savingSoglie, setSavingSoglie] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Filters
  const [filterComponente, setFilterComponente] = useState('')
  const [expandedAssetRow, setExpandedAssetRow] = useState<number | null>(null)
  const [filterMese, setFilterMese] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [anno])

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('mese')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [movRes, liqRes, portRes, sogRes, profRes] = await Promise.all([
      supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', anno),
      supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
      supabase.from('portafoglio').select('*').eq('user_id', user.id),
      supabase.from('alert_soglie').select('*').eq('user_id', user.id),
      supabase.from('profili').select('*').eq('user_id', user.id).single(),
    ])

    setMovimenti((movRes.data as Movimento[]) ?? [])
    setLiquidita((liqRes.data as Liquidita[]) ?? [])
    setPortafoglio((portRes.data as AssetPortafoglio[]) ?? [])
    setSoglie((sogRes.data as AlertSoglia[]) ?? [])
    setProfilo((profRes.data as Profilo) ?? null)
    setLoading(false)
  }, [anno])

  useEffect(() => { loadData() }, [loadData])

  // Inizializza il form soglie con i valori salvati (o i default globali)
  useEffect(() => {
    setDraftSoglie(prev => {
      const next: Record<string, { massimo: number; mensile: number; attivo: boolean }> = {}
      portafoglio.forEach(a => {
        if (!a.id) return
        const sMax = soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'storico')
        const sMese = soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'mensile')
        next[a.id] = prev[a.id] ?? {
          massimo: sMax?.soglia_pct ?? globalSogliaMax,
          mensile: sMese?.soglia_pct ?? globalSogliaMese,
          attivo: sMax?.attivo ?? sMese?.attivo ?? true,
        }
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portafoglio, soglie])

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
      await checkSoglieBreach(json)
    } catch (err) {
      console.error('Errore nel recupero dei prezzi', err)
    } finally {
      setLoadingPrezzi(false)
    }
  }

  // Il bottone registra sempre la chiusura dell'ULTIMO MESE CONCLUSO, non
  // quello in corso: se oggi è il 5 agosto, registra il 31/07 (luglio è
  // l'ultimo mese completo).
  function meseDaRegistrare() {
    const oggi = new Date()
    const meseIdx = oggi.getMonth() // 0=gennaio ... 11=dicembre
    const meseScorsoIdx = meseIdx === 0 ? 11 : meseIdx - 1
    const annoScorso = meseIdx === 0 ? oggi.getFullYear() - 1 : oggi.getFullYear()
    return { mese: MESI[meseScorsoIdx], anno: annoScorso }
  }

  // Salva prezzo/valore/plus-minus di ogni singolo asset per l'ultimo mese
  // concluso, per costruire lo storico prezzi e il rendimento per asset.
  // Riusa i prezzi già in sessione se presenti, altrimenti li recupera ora.
  async function salvaSnapshotFineMese() {
    const tickers = [...new Set(portafoglio.map(a => a.ticker).filter(Boolean))]
    if (tickers.length === 0) return

    setSavingSnapshot(true)
    setSnapshotSalvato(null)
    try {
      let prezzi = prezziAttuali
      if (Object.keys(prezzi).length === 0) {
        const res = await fetch(`/api/quote?tickers=${tickers.join(',')}`)
        if (!res.ok) throw new Error(`API prezzi: ${res.status}`)
        prezzi = await res.json()
        setPrezziAttuali(prezzi)
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { mese: meseTarget, anno: annoTarget } = meseDaRegistrare()

      const righe = portafoglio
        .filter(a => a.id && a.ticker)
        .map(a => {
          const { quantita, prezzoCarico } = statoAttuale(a)
          const prezzo = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : prezzoCarico
          return {
            user_id: user.id,
            anno: annoTarget,
            mese: meseTarget,
            portafoglio_id: a.id!,
            ticker: a.ticker,
            quantita,
            prezzo,
            prezzo_carico: prezzoCarico,
            valore_mercato: prezzo * quantita,
            valore_carico: prezzoCarico * quantita,
            plus_minus: (prezzo - prezzoCarico) * quantita,
          }
        })

      if (righe.length > 0) {
        await supabase.from('portafoglio_storico').delete().eq('user_id', user.id).eq('anno', annoTarget).eq('mese', meseTarget)
        const { error } = await supabase.from('portafoglio_storico').insert(righe)
        if (error) throw error
        setSnapshotSalvato(righe.length)
      }
    } catch (err) {
      console.error('Errore nel salvataggio dello snapshot', err)
    } finally {
      setSavingSnapshot(false)
    }
  }

  useEffect(() => {
    async function loadStoricoPrezzi() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('portafoglio_storico')
        .select('mese, portafoglio_id, prezzo')
        .eq('user_id', user.id)
        .eq('anno', anno)
      setPortafoglioStorico(data ?? [])
    }
    loadStoricoPrezzi()
  }, [anno, snapshotSalvato])

  // Confronta le variazioni appena scaricate con le soglie impostate.
  // Notifica (edge-triggered) solo al passaggio da "non superata" a "superata".
  async function checkSoglieBreach(quotes: Record<string, QuoteInfo>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const updates: { id: string; in_breach: boolean; ultima_notifica_at?: string }[] = []
    const nuoveNotifiche: { user_id: string; portafoglio_id: string; tipo: string; messaggio: string }[] = []

    for (const a of portafoglio) {
      if (!a.id || !a.ticker) continue
      const quote = quotes[a.ticker]
      if (!quote) continue
      const nomeAsset = a.nome || a.descrizione || a.ticker

      const sMax = soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'storico')
      if (sMax?.id && sMax.attivo && quote.changeFromHigh != null) {
        const breach = quote.changeFromHigh <= -sMax.soglia_pct
        if (breach && !sMax.in_breach) {
          updates.push({ id: sMax.id, in_breach: true, ultima_notifica_at: new Date().toISOString() })
          nuoveNotifiche.push({
            user_id: user.id, portafoglio_id: a.id, tipo: 'storico',
            messaggio: `${nomeAsset}: ${quote.changeFromHigh.toFixed(1)}% dal massimo (soglia ${sMax.soglia_pct}%)`,
          })
        } else if (!breach && sMax.in_breach) {
          updates.push({ id: sMax.id, in_breach: false })
        }
      }

      const sMese = soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'mensile')
      if (sMese?.id && sMese.attivo && quote.changeFromMonth != null) {
        const breach = quote.changeFromMonth <= -sMese.soglia_pct
        if (breach && !sMese.in_breach) {
          updates.push({ id: sMese.id, in_breach: true, ultima_notifica_at: new Date().toISOString() })
          nuoveNotifiche.push({
            user_id: user.id, portafoglio_id: a.id, tipo: 'mensile',
            messaggio: `${nomeAsset}: ${quote.changeFromMonth.toFixed(1)}% nel mese (soglia ${sMese.soglia_pct}%)`,
          })
        } else if (!breach && sMese.in_breach) {
          updates.push({ id: sMese.id, in_breach: false })
        }
      }
    }

    if (nuoveNotifiche.length > 0) {
      await supabase.from('notifiche').insert(nuoveNotifiche)
    }
    for (const u of updates) {
      await supabase.from('alert_soglie')
        .update(u.ultima_notifica_at ? { in_breach: u.in_breach, ultima_notifica_at: u.ultima_notifica_at } : { in_breach: u.in_breach })
        .eq('id', u.id)
    }
    if (updates.length > 0) {
      const { data } = await supabase.from('alert_soglie').select('*').eq('user_id', user.id)
      setSoglie((data as AlertSoglia[]) ?? [])
    }
    if (nuoveNotifiche.length > 0) {
      window.dispatchEvent(new Event('notifiche:refresh'))
      setBannerDismissed(false)
    }
  }

  // Applica i due valori globali a tutti gli asset nel form (prima di salvare)
  function applicaSoglieATutti() {
    setDraftSoglie(prev => {
      const next = { ...prev }
      portafoglio.forEach(a => {
        if (!a.id) return
        next[a.id] = { ...(next[a.id] ?? { attivo: true }), massimo: globalSogliaMax, mensile: globalSogliaMese }
      })
      return next
    })
  }

  // Salva le soglie impostate nel form su Supabase (upsert: 2 righe per asset)
  async function saveSoglie() {
    setSavingSoglie(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingSoglie(false); return }

    const rows: Partial<AlertSoglia>[] = []
    portafoglio.forEach(a => {
      if (!a.id) return
      const d = draftSoglie[a.id]
      if (!d) return
      rows.push({ user_id: user.id, portafoglio_id: a.id, tipo: 'storico', soglia_pct: d.massimo, attivo: d.attivo })
      rows.push({ user_id: user.id, portafoglio_id: a.id, tipo: 'mensile', soglia_pct: d.mensile, attivo: d.attivo })
    })

    if (rows.length === 0) {
      console.error('Nessuna riga da salvare: gli asset del portafoglio non hanno un id valido (a.id è undefined). Verifica che la tabella "portafoglio" abbia una colonna "id".')
      alert('Nessun asset valido da salvare: manca l\'id nella tabella portafoglio. Controlla la console per i dettagli.')
      setSavingSoglie(false)
      return
    }

    const { error } = await supabase.from('alert_soglie').upsert(rows, { onConflict: 'user_id,portafoglio_id,tipo' })
    if (error) {
      console.error('Errore salvataggio soglie:', error)
      alert(`Errore salvataggio soglie: ${error.message}`)
    } else {
      const { data, error: reloadError } = await supabase.from('alert_soglie').select('*').eq('user_id', user.id)
      if (reloadError) console.error('Errore ricaricamento soglie:', reloadError)
      setSoglie((data as AlertSoglia[]) ?? [])
    }
    setSavingSoglie(false)
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

  // Ogni riga/categoria ha la propria scala (min→max di quella riga): mette in evidenza le
  // anomalie della singola categoria, anche quando gli importi assoluti sono piccoli.
  // La riga "Totale" ha invece una scala propria calcolata sui totali mensili, per far
  // risaltare i mesi fuori scala sul totale complessivo.
  const maxTotIn  = Math.max(...cfTotIn, 1)
  const maxTotOut = Math.max(...cfTotOut, 1)
  const maxTotInv = Math.max(...cfTotInv, 1)

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
  const valoreCaricoTotale = portafoglio.reduce((s, a) => { const { quantita, prezzoCarico } = statoAttuale(a); return s + prezzoCarico * quantita }, 0)
  const valoreAttualeTotale = portafoglio.reduce((s, a) => {
    const { quantita } = statoAttuale(a)
    const prezzoAtt = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : a.prezzo_acquisto
    return s + (prezzoAtt * quantita)
  }, 0)
  const plusminus = valoreAttualeTotale - valoreCaricoTotale
  const movimentiDaRiconciliare = movimenti.filter(m => m.categoria === 'INVESTIMENTI' && !m.riconciliato).length

  const usaValoreMonetario = valoreCaricoTotale > 0
  const piePortafoglio = assetClasses.map(cls => {
    const assetsInClass = portafoglio.filter(a => a.asset === cls)
    const valore = assetsInClass.reduce((s, a) => {
      const { quantita } = statoAttuale(a)
      const p = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : a.prezzo_acquisto
      return s + p * quantita
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
                <p className={`num-display text-xl font-bold tabular-nums ${c.color}`}>{c.val}</p>
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
                  <p className="num-display text-xl font-bold tabular-nums text-blue-700">{fmtK(ultimaLiquidita.total)}</p>
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
                <p className="num-display text-xl font-bold tabular-nums text-gray-300">–</p>
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
                <p className={`num-display text-2xl font-bold tabular-nums ${c.color}`}>{c.val}</p>
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
              <p className="num-display text-sm font-semibold text-gray-900">Spese per categoria (top 5)</p>
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
              <p className="num-display text-sm font-semibold text-gray-900">Distribuzione uscite YTD</p>
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
                  <p className="num-display text-lg font-bold text-gray-900">{fmtK(ytdOut)}</p>
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
                <p className="num-display text-sm font-semibold text-gray-900">Andamento mensile</p>
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
              <p className="num-display text-sm font-semibold text-gray-900">Andamento liquidità per conto</p>
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
                <p className="num-display text-sm font-semibold text-gray-900">Analisi mensile per categoria</p>
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
                    const rowMax = Math.max(...Object.values(vals), 1);
                    return (
                      <tr key={cat} className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => <HeatCell key={m} value={vals[m] ?? 0} max={rowMax} palette="green" format={fmtK} />)}
                        <td className="py-1.5 px-3 text-right text-xs font-bold bg-surface-50">{fmtK(total)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-b-2 border-surface-200">
                    <td className="sticky left-0 z-10 bg-green-50 py-2 px-3 text-xs font-bold text-green-800">Totale entrate</td>
                    {cfTotIn.map((v, i) => <HeatCell key={i} value={v} max={maxTotIn} palette="green" format={fmtK} />)}
                    <td className="py-2 px-3 text-xs font-extrabold text-right text-green-900 bg-green-100">{fmtK(ytdIn)}</td>
                  </tr>

                  {/* Uscite */}
                  <tr className="bg-red-50/60">
                    <td colSpan={mesiPresenti.length + 2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-red-700 border-y border-red-100">Uscite</td>
                  </tr>
                  {usciteTotals.map(({ cat, total }) => {
                    const vals = cfUscite[cat];
                    const rowMax = Math.max(...Object.values(vals), 1);
                    return (
                      <tr key={cat} className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                        {mesiPresenti.map(m => <HeatCell key={m} value={vals[m] ?? 0} max={rowMax} palette="red" format={fmtK} />)}
                        <td className="py-1.5 px-3 text-right text-xs font-bold bg-surface-50">{fmtK(total)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-b-2 border-surface-200">
                    <td className="sticky left-0 z-10 bg-red-50 py-2 px-3 text-xs font-bold text-red-800">Totale uscite</td>
                    {cfTotOut.map((v, i) => <HeatCell key={i} value={v} max={maxTotOut} palette="red" format={fmtK} />)}
                    <td className="py-2 px-3 text-xs font-extrabold text-right text-red-900 bg-red-100">{fmtK(ytdOut)}</td>
                  </tr>

                  {/* Investimenti */}
                  {invTotals.length > 0 && <>
                    <tr className="bg-blue-50/60">
                      <td colSpan={mesiPresenti.length + 2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-blue-700 border-y border-blue-100">Investimenti</td>
                    </tr>
                    {invTotals.map(({ cat, total }) => {
                      const vals = cfInv[cat];
                      const rowMax = Math.max(...Object.values(vals), 1);
                      return (
                        <tr key={cat} className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
                          {mesiPresenti.map(m => <HeatCell key={m} value={vals[m] ?? 0} max={rowMax} palette="blue" format={fmtK} />)}
                          <td className="py-1.5 px-3 text-right text-xs font-bold bg-surface-50">{fmtK(total)}</td>
                        </tr>
                      )
                    })}
                    <tr className="border-b-2 border-surface-200">
                      <td className="sticky left-0 z-10 bg-blue-50 py-2 px-3 text-xs font-bold text-blue-800">Totale investimenti</td>
                      {cfTotInv.map((v, i) => <HeatCell key={i} value={v} max={maxTotInv} palette="blue" format={fmtK} />)}
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
          {movimentiDaRiconciliare > 0 && (
            <a
              href="/dashboard/riconciliazione"
              className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors"
            >
              <span className="text-sm text-amber-800">
                <strong>{movimentiDaRiconciliare}</strong> movimento/i ETF da riconciliare con il portafoglio
              </span>
              <span className="text-xs font-medium text-amber-700">Vai alla riconciliazione →</span>
            </a>
          )}
          {portafoglio.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <p className="text-sm text-gray-500">Nessun asset nel portafoglio.</p>
              <p className="text-xs text-gray-400">
                {`Compila il foglio "Anagrafica Portafoglio" e risincronizza.`}
              </p>
            </div>
          ) : (
            <>
              {/* Banner soglie superate */}
              {(() => {
                const breaches = soglie.filter(s => s.in_breach)
                if (breaches.length === 0 || bannerDismissed) return null
                return (
                  <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 relative">
                    <button
                      onClick={() => setBannerDismissed(true)}
                      aria-label="Chiudi avviso"
                      className="absolute top-3 right-3 text-red-400 hover:text-red-600 text-sm leading-none"
                    >
                      ✕
                    </button>
                    <p className="text-sm font-semibold text-red-700 mb-2 pr-6">⚠ {breaches.length} soglia/e superata/e</p>
                    <ul className="space-y-1">
                      {breaches.map(s => {
                        const asset = portafoglio.find(a => a.id === s.portafoglio_id)
                        const quote = asset?.ticker ? prezziAttuali[asset.ticker] : undefined
                        const dev = s.tipo === 'storico' ? quote?.changeFromHigh : quote?.changeFromMonth
                        return (
                          <li key={s.id} className="text-xs text-red-700">
                            <strong>{asset?.nome || asset?.descrizione || asset?.ticker}</strong>
                            {' — '}{s.tipo === 'storico' ? 'dal massimo' : 'nel mese'}: {dev != null ? `${dev.toFixed(1)}%` : '–'} (soglia {s.soglia_pct}%)
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })()}

              <RiservaAccumulo
                portafoglio={portafoglio}
                liquidita={liquidita}
                soglie={soglie}
                prezziAttuali={prezziAttuali}
                behaviorLabel={profilo?.behavior_label ?? null}
                ddMax={profilo?.dd_max ?? 0.30}
              />

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
                        <p className={`num-display text-xl font-bold tabular-nums ${c.color}`}>{c.val}</p>
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
                    <button
                      onClick={salvaSnapshotFineMese}
                      disabled={savingSnapshot}
                      className="btn-primary text-sm mt-2"
                    >
                      {savingSnapshot
                        ? '⟳ Salvataggio…'
                        : `💾 Registra chiusura ${MESI_LABEL[meseDaRegistrare().mese]}`}
                    </button>
                    {snapshotSalvato != null && (
                      <p className="text-xs text-green-600 mt-2">
                        ✓ Snapshot salvato per {snapshotSalvato} asset
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

              <div className="card overflow-x-auto mt-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Storico prezzi mensili {anno}
                </p>
                {(() => {
                  const assetAttiviStorico = portafoglio.filter(a => a.id && a.ticker)

                  const prezziPerAsset = new Map<string, Record<string, number>>()
                  for (const r of portafoglioStorico) {
                    if (!prezziPerAsset.has(r.portafoglio_id)) prezziPerAsset.set(r.portafoglio_id, {})
                    prezziPerAsset.get(r.portafoglio_id)![r.mese] = r.prezzo
                  }

                  let maxAbsPct = 0
                  const variazioniPerAsset = new Map<string, Record<string, number | null>>()
                  for (const a of assetAttiviStorico) {
                    if (!a.id) continue
                    const prezzi = prezziPerAsset.get(a.id) ?? {}
                    const rowVar: Record<string, number | null> = {}
                    let prezzoPrec: number | null = null
                    for (const m of MESI) {
                      const p = prezzi[m]
                      if (p != null && prezzoPrec != null && prezzoPrec !== 0) {
                        const pct = ((p - prezzoPrec) / prezzoPrec) * 100
                        rowVar[m] = pct
                        maxAbsPct = Math.max(maxAbsPct, Math.abs(pct))
                      } else {
                        rowVar[m] = null
                      }
                      if (p != null) prezzoPrec = p
                    }
                    variazioniPerAsset.set(a.id, rowVar)
                  }

                  if (assetAttiviStorico.length === 0) {
                    return <p className="text-xs text-gray-400">Nessun asset attivo in portafoglio.</p>
                  }

                  return (
                    <table className="min-w-full text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide sticky left-0 bg-white">
                            Asset
                          </th>
                          {MESI.map(m => (
                            <th key={m} className="text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">
                              {MESI_LABEL[m]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {assetAttiviStorico.map(a => {
                          if (!a.id) return null
                          const prezzi = prezziPerAsset.get(a.id) ?? {}
                          const rowVar = variazioniPerAsset.get(a.id) ?? {}
                          return (
                            <tr key={a.id}>
                              <td className="px-3 py-1.5 text-gray-700 font-medium sticky left-0 bg-white whitespace-nowrap border-b border-surface-200/50">
                                {a.nome || a.ticker}
                              </td>
                              {MESI.map(m => {
                                const prezzo = prezzi[m]
                                if (prezzo == null) {
                                  return (
                                    <td key={m} className="px-3 py-1.5 text-right text-gray-300 border-b border-surface-200/50">
                                      –
                                    </td>
                                  )
                                }
                                const pct = rowVar[m] ?? 0
                                return (
                                  <HeatmapCell
                                    key={m}
                                    value={Math.abs(pct)}
                                    max={maxAbsPct}
                                    isPositive={pct >= 0}
                                    format={() =>
                                      `€${prezzo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    }
                                  />
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
              </div>

              {/* Tabella asset con gestione soglie integrata */}
              <div className="card p-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Portafoglio</p>
                  {!showSoglieForm ? (
                    <button onClick={() => setShowSoglieForm(true)} className="text-xs text-brand-600 font-medium">
                      ✎ Modifica soglie
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowSoglieForm(false)} className="text-xs text-gray-400 font-medium">
                        Annulla
                      </button>
                      <button onClick={async () => { await saveSoglie(); setShowSoglieForm(false) }} disabled={savingSoglie} className="btn-primary text-xs">
                        {savingSoglie ? 'Salvataggio…' : 'Salva soglie'}
                      </button>
                    </div>
                  )}
                </div>

                {showSoglieForm && (
                  <div className="mx-4 mt-3 flex flex-wrap items-end gap-3 p-3 bg-surface-50 rounded-lg">
                    <p className="text-[10px] text-gray-400 w-full">
                      Notifica in app quando lo scostamento dal massimo o dal mese scende sotto la soglia (es. 10% → notifica a -10% o peggio). Le percentuali si intendono sempre come ribasso.
                    </p>
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-1">Soglia da massimo (%)</label>
                      <input type="number" min={0} step={0.5} value={globalSogliaMax}
                        onChange={e => setGlobalSogliaMax(Number(e.target.value))} className="input w-24 text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-1">Soglia mensile (%)</label>
                      <input type="number" min={0} step={0.5} value={globalSogliaMese}
                        onChange={e => setGlobalSogliaMese(Number(e.target.value))} className="input w-24 text-sm" />
                    </div>
                    <button onClick={applicaSoglieATutti} className="btn-secondary text-xs">Applica a tutti gli asset</button>
                  </div>
                )}

                <div className="overflow-x-auto mt-3">
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
                        <th className="table-th w-14 px-1 text-center" title="Soglia di scostamento dal massimo storico">Max %</th>
                        <th className="table-th w-14 px-1 text-center" title="Soglia di scostamento dal massimo mensile">Mese %</th>
                        <th className="table-th w-28 text-center">Classe</th>
                        <th className="table-th w-24 text-center">Svincolato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portafoglio.map((a, i) => {
                        const { quantita: qtaAttuale, prezzoCarico } = statoAttuale(a)
                        const quote = a.ticker ? prezziAttuali[a.ticker] : undefined
                        const prezzoAtt = quote ? quote.price : null
                        const valCarico = prezzoCarico * qtaAttuale
                        const valAtt = prezzoAtt ? prezzoAtt * qtaAttuale : null
                        const pm = valAtt ? valAtt - valCarico : null
                        const pmPct = pm && valCarico > 0 ? (pm / valCarico * 100).toFixed(1) : null
                        const highDev = quote?.changeFromHigh ?? null
                        const highT = highDev != null ? Math.min(Math.abs(highDev) / HIGH_DEVIATION_SCALE_MAX, 1) : 0
                        const highBg = highDev != null ? interpolateColor(HEAT_COLORS.amber.light, HEAT_COLORS.amber.dark, highT) : undefined
                        const highText = highDev != null ? (highT > 0.5 ? HEAT_COLORS.amber.textDark : HEAT_COLORS.amber.textLight) : undefined
                        const dSoglia = a.id ? draftSoglie[a.id] : undefined
                        const sMaxSaved = a.id ? soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'storico') : undefined
                        const sMeseSaved = a.id ? soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'mensile') : undefined
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
                            <td className="table-td text-right text-xs tabular-nums">{qtaAttuale.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</td>
                            <td className="table-td text-right text-xs tabular-nums">{fmtPrice(prezzoCarico)}</td>
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
                            <td className="table-td text-center px-1">
                              {showSoglieForm && a.id ? (
                                <div className="flex items-center justify-center gap-1">
                                  <input type="number" min={0} step={0.5}
                                    value={dSoglia?.massimo ?? globalSogliaMax}
                                    onChange={e => setDraftSoglie(prev => ({ ...prev, [a.id!]: { ...(prev[a.id!] ?? { massimo: globalSogliaMax, mensile: globalSogliaMese, attivo: true }), massimo: Number(e.target.value) } }))}
                                    className="w-11 border border-surface-200 rounded-md px-1 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                                  <input type="checkbox" title="Soglia attiva" checked={dSoglia?.attivo ?? true}
                                    onChange={e => setDraftSoglie(prev => ({ ...prev, [a.id!]: { ...(prev[a.id!] ?? { massimo: globalSogliaMax, mensile: globalSogliaMese, attivo: true }), attivo: e.target.checked } }))} />
                                </div>
                              ) : (
                                <span className="text-xs tabular-nums text-gray-500">
                                  {sMaxSaved && sMaxSaved.attivo ? `${sMaxSaved.soglia_pct}%` : <span className="text-gray-300">–</span>}
                                </span>
                              )}
                            </td>
                            <td className="table-td text-center px-1">
                              {showSoglieForm && a.id ? (
                                <input type="number" min={0} step={0.5}
                                  value={dSoglia?.mensile ?? globalSogliaMese}
                                  onChange={e => setDraftSoglie(prev => ({ ...prev, [a.id!]: { ...(prev[a.id!] ?? { massimo: globalSogliaMax, mensile: globalSogliaMese, attivo: true }), mensile: Number(e.target.value) } }))}
                                  className="w-11 border border-surface-200 rounded-md px-1 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                              ) : (
                                <span className="text-xs tabular-nums text-gray-500">
                                  {sMeseSaved && sMeseSaved.attivo ? `${sMeseSaved.soglia_pct}%` : <span className="text-gray-300">–</span>}
                                </span>
                              )}
                            </td>
                            <td className="table-td text-center px-1">
                              <select
                                value={a.classe_rischio ?? ''}
                                onChange={async e => {
                                  if (!a.id) return
                                  const val = e.target.value as 'azionario' | 'obbligazionario' | 'altro' | ''
                                  await supabase.from('portafoglio').update({ classe_rischio: val || null }).eq('id', a.id)
                                  loadData()
                                }}
                                className="rounded-md border border-surface-200 text-xs py-1 px-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
                              >
                                <option value="">–</option>
                                <option value="azionario">Azionario</option>
                                <option value="obbligazionario">Obbligazionario</option>
                                <option value="altro">Altro</option>
                              </select>
                            </td>
                            <td className="table-td text-center">
                              <button
                                onClick={async () => {
                                  if (!a.id) return
                                  await supabase.from('portafoglio').update({ svincolato: !a.svincolato }).eq('id', a.id)
                                  loadData()
                                }}
                                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                                  a.svincolato ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {a.svincolato ? 'Sì' : 'No'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="h-4" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
