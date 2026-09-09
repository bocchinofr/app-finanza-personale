'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, AlertSoglia, Liquidita, ContoFlag, statoAttuale, PROFILO_DINAMICO_LABEL } from '@/types'
import { calcolaBudgetPerAsset, calcolaImportoConsigliato } from '@/lib/accumuloFormula'
import InfoAccumuloModal from '@/components/InfoAccumuloModal'

type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }

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
  const [expanded, setExpanded] = useState(true)
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
      return { soglia: s, asset, quote, drawdown }
    })
    .filter(x => x.asset && x.drawdown != null)

  // Budget per asset: la riserva è divisa tra tutti gli asset con almeno una
  // soglia attiva, pesando per l'aggressività della soglia più bassa impostata
  // (soglia più bassa = si vuole iniziare ad accumulare prima = fetta maggiore).
  const budgetPerAsset = useMemo(() => {
    const sogliePerAsset = new Map<string, number[]>()
    for (const s of soglie) {
      if (!s.attivo) continue
      const arr = sogliePerAsset.get(s.portafoglio_id) ?? []
      arr.push(s.soglia_pct)
      sogliePerAsset.set(s.portafoglio_id, arr)
    }
    return calcolaBudgetPerAsset(riservaTotale, sogliePerAsset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soglie, riservaTotale])

  // Importo consigliato: rampa lineare dal massimo al PMC, poi accelerazione
  // convessa sotto il PMC (stessa formula usata nelle email di alert).
  const suggerimenti = breachesConDrawdown
    .map(({ soglia, asset, quote, drawdown }) => {
      const budgetAsset = budgetPerAsset.get(soglia.portafoglio_id) ?? 0
      if (!asset || !quote?.high52 || budgetAsset <= 0) return null
      const importo = calcolaImportoConsigliato({
        prezzoAttuale: quote.price,
        prezzoMassimo: quote.high52,
        pmc: asset.prezzo_acquisto,
        budgetAsset,
        ddMaxSottoPmc: ddMax,
      })
      return { soglia, asset, importo, drawdown }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)

  const conti = [...new Set(liquidita.map(l => l.conto))]

  if (loading) return null

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Riserva Accumulo</p>
          <p className="text-xs text-gray-500">Utilizzare la sezione per vedere e definire il capitale svincolato, ovvero quel capitale da utilizzare come riserva di accumulo durante i crolli di mercato.</p>
          <p className="text-xs text-gray-500">Gli asset utilizzabili come riserva sono stati definiti nel file sincronizzato</p>
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
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-xs font-semibold text-brand-800">Investimento suggerito sulle soglie attive</p>
            <InfoAccumuloModal ddMax={ddMax} />
          </div>
          <ul className="space-y-1">
            {suggerimenti.map(({ soglia, asset, importo, drawdown }) => (
              <li key={soglia.id} className="text-xs text-brand-800">
                <strong>{asset?.nome || asset?.descrizione || asset?.ticker}</strong>
                {' — '}{drawdown?.toFixed(1)}%: investire circa <strong>{fmtEuro(importo)}</strong>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-brand-700/70 mt-2">
            Budget diviso tra gli asset con soglia attiva in base all&apos;aggressività della soglia; l&apos;importo cresce mano a mano che il prezzo scende verso il PMC e accelera sotto il PMC.
          </p>
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
