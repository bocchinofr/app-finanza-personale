'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { Liquidita, AssetPortafoglio, MESI } from '@/types'
import { useAnno } from '@/lib/AnnoContext'

// Valore del campo "asset" (grouping) che marca un asset come fondo pensione.
// Deve corrispondere esattamente al valore usato nel Google Sheet / tabella portafoglio.
const CATEGORIA_FONDO_PENSIONE = 'Fondo Pensione'

function fmtEuro(n: number) {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function KpiCard({
  label, value, sub, tone = 'neutral',
}: { label: string; value: string; sub?: string; tone?: 'neutral' | 'positive' | 'negative' }) {
  const toneClass =
    tone === 'positive' ? 'text-green-600' :
    tone === 'negative' ? 'text-red-600' :
    'text-gray-900'

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export default function PatrimonioPage() {
  const supabase = createClient()
  const { anno } = useAnno()
  const [loading, setLoading] = useState(true)
  const [liquidita, setLiquidita] = useState<Liquidita[]>([])
  const [portafoglio, setPortafoglio] = useState<AssetPortafoglio[]>([])
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [liqRes, portRes] = await Promise.all([
        supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
        supabase.from('portafoglio').select('*').eq('user_id', user.id),
      ])
      if (cancelled) return
      setLiquidita(liqRes.data ?? [])
      setPortafoglio(portRes.data ?? [])
      setLoading(false)

      // Prezzi correnti via proxy Yahoo Finance server-side
      const tickers = (portRes.data ?? [])
        .filter((a: AssetPortafoglio) => a.quantita_attuale && a.quantita_attuale > 0)
        .map((a: AssetPortafoglio) => a.ticker)
      if (tickers.length > 0) {
        try {
          const res = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(','))}`)
          const json: Record<string, { price: number }> = await res.json()
          if (!cancelled) {
            const prices: Record<string, number> = {}
            for (const [ticker, q] of Object.entries(json)) prices[ticker] = q.price
            setPrezziAttuali(prices)
          }
        } catch {
          // silenzioso: la card mostrerà il valore a prezzo di carico se manca la quotazione
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [anno])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>
  }

  // Liquidità totale: somma saldi di tutti i conti nell'ultimo mese valorizzato dell'anno selezionato
  const mesiConDati = [...new Set(liquidita.map(l => l.mese))]
  const ultimoMese = MESI.filter(m => mesiConDati.includes(m)).pop()
  const liquiditaTotale = liquidita
    .filter(l => l.mese === ultimoMese)
    .reduce((sum, l) => sum + (l.saldo ?? 0), 0)

  // Split portafoglio: fondo pensione vs resto, a valore di mercato (prezzo attuale se disponibile, altrimenti carico)
  const assetInvestiti = portafoglio.filter(a => a.asset !== CATEGORIA_FONDO_PENSIONE && (a.quantita_attuale ?? 0) > 0)
  const assetFondoPensione = portafoglio.filter(a => a.asset === CATEGORIA_FONDO_PENSIONE && (a.quantita_attuale ?? 0) > 0)

  function valoreMercato(a: AssetPortafoglio) {
    const prezzo = prezziAttuali[a.ticker] ?? a.prezzo_carico_attuale ?? 0
    return prezzo * (a.quantita_attuale ?? 0)
  }
  function valoreCarico(a: AssetPortafoglio) {
    return (a.prezzo_carico_attuale ?? 0) * (a.quantita_attuale ?? 0)
  }

  const capitaleInvestito = assetInvestiti.reduce((sum, a) => sum + valoreMercato(a), 0)
  const capitaleFondoPensione = assetFondoPensione.reduce((sum, a) => sum + valoreMercato(a), 0)

  const carico = assetInvestiti.reduce((sum, a) => sum + valoreCarico(a), 0)
  const plusMinus = capitaleInvestito - carico
  const plusMinusPct = carico > 0 ? (plusMinus / carico) * 100 : 0

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <KpiCard label="Liquidità totale" value={fmtEuro(liquiditaTotale)} />
        <KpiCard label="Capitale investito" value={fmtEuro(capitaleInvestito)} sub="Valore di mercato" />
        <KpiCard label="Fondo pensione" value={fmtEuro(capitaleFondoPensione)} />
        <KpiCard
          label="Plus/minus non realizzato"
          value={`${plusMinus >= 0 ? '+' : ''}${fmtEuro(plusMinus)}`}
          sub={`${plusMinusPct >= 0 ? '+' : ''}${plusMinusPct.toFixed(1)}% sul carico`}
          tone={plusMinus >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="bg-white border border-surface-200 rounded-xl p-6 text-sm text-gray-400 text-center">
        Grafico storico patrimonio (a pile) — in arrivo nella Fase 2
      </div>
    </div>
  )
}
