'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { Liquidita, AssetPortafoglio, Movimento, FondoPensione, MESI, statoAttuale } from '@/types'
import { useAnno } from '@/lib/AnnoContext'

const MESI_LABEL: Record<string, string> = {
  gen: 'Gen', feb: 'Feb', mar: 'Mar', apr: 'Apr', mag: 'Mag', giu: 'Giu',
  lug: 'Lug', ago: 'Ago', set: 'Set', ott: 'Ott', nov: 'Nov', dic: 'Dic',
}

// Valore legacy del campo "asset" (grouping) che marcava un asset come fondo
// pensione nel vecchio approccio. Il fondo pensione ora arriva dal foglio
// dedicato, ma teniamo questo filtro per sicurezza: se in portafoglio è
// rimasto un asset con questo tag, non finisce doppio nel capitale investito.
const CATEGORIA_FONDO_PENSIONE_LEGACY = 'Fondo Pensione'

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
  const [fondoPensione, setFondoPensione] = useState<FondoPensione[]>([])
  const [patrimonioStorico, setPatrimonioStorico] = useState<{ mese: string; capitale_investito: number; plus_minus: number }[]>([])
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [liqRes, portRes, movRes, fondoRes, storicoRes] = await Promise.all([
        supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
        supabase.from('portafoglio').select('*').eq('user_id', user.id),
        supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', anno).eq('categoria', 'INVESTIMENTI'),
        supabase.from('fondo_pensione').select('*').eq('user_id', user.id).eq('anno', anno),
        supabase.from('patrimonio_storico').select('mese, capitale_investito, plus_minus').eq('user_id', user.id).eq('anno', anno),
      ])
      if (cancelled) return
      setLiquidita(liqRes.data ?? [])
      setPortafoglio(portRes.data ?? [])
      setMovimenti(movRes.data ?? [])
      setFondoPensione(fondoRes.data ?? [])
      setPatrimonioStorico(storicoRes.data ?? [])
      setLoading(false)

      // Prezzi correnti via proxy Yahoo Finance server-side
      const tickers = (portRes.data ?? [])
        .filter((a: AssetPortafoglio) => statoAttuale(a).quantita > 0)
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
  const mesiConLiquidita = [...new Set(liquidita.map(l => l.mese))]
  const ultimoMeseLiquidita = MESI.filter(m => mesiConLiquidita.includes(m)).pop()
  const liquiditaTotale = liquidita
    .filter(l => l.mese === ultimoMeseLiquidita)
    .reduce((sum, l) => sum + (l.saldo ?? 0), 0)

  // Capitale investito: tutti gli asset in portafoglio (esclusi eventuali residui
  // legacy taggati come fondo pensione), a valore di mercato attuale
  const assetInvestiti = portafoglio.filter(
    a => a.asset !== CATEGORIA_FONDO_PENSIONE_LEGACY && statoAttuale(a).quantita > 0
  )

  function valoreMercato(a: AssetPortafoglio) {
    const { quantita, prezzoCarico } = statoAttuale(a)
    const prezzo = prezziAttuali[a.ticker] ?? prezzoCarico
    return prezzo * quantita
  }
  function valoreCarico(a: AssetPortafoglio) {
    const { quantita, prezzoCarico } = statoAttuale(a)
    return prezzoCarico * quantita
  }

  const capitaleInvestito = assetInvestiti.reduce((sum, a) => sum + valoreMercato(a), 0)
  const carico = assetInvestiti.reduce((sum, a) => sum + valoreCarico(a), 0)
  const plusMinusInvestimenti = capitaleInvestito - carico

  // Fondo pensione: somma saldi/interessi di tutti i fondi nell'ultimo mese valorizzato
  const mesiConFondo = [...new Set(fondoPensione.map(f => f.mese))]
  const ultimoMeseFondo = MESI.filter(m => mesiConFondo.includes(m)).pop()
  const fondoPensioneTotale = fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((sum, f) => sum + (f.saldo ?? 0), 0)
  const fondoPensioneInteressi = fondoPensione
    .filter(f => f.mese === ultimoMeseFondo)
    .reduce((sum, f) => sum + (f.interessi ?? 0), 0)

  // KPI "Plus/minus": somma investimenti (mercato - carico) + interessi fondo pensione
  const plusMinus = plusMinusInvestimenti + fondoPensioneInteressi
  const plusMinusPct = carico > 0 ? (plusMinusInvestimenti / carico) * 100 : 0

  // ===== Storico mensile a pile: Liquidità / Capitale investito / Fondo pensione =====
  // Capitale investito: nessuno storico dei prezzi passati, quindi ricostruiamo il
  // valore "a carico" (versato) cumulato mese per mese dai movimenti INVESTIMENTI:
  //   capitale iniziale (a inizio anno) = valore a carico attuale − versamenti netti dell'anno
  //   valore al mese X = capitale iniziale + versamenti netti cumulati fino a X
  const assetById = new Map(portafoglio.map(a => [a.id, a]))
  const isMovimentoInvestito = (m: Movimento) =>
    m.portafoglio_id != null && assetById.get(m.portafoglio_id)?.asset !== CATEGORIA_FONDO_PENSIONE_LEGACY

  const netFlow = (m: Movimento) => (m.entrate ?? 0) - (m.uscite ?? 0)
  const flowInvestitoAnno = movimenti.filter(isMovimentoInvestito).reduce((s, m) => s + netFlow(m), 0)
  const capitaleInizialeInvestito = carico - flowInvestitoAnno
  let cumInvestito = capitaleInizialeInvestito

  // Mesi da mostrare: fino all'ultimo mese con dati (liquidità, movimenti o fondo
  // pensione), per non proiettare in avanti mesi futuri vuoti
  const mesiConMovimenti = new Set(movimenti.map(m => m.mese))
  const ultimoMeseConDati = MESI.filter(
    m => mesiConLiquidita.includes(m) || mesiConMovimenti.has(m) || mesiConFondo.includes(m)
  ).pop() ?? MESI[0]
  const idxUltimoMese = MESI.indexOf(ultimoMeseConDati)
  const mesiDaMostrare = MESI.slice(0, idxUltimoMese + 1)

  const storicoPerMese = new Map(patrimonioStorico.map(s => [s.mese, s]))

  const storicoData = mesiDaMostrare.map(m => {
    cumInvestito += movimenti.filter(mv => mv.mese === m && isMovimentoInvestito(mv)).reduce((s, mv) => s + netFlow(mv), 0)
    const liquiditaMese = liquidita.filter(l => l.mese === m).reduce((s, l) => s + (l.saldo ?? 0), 0)
    const fondoMese = fondoPensione.filter(f => f.mese === m).reduce((s, f) => s + (f.saldo ?? 0), 0)
    const righeFondoMese = fondoPensione.filter(f => f.mese === m)
    const interessiFondoMese = righeFondoMese.length > 0
      ? righeFondoMese.reduce((s, f) => s + (f.interessi ?? 0), 0)
      : null

    // Se esiste uno snapshot reale per questo mese, ha priorità sulla stima
    // ricostruita dai movimenti (che è a valore versato, non di mercato)
    const snapshot = storicoPerMese.get(m)
    const capitaleInvestitoMese = snapshot ? snapshot.capitale_investito : cumInvestito
    const plusMinusMese = (snapshot ? snapshot.plus_minus : 0) + (interessiFondoMese ?? 0)
    const haValorePlusMinus = snapshot != null || interessiFondoMese != null

    return {
      mese: MESI_LABEL[m],
      'Liquidità': Math.round(liquiditaMese),
      'Capitale investito': Math.round(capitaleInvestitoMese),
      'Fondo pensione': Math.round(fondoMese),
      'Plus/minus': haValorePlusMinus ? Math.round(plusMinusMese) : null,
    }
  })

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <KpiCard label="Liquidità totale" value={fmtEuro(liquiditaTotale)} />
        <KpiCard label="Capitale investito" value={fmtEuro(capitaleInvestito)} sub="Valore di mercato" />
        <KpiCard label="Fondo pensione" value={fmtEuro(fondoPensioneTotale)} />
        <KpiCard
          label="Plus/minus non realizzato"
          value={`${plusMinus >= 0 ? '+' : ''}${fmtEuro(plusMinus)}`}
          sub={`Investimenti ${plusMinusPct >= 0 ? '+' : ''}${plusMinusPct.toFixed(1)}% · include interessi fondo pensione`}
          tone={plusMinus >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="bg-white border border-surface-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-900 mb-1">Andamento patrimonio {anno}</p>
        <p className="text-xs text-gray-400 mb-4">
          Capitale investito: valore di mercato reale dal mese dello snapshot in poi, stima a
          valore versato per i mesi precedenti. Linea plus/minus: idem, più interessi fondo pensione.
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

      {storicoData.length > 0 && (
        <div className="bg-white border border-surface-200 rounded-xl p-4 mt-4 overflow-x-auto">
          <p className="text-sm font-semibold text-gray-900 mb-3">Riepilogo mensile</p>
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide sticky left-0 bg-white">Voce</th>
                {storicoData.map(row => (
                  <th key={row.mese} className="text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">
                    {row.mese}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-1.5 text-gray-700 font-medium sticky left-0 bg-white border-b border-surface-200/50">Liquidità</td>
                {storicoData.map(row => (
                  <td key={row.mese} className="px-3 py-1.5 text-right text-gray-600 border-b border-surface-200/50">
                    {fmtEuro(row['Liquidità'])}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-gray-700 font-medium sticky left-0 bg-white border-b border-surface-200/50">Capitale investito</td>
                {storicoData.map(row => (
                  <td key={row.mese} className="px-3 py-1.5 text-right text-gray-600 border-b border-surface-200/50">
                    {fmtEuro(row['Capitale investito'])}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-gray-700 font-medium sticky left-0 bg-white border-b border-surface-200/50">Fondo pensione</td>
                {storicoData.map(row => (
                  <td key={row.mese} className="px-3 py-1.5 text-right text-gray-600 border-b border-surface-200/50">
                    {fmtEuro(row['Fondo pensione'])}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-gray-900 font-semibold sticky left-0 bg-white border-b border-surface-200/50">Totale</td>
                {storicoData.map(row => (
                  <td key={row.mese} className="px-3 py-1.5 text-right text-gray-900 font-semibold border-b border-surface-200/50">
                    {fmtEuro(row['Liquidità'] + row['Capitale investito'] + row['Fondo pensione'])}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-gray-700 font-medium sticky left-0 bg-white">Plus/minus</td>
                {storicoData.map(row => (
                  <td
                    key={row.mese}
                    className={`px-3 py-1.5 text-right font-medium ${
                      row['Plus/minus'] == null ? 'text-gray-300' : row['Plus/minus'] >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {row['Plus/minus'] == null ? '–' : `${row['Plus/minus'] >= 0 ? '+' : ''}${fmtEuro(row['Plus/minus'])}`}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
