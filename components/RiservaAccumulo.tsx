'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, AlertSoglia, Liquidita, ContoFlag, statoAttuale, PROFILO_DINAMICO_LABEL } from '@/types'

type QuoteInfo = { price: number; changeFromHigh: number | null; changeFromMonth: number | null }

interface Props {
  portafoglio: AssetPortafoglio[]
  liquidita: Liquidita[]
  soglie: AlertSoglia[]
  prezziAttuali: Record<string, QuoteInfo>
  behaviorLabel: string | null
  ddMax: number
}

function fmtEuro(n: number) {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}

function valoreAttualeAsset(a: AssetPortafoglio, prezzi: Record<string, QuoteInfo>): number {
  const { quantita } = statoAttuale(a)
  const p = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : a.prezzo_acquisto
  return p * quantita
}

// La classificazione azionario/obbligazionario/altro e il flag "svincolato"
// per singolo asset si gestiscono direttamente nella tabella principale del
// portafoglio (colonne "Classe" e "Svincolato"). Qui si gestisce solo lo
// svincolo dei conti di liquidità (non legato a una riga mensile specifica)
// e si mostrano i riepiloghi/suggerimenti calcolati.
export default function RiservaAccumulo({
  portafoglio, liquidita, soglie, prezziAttuali, behaviorLabel, ddMax,
}: Props) {
  const supabase = createClient()
  const [contoFlags, setContoFlags] = useState<ContoFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [savingConto, setSavingConto] = useState<string | null>(null)

  const profiloDinamico = behaviorLabel === PROFILO_DINAMICO_LABEL

  // Ultimo saldo disponibile per ciascun conto (dal mese più recente presente)
  const ultimiSaldiPerConto = useMemo(() => {
    const perConto: Record<string, { mese: string; saldo: number }> = {}
    const ordineMese = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
    liquidita.forEach(l => {
      const attuale = perConto[l.conto]
      if (!attuale || ordineMese.indexOf(l.mese) >= ordineMese.indexOf(attuale.mese)) {
        perConto[l.conto] = { mese: l.mese, saldo: l.saldo }
      }
    })
    return perConto
  }, [liquidita])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data } = await supabase.from('conto_flags').select('*').eq('user_id', user.id)
      setContoFlags((data as ContoFlag[]) ?? [])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isContoSvincolato = (conto: string) => contoFlags.find(c => c.conto === conto)?.svincolata ?? false

  async function toggleContoSvincolato(conto: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingConto(conto)
    const nuovoValore = !isContoSvincolato(conto)
    await supabase.from('conto_flags').upsert(
      { user_id: user.id, conto, svincolata: nuovoValore },
      { onConflict: 'user_id,conto' }
    )
    const { data } = await supabase.from('conto_flags').select('*').eq('user_id', user.id)
    setContoFlags((data as ContoFlag[]) ?? [])
    setSavingConto(null)
  }

  // --- Calcoli aggregati ---
  const riservaAsset = portafoglio
    .filter(a => a.svincolato)
    .reduce((s, a) => s + valoreAttualeAsset(a, prezziAttuali), 0)

  const riservaLiquidita = Object.entries(ultimiSaldiPerConto)
    .filter(([conto]) => isContoSvincolato(conto))
    .reduce((s, [, v]) => s + v.saldo, 0)

  const riservaTotale = riservaAsset + riservaLiquidita

  const valoreAzionario = portafoglio
    .filter(a => a.classe_rischio === 'azionario')
    .reduce((s, a) => s + valoreAttualeAsset(a, prezziAttuali), 0)
  const valoreObbligazionario = portafoglio
    .filter(a => a.classe_rischio === 'obbligazionario')
    .reduce((s, a) => s + valoreAttualeAsset(a, prezziAttuali), 0)
  const totaleClassificato = valoreAzionario + valoreObbligazionario
  const pctAzionario = totaleClassificato > 0 ? (valoreAzionario / totaleClassificato) * 100 : null

  // Asset attualmente in breach, con drawdown associato
  const breachesConDrawdown = soglie
    .filter(s => s.in_breach)
    .map(s => {
      const asset = portafoglio.find(a => a.id === s.portafoglio_id)
      const quote = asset?.ticker ? prezziAttuali[asset.ticker] : undefined
      const drawdown = s.tipo === 'storico' ? quote?.changeFromHigh : quote?.changeFromMonth
      return { soglia: s, asset, drawdown }
    })
    .filter(x => x.asset && x.drawdown != null)

  // Capitale suggerito: proporzionale al drawdown (0% → DD_max), riserva
  // divisa in parti uguali tra le soglie attive in questo momento per non
  // suggerire l'intera riserva più volte in contemporanea.
  const numBreachAttivi = breachesConDrawdown.length || 1
  const suggerimenti = breachesConDrawdown.map(({ soglia, asset, drawdown }) => {
    const ddPct = Math.min(Math.abs(drawdown ?? 0) / 100 / ddMax, 1)
    const importo = (riservaTotale / numBreachAttivi) * ddPct
    return { soglia, asset, importo, drawdown }
  })

  const conti = [...new Set(liquidita.map(l => l.conto))]

  if (loading) return null

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Riserva Accumulo</p>
          <p className="text-xs text-gray-500">Capitale svincolato disponibile per acquisti sui crolli</p>
        </div>
        {conti.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {expanded ? 'Chiudi' : 'Conti liquidità'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-2">
        <div className="rounded-lg bg-surface-50 p-3">
          <p className="text-xs text-gray-500">Capitale disponibile</p>
          <p className="text-lg font-semibold text-gray-900">{fmtEuro(riservaTotale)}</p>
        </div>
        <div className="rounded-lg bg-surface-50 p-3">
          <p className="text-xs text-gray-500">Rapporto azionario / obbligazionario</p>
          <p className="text-lg font-semibold text-gray-900">
            {pctAzionario != null ? `${pctAzionario.toFixed(0)}% / ${(100 - pctAzionario).toFixed(0)}%` : '–'}
          </p>
        </div>
        {!profiloDinamico && (
          <div className="rounded-lg bg-amber-50 p-3 col-span-2 sm:col-span-1">
            <p className="text-xs text-amber-700">
              Suggerimenti di investimento disattivati: profilo non impostato su &quot;accumula sui crolli&quot;.
            </p>
          </div>
        )}
      </div>

      {profiloDinamico && suggerimenti.length > 0 && (
        <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-xs font-semibold text-brand-800 mb-2">Investimento suggerito sulle soglie attive</p>
          <ul className="space-y-1">
            {suggerimenti.map(({ soglia, asset, importo, drawdown }) => (
              <li key={soglia.id} className="text-xs text-brand-800">
                <strong>{asset?.nome || asset?.descrizione || asset?.ticker}</strong>
                {' — '}{drawdown?.toFixed(1)}%: investire circa <strong>{fmtEuro(importo)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {expanded && conti.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Conti di liquidità</p>
          <div className="flex flex-wrap gap-2">
            {conti.map(conto => (
              <button
                key={conto}
                onClick={() => toggleContoSvincolato(conto)}
                disabled={savingConto === conto}
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  isContoSvincolato(conto) ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {conto} · {isContoSvincolato(conto) ? 'Svincolata' : 'Vincolata'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
