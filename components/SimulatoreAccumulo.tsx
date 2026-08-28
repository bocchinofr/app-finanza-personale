'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, Liquidita, ContoFlag, statoAttuale } from '@/types'

type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }

interface Props {
  portafoglio: AssetPortafoglio[]
  liquidita: Liquidita[]
  prezziAttuali: Record<string, QuoteInfo>
  ddMax: number
}

type Modalita = 'fisso' | 'variabile'

interface StepRow {
  step: number
  drawdownPct: number
  importoStep: number
  cumInvestito: number
  riservaResidua: number
  // Solo modalità asset singolo (prezzo reale disponibile)
  prezzo?: number
  cumQuantita?: number
  prezzoMedioCarico?: number
  // Solo modalità aggregato (nessun prezzo reale: puro calcolo % di recupero)
  valoreRecuperoStep?: number
  cumValoreRecupero?: number
}

function fmtEuro(n: number) {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}

function valoreAttualeAsset(a: AssetPortafoglio, prezzi: Record<string, QuoteInfo>): number {
  const { quantita } = statoAttuale(a)
  const p = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : a.prezzo_acquisto
  return p * quantita
}

export default function SimulatoreAccumulo({ portafoglio, liquidita, prezziAttuali, ddMax }: Props) {
  const supabase = createClient()
  const [contoFlags, setContoFlags] = useState<ContoFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

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

  const isContoSvincolato = (conto: string) => contoFlags.find(c => c.conto === conto)?.svincolata ?? false

  const riservaTotale = useMemo(() => {
    const riservaAsset = portafoglio.filter(a => a.svincolato).reduce((s, a) => s + valoreAttualeAsset(a, prezziAttuali), 0)
    const riservaLiquidita = Object.entries(ultimiSaldiPerConto)
      .filter(([conto]) => isContoSvincolato(conto))
      .reduce((s, [, v]) => s + v.saldo, 0)
    return riservaAsset + riservaLiquidita
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portafoglio, prezziAttuali, ultimiSaldiPerConto, contoFlags])

  const assetConTicker = portafoglio.filter(a => a.ticker)

  // --- Parametri simulazione ---
  const [assetId, setAssetId] = useState<string>('aggregato')
  const [stepPct, setStepPct] = useState<number>(5)
  const [modalita, setModalita] = useState<Modalita>('variabile')
  const [importoFisso, setImportoFisso] = useState<number>(500)
  const [prezzoMassimo, setPrezzoMassimo] = useState<number | null>(null)
  const [prezzoModificatoManualmente, setPrezzoModificatoManualmente] = useState(false)
  const [risultato, setRisultato] = useState<{ rows: StepRow[]; esaurita: boolean } | null>(null)

  const assetSelezionato = assetId !== 'aggregato' ? portafoglio.find(a => a.id === assetId) : null

  // Precompila il prezzo massimo di riferimento. Riparte da zero (non "manuale")
  // quando l'utente cambia asset; nel frattempo si aggiorna anche se i prezzi
  // dal parent arrivano dopo il mount, finché l'utente non lo modifica a mano.
  useEffect(() => {
    setPrezzoModificatoManualmente(false)
  }, [assetId])

  useEffect(() => {
    if (prezzoModificatoManualmente) return
    if (assetSelezionato?.ticker && prezziAttuali[assetSelezionato.ticker]?.high52) {
      setPrezzoMassimo(prezziAttuali[assetSelezionato.ticker].high52)
    } else if (assetSelezionato) {
      setPrezzoMassimo(assetSelezionato.prezzo_acquisto)
    } else {
      setPrezzoMassimo(null) // aggregato: non serve, si lavora in %
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, prezziAttuali, portafoglio, prezzoModificatoManualmente])

  const isAggregato = assetId === 'aggregato'

  function simula() {
    if (riservaTotale <= 0) { setRisultato(null); return }
    if (!isAggregato && (!prezzoMassimo || prezzoMassimo <= 0)) { setRisultato(null); return }

    const rows: StepRow[] = []
    let cumInvestito = 0
    let cumQuantita = 0
    let cumValoreRecupero = 0
    let esaurita = false
    const MAX_STEP = 60
    const CAP_DRAWDOWN = 0.9 // sicurezza: non simulare oltre -90% dal massimo

    for (let i = 1; i <= MAX_STEP; i++) {
      const drawdown = Math.min((i * stepPct) / 100, CAP_DRAWDOWN)

      let importoStep: number
      if (modalita === 'fisso') {
        importoStep = Math.min(importoFisso, Math.max(riservaTotale - cumInvestito, 0))
      } else {
        // Variabile: la riserva si deploya linearmente dal drawdown 0 a ddMax.
        const targetCumulato = riservaTotale * Math.min(drawdown / ddMax, 1)
        importoStep = Math.max(targetCumulato - cumInvestito, 0)
      }

      if (importoStep <= 0) { esaurita = true; break }

      cumInvestito += importoStep

      if (isAggregato) {
        // Nessun prezzo reale: se il mercato recupera al livello di partenza,
        // un importo investito a drawdown D vale importo / (1 - D).
        const valoreRecuperoStep = importoStep / (1 - drawdown)
        cumValoreRecupero += valoreRecuperoStep
        rows.push({
          step: i,
          drawdownPct: drawdown * 100,
          importoStep,
          cumInvestito,
          valoreRecuperoStep,
          cumValoreRecupero,
          riservaResidua: Math.max(riservaTotale - cumInvestito, 0),
        })
      } else {
        const prezzo = (prezzoMassimo as number) * (1 - drawdown)
        const quantitaStep = importoStep / prezzo
        cumQuantita += quantitaStep
        rows.push({
          step: i,
          drawdownPct: drawdown * 100,
          prezzo,
          importoStep,
          cumInvestito,
          cumQuantita,
          prezzoMedioCarico: cumInvestito / cumQuantita,
          riservaResidua: Math.max(riservaTotale - cumInvestito, 0),
        })
      }

      if (cumInvestito >= riservaTotale - 0.5) { esaurita = true; break }
      if (drawdown >= CAP_DRAWDOWN) break
    }

    setRisultato({ rows, esaurita })
  }

  if (loading) return null

  const ultimoStep = risultato?.rows[risultato.rows.length - 1]
  const valoreAlRecupero = ultimoStep
    ? (isAggregato ? ultimoStep.cumValoreRecupero : (ultimoStep.cumQuantita ?? 0) * (prezzoMassimo ?? 0))
    : null
  const pnlRecupero = ultimoStep && valoreAlRecupero != null ? valoreAlRecupero - ultimoStep.cumInvestito : null
  const pnlRecuperoPct = pnlRecupero != null && ultimoStep && ultimoStep.cumInvestito > 0
    ? (pnlRecupero / ultimoStep.cumInvestito) * 100
    : null

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Simulatore Accumulo</p>
          <p className="text-xs text-gray-500">Cosa succede se il prezzo scende e continuo a comprare</p>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          {expanded ? 'Chiudi' : 'Apri simulazione'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4">
          {/* Parametri */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Asset</label>
              <select
                value={assetId}
                onChange={e => setAssetId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
              >
                <option value="aggregato">Aggregato (riserva totale)</option>
                {assetConTicker.map(a => (
                  <option key={a.id} value={a.id}>{a.nome || a.descrizione || a.ticker}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Step discesa (%)</label>
              <input
                type="number" min={1} max={50} step={0.5}
                value={stepPct}
                onChange={e => setStepPct(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Modalità importo</label>
              <select
                value={modalita}
                onChange={e => setModalita(e.target.value as Modalita)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
              >
                <option value="variabile">Variabile (∝ drawdown, come alert)</option>
                <option value="fisso">Fisso per step</option>
              </select>
            </div>
            {modalita === 'fisso' ? (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Importo per step (€)</label>
                <input
                  type="number" min={1} step={50}
                  value={importoFisso}
                  onChange={e => setImportoFisso(Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-gray-500 block mb-1">DD max profilo</label>
                <input
                  type="text" disabled
                  value={`${(ddMax * 100).toFixed(0)}%`}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 text-gray-500"
                />
              </div>
            )}
            {!isAggregato ? (
              <div className="col-span-2 sm:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">
                  Prezzo di partenza — il &ldquo;massimo&rdquo; da cui parte la discesa (€)
                </label>
                <input
                  type="number" min={0.01} step={0.01}
                  value={prezzoMassimo ?? ''}
                  onChange={e => {
                    setPrezzoModificatoManualmente(true)
                    setPrezzoMassimo(Number(e.target.value))
                  }}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Ogni step della simulazione scende del {stepPct}% da questo prezzo (precompilato col massimo a 52
                  settimane). Modificalo per simulare un altro punto di partenza, es. il prezzo attuale.
                </p>
              </div>
            ) : (
              <div className="col-span-2 sm:col-span-2 flex items-end">
                <p className="text-[11px] text-gray-400">
                  Modalità aggregato: nessun prezzo (un paniere di asset non ha un prezzo unico). Ogni euro investito
                  a un drawdown D vale, se il mercato recupera, importo / (1 − D).
                </p>
              </div>
            )}
            <div className="col-span-2 sm:col-span-2 flex items-end">
              <button
                onClick={simula}
                className="w-full text-sm font-medium bg-brand-700 text-white rounded-lg px-3 py-1.5 hover:bg-brand-800"
              >
                Simula
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Riserva disponibile per la simulazione: <strong>{fmtEuro(riservaTotale)}</strong>
          </p>

          {risultato && risultato.rows.length > 0 && ultimoStep && (
            <>
              {/* Scenari finali */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-700 mb-1">Scenario: discesa continua</p>
                  <p className="text-xs text-red-700">
                    {risultato.esaurita ? 'Riserva esaurita' : 'Riserva non esaurita nel range simulato'} allo step{' '}
                    <strong>{ultimoStep.step}</strong> (drawdown <strong>-{ultimoStep.drawdownPct.toFixed(1)}%</strong>
                    {!isAggregato && ultimoStep.prezzo != null ? <>, prezzo <strong>{fmtEuro(ultimoStep.prezzo)}</strong></> : null}).
                  </p>
                  <p className="text-xs text-red-700 mt-1">
                    Capitale investito: <strong>{fmtEuro(ultimoStep.cumInvestito)}</strong>
                    {!isAggregato && ultimoStep.prezzoMedioCarico != null && (
                      <> · Prezzo medio carico: <strong>{fmtEuro(ultimoStep.prezzoMedioCarico)}</strong></>
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-brand-50 p-3">
                  <p className="text-xs font-semibold text-brand-800 mb-1">Scenario: recupero ai massimi</p>
                  <p className="text-xs text-brand-800">
                    {isAggregato
                      ? <>Se tutti gli asset tornano al livello di partenza, il valore della posizione accumulata
                          sarebbe <strong>{fmtEuro(valoreAlRecupero ?? 0)}</strong>.</>
                      : <>Se il prezzo torna a <strong>{fmtEuro(prezzoMassimo ?? 0)}</strong>, il valore della
                          posizione accumulata sarebbe <strong>{fmtEuro(valoreAlRecupero ?? 0)}</strong>.</>
                    }
                  </p>
                  <p className="text-xs text-brand-800 mt-1">
                    P&amp;L: <strong className={pnlRecupero != null && pnlRecupero >= 0 ? 'text-green-700' : 'text-red-700'}>
                      {pnlRecupero != null ? fmtEuro(pnlRecupero) : '–'}
                      {pnlRecuperoPct != null ? ` (${pnlRecuperoPct >= 0 ? '+' : ''}${pnlRecuperoPct.toFixed(1)}%)` : ''}
                    </strong>
                  </p>
                </div>
              </div>

              {/* Tabella step */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-100">
                      <th className="text-left py-1.5 pr-2">Step</th>
                      <th className="text-right py-1.5 px-2">Drawdown</th>
                      {!isAggregato && <th className="text-right py-1.5 px-2">Prezzo</th>}
                      <th className="text-right py-1.5 px-2">Investito step</th>
                      <th className="text-right py-1.5 px-2">Cumulato</th>
                      {isAggregato
                        ? <th className="text-right py-1.5 px-2">Valore cum. se recupero</th>
                        : <th className="text-right py-1.5 px-2">Prezzo medio</th>
                      }
                      <th className="text-right py-1.5 pl-2">Riserva residua</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risultato.rows.map(r => (
                      <tr key={r.step} className="border-b border-gray-50 tabular-nums">
                        <td className="py-1.5 pr-2 text-gray-700">{r.step}</td>
                        <td className="text-right py-1.5 px-2 text-red-600">-{r.drawdownPct.toFixed(1)}%</td>
                        {!isAggregato && (
                          <td className="text-right py-1.5 px-2 text-gray-700">{fmtEuro(r.prezzo ?? 0)}</td>
                        )}
                        <td className="text-right py-1.5 px-2 text-gray-700">{fmtEuro(r.importoStep)}</td>
                        <td className="text-right py-1.5 px-2 font-medium text-gray-900">{fmtEuro(r.cumInvestito)}</td>
                        {isAggregato
                          ? <td className="text-right py-1.5 px-2 text-green-700">{fmtEuro(r.cumValoreRecupero ?? 0)}</td>
                          : <td className="text-right py-1.5 px-2 text-gray-700">{fmtEuro(r.prezzoMedioCarico ?? 0)}</td>
                        }
                        <td className="text-right py-1.5 pl-2 text-gray-500">{fmtEuro(r.riservaResidua)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {risultato && risultato.rows.length === 0 && (
            <p className="text-xs text-gray-500">Nessuno step simulabile con questi parametri.</p>
          )}
        </div>
      )}
    </div>
  )
}
