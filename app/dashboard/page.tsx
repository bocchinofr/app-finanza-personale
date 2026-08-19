'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { Liquidita, AssetPortafoglio, Movimento, MESI } from '@/types'
import { useAnno } from '@/lib/AnnoContext'
import InteressiStoricoForm from '@/components/InteressiStoricoForm'

const MESI_LABEL: Record<string, string> = {
  gen: 'Gen', feb: 'Feb', mar: 'Mar', apr: 'Apr', mag: 'Mag', giu: 'Giu',
  lug: 'Lug', ago: 'Ago', set: 'Set', ott: 'Ott', nov: 'Nov', dic: 'Dic',
}

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
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [interessi, setInteressi] = useState<{ mese: string; asset_id: string | null; valore: number }[]>([])
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, number>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [liqRes, portRes, movRes, intRes] = await Promise.all([
        supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
        supabase.from('portafoglio').select('*').eq('user_id', user.id),
        supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', anno).eq('categoria', 'INVESTIMENTI'),
        supabase.from('interessi_storico').select('mese, asset_id, valore').eq('user_id', user.id).eq('anno', anno),
      ])
      if (cancelled) return
      setLiquidita(liqRes.data ?? [])
      setPortafoglio(portRes.data ?? [])
      setMovimenti(movRes.data ?? [])
      setInteressi(intRes.data ?? [])
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
  }, [anno, refreshKey])

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

  // ===== Storico mensile a pile: Liquidità / Capitale investito / Fondo pensione =====
  // Capitale investito e fondo pensione: nessuno storico dei prezzi passati, quindi
  // ricostruiamo il valore "a carico" (versato) cumulato mese per mese:
  //   capitale iniziale (a inizio anno) = valore a carico attuale − versamenti netti dell'anno
  //   valore al mese X = capitale iniziale + versamenti netti cumulati fino a X
  const assetById = new Map(portafoglio.map(a => [a.id, a]))
  const isMovimentoFondoPensione = (m: Movimento) =>
    m.portafoglio_id != null && assetById.get(m.portafoglio_id)?.asset === CATEGORIA_FONDO_PENSIONE
  const isMovimentoInvestito = (m: Movimento) =>
    m.portafoglio_id != null && assetById.get(m.portafoglio_id)?.asset !== CATEGORIA_FONDO_PENSIONE

  const netFlow = (m: Movimento) => (m.entrate ?? 0) - (m.uscite ?? 0)

  const flowInvestitoAnno = movimenti.filter(isMovimentoInvestito).reduce((s, m) => s + netFlow(m), 0)
  const flowFondoAnno = movimenti.filter(isMovimentoFondoPensione).reduce((s, m) => s + netFlow(m), 0)

  const capitaleInizialeInvestito = carico - flowInvestitoAnno
  const capitaleInizialeFondo = assetFondoPensione.reduce((s, a) => s + valoreCarico(a), 0) - flowFondoAnno

  let cumInvestito = capitaleInizialeInvestito
  let cumFondo = capitaleInizialeFondo

  // Mesi da mostrare: fino all'ultimo mese con dati (liquidità o movimenti), per non
  // proiettare in avanti mesi futuri vuoti
  const mesiConMovimenti = new Set(movimenti.map(m => m.mese))
  const ultimoMeseConDati = MESI.filter(m => mesiConDati.includes(m) || mesiConMovimenti.has(m)).pop() ?? MESI[0]
  const idxUltimoMese = MESI.indexOf(ultimoMeseConDati)
  const mesiDaMostrare = MESI.slice(0, idxUltimoMese + 1)

  const storicoData = mesiDaMostrare.map(m => {
    cumInvestito += movimenti.filter(mv => mv.mese === m && isMovimentoInvestito(mv)).reduce((s, mv) => s + netFlow(mv), 0)
    cumFondo += movimenti.filter(mv => mv.mese === m && isMovimentoFondoPensione(mv)).reduce((s, mv) => s + netFlow(mv), 0)
    const liquiditaMese = liquidita.filter(l => l.mese === m).reduce((s, l) => s + (l.saldo ?? 0), 0)

    // Interessi del mese: se esiste una riga aggregata (asset_id null) si usa quella,
    // altrimenti si sommano le righe per singolo asset. Se non c'è nulla, punto assente.
    const righeMese = interessi.filter(i => i.mese === m)
    const aggregata = righeMese.find(i => i.asset_id === null)
    const perAsset = righeMese.filter(i => i.asset_id !== null)
    const plusMinusMese = aggregata
      ? aggregata.valore
      : perAsset.length > 0
        ? perAsset.reduce((s, i) => s + i.valore, 0)
        : null

    return {
      mese: MESI_LABEL[m],
      'Liquidità': Math.round(liquiditaMese),
      'Capitale investito': Math.round(cumInvestito),
      'Fondo pensione': Math.round(cumFondo),
      'Plus/minus': plusMinusMese != null ? Math.round(plusMinusMese) : null,
    }
  })

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

      <div className="bg-white border border-surface-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-900 mb-1">Andamento patrimonio {anno}</p>
        <p className="text-xs text-gray-400 mb-4">
          Capitale investito e fondo pensione a valore versato (carico), non a valore di mercato storico
        </p>
        {storicoData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dato disponibile per {anno}</p>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={storicoData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmtEuro(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="Liquidità" stackId="patrimonio" fill="#8b5cf6" />
              <Bar yAxisId="left" dataKey="Capitale investito" stackId="patrimonio" fill="#0ea5e9" />
              <Bar yAxisId="left" dataKey="Fondo pensione" stackId="patrimonio" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" dataKey="Plus/minus" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4">
        <InteressiStoricoForm
          anno={anno}
          portafoglio={portafoglio}
          meseCorrente={ultimoMeseConDati}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      </div>
    </div>
  )
}
