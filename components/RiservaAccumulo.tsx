'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, AlertSoglia, Liquidita, ContoFlag, statoAttuale, PROFILO_DINAMICO_LABEL } from '@/types'
import { calcolaConsigli, type AssetScattato, type TargetAllocazione } from '@/lib/accumuloFormula'
import InfoAccumuloModal from '@/components/InfoAccumuloModal'

type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }

interface Props {
  portafoglio: AssetPortafoglio[]
  liquidita: Liquidita[]
  soglie: AlertSoglia[]
  prezziAttuali: Record<string, QuoteInfo>
  behaviorLabel: string | null
  ddMax: number
  targetAzioni?: number | null
  targetObbligazioni?: number | null
  targetLiquidita?: number | null
  pmcMaxAumento?: number | null // %, es. 2 = max +2% sul PMC
  onSaved?: () => void
}

function fmtEuro(n: number) {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}

function valoreAttualeAsset(a: AssetPortafoglio, prezzi: Record<string, QuoteInfo>): number {
  const { quantita, prezzoCarico } = statoAttuale(a)
  const p = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : prezzoCarico
  return p * quantita
}

// La classificazione azionario/obbligazionario/altro e il flag "svincolato"
// per singolo asset si gestiscono direttamente nella tabella principale del
// portafoglio (colonne "Classe" e "Svincolato"). Qui si gestisce solo lo
// svincolo dei conti di liquidità (non legato a una riga mensile specifica)
// e si mostrano i riepiloghi/suggerimenti calcolati.
export default function RiservaAccumulo({
  portafoglio, liquidita, soglie, prezziAttuali, behaviorLabel, ddMax,
  targetAzioni, targetObbligazioni, targetLiquidita, pmcMaxAumento, onSaved,
}: Props) {
  const supabase = createClient()
  const [contoFlags, setContoFlags] = useState<ContoFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [savingConto, setSavingConto] = useState<string | null>(null)
  const [tAz, setTAz] = useState<string>(targetAzioni != null ? String(targetAzioni) : '')
  const [tOb, setTOb] = useState<string>(targetObbligazioni != null ? String(targetObbligazioni) : '')
  const [tLq, setTLq] = useState<string>(targetLiquidita != null ? String(targetLiquidita) : '')
  const [limPmc, setLimPmc] = useState<string>(pmcMaxAumento != null ? String(pmcMaxAumento) : '')
  const [savingImp, setSavingImp] = useState(false)
  const [msgImp, setMsgImp] = useState<string | null>(null)

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

  // Impostazioni: peso target per classe + limite PMC
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  const sommaTarget = (num(tAz) ?? 0) + (num(tOb) ?? 0) + (num(tLq) ?? 0)
  const targetCompleto = num(tAz) != null && num(tOb) != null && num(tLq) != null
  const target: TargetAllocazione | null = targetCompleto
    ? { azioni: num(tAz) as number, obbligazioni: num(tOb) as number, liquidita: num(tLq) as number }
    : null
  const limitePmc = num(limPmc) != null ? (num(limPmc) as number) / 100 : null

  async function salvaImpostazioni() {
    if (targetCompleto && Math.abs(sommaTarget - 100) > 0.01) {
      setMsgImp('I pesi target devono sommare 100%')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingImp(true)
    setMsgImp(null)
    const { error } = await supabase.from('profili').update({
      target_azioni_pct: num(tAz),
      target_obbligazioni_pct: num(tOb),
      target_liquidita_pct: num(tLq),
      pmc_max_aumento_pct: num(limPmc),
    }).eq('user_id', user.id)
    setSavingImp(false)
    setMsgImp(error ? 'Errore nel salvataggio' : '✓ Salvato')
    if (!error) onSaved?.()
  }

  const liquiditaTotale = Object.values(ultimiSaldiPerConto).reduce((s, v) => s + v.saldo, 0)

  // Consigli: una sola riga per asset scattato con "Accum." attivo (3 passi, vedi accumuloFormula.ts)
  const TIPO_LABEL: Record<string, string> = { storico: 'dal massimo', mensile: 'nel mese', acquisto: 'da acquisto' }
  const idAccumulo = new Set(soglie.filter(s => s.attivo && s.accumulo !== false).map(s => s.portafoglio_id))
  const perAsset = new Map<string, typeof breachesConDrawdown>()
  for (const b of breachesConDrawdown) {
    if (!idAccumulo.has(b.soglia.portafoglio_id)) continue
    perAsset.set(b.soglia.portafoglio_id, [...(perAsset.get(b.soglia.portafoglio_id) ?? []), b])
  }
  const scattati: AssetScattato[] = []
  for (const [id, items] of perAsset.entries()) {
    const { asset, quote } = items[0]
    if (!asset || !quote) continue
    const st = statoAttuale(asset)
    const ribasso = quote.changeFromHigh != null ? Math.max(0, -quote.changeFromHigh) / 100
      : quote.high52 ? Math.max(0, (quote.high52 - quote.price) / quote.high52) : 0
    scattati.push({ id, classe: asset.classe_rischio, prezzo: quote.price, pmc: st.prezzoCarico, quantita: st.quantita, ribassoDalMax: ribasso })
  }
  const consigli = calcolaConsigli({
    riserva: riservaTotale, valoreAzionario, valoreObbligazionario, liquiditaTotale,
    target, ddMax, limitePmc, scattati,
  })
  const suggerimenti = [...perAsset.entries()].map(([id, items]) => ({
    id, asset: items[0].asset as AssetPortafoglio, consiglio: consigli.get(id),
    trigger: items.map(i => ({ tipo: i.soglia.tipo, drawdown: i.drawdown as number })),
  })).filter(x => x.consiglio)

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
            <p className="text-xs font-semibold text-brand-800">Quanto investire ora</p>
            <InfoAccumuloModal ddMax={ddMax} />
          </div>
          <ul className="space-y-2">
            {suggerimenti.map(({ id, asset, consiglio, trigger }) => consiglio && (
              <li key={id} className="text-xs text-brand-800">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    <strong>{asset.nome || asset.descrizione || asset.ticker}</strong>
                    <span className="text-brand-700/70"> · {trigger.map(t => `${t.drawdown.toFixed(1)}% ${TIPO_LABEL[t.tipo] ?? t.tipo}`).join(' · ')}</span>
                  </span>
                  <strong className="text-sm whitespace-nowrap">{fmtEuro(consiglio.importo)}</strong>
                </div>
                <p className="text-[11px] text-brand-700/80 mt-0.5">
                  Budget {fmtEuro(consiglio.budgetClasse)} × {Math.round(consiglio.quota * 100)}% sbloccato dal ribasso
                  {consiglio.limitatoDaPmc
                    ? ` → ridotto per non alzare il PMC oltre +${limitePmc != null ? (limitePmc * 100).toFixed(1) : ''}%`
                    : ''}
                  {consiglio.nuovoPmc != null && ` · PMC ${consiglio.pmcAttuale.toFixed(2)} → ${consiglio.nuovoPmc.toFixed(2)}`}
                </p>
              </li>
            ))}
          </ul>
          {!target && (
            <p className="text-[11px] text-amber-700 mt-2">
              Imposta i pesi target qui sotto: senza, il budget non tiene conto di quanto ogni classe è sotto target.
            </p>
          )}
        </div>
      )}

      <div className="mb-3 rounded-lg border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-700 mb-2">Le tue regole</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Azioni target %', v: tAz, set: setTAz },
            { label: 'Obbligaz. target %', v: tOb, set: setTOb },
            { label: 'Liquidità target %', v: tLq, set: setTLq },
            { label: 'Max aumento PMC %', v: limPmc, set: setLimPmc },
          ].map(f => (
            <label key={f.label} className="text-[11px] text-gray-500">
              {f.label}
              <input
                type="number" inputMode="decimal" min={0} step="0.5" value={f.v}
                onChange={e => f.set(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-900"
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={salvaImpostazioni} disabled={savingImp}
            className="px-3 py-1 rounded-md bg-brand-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {savingImp ? 'Salvo…' : 'Salva'}
          </button>
          {targetCompleto && <span className={`text-[11px] ${Math.abs(sommaTarget - 100) > 0.01 ? 'text-red-600' : 'text-gray-400'}`}>Somma {sommaTarget.toFixed(0)}%</span>}
          {msgImp && <span className="text-[11px] text-gray-500">{msgImp}</span>}
        </div>
      </div>

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
