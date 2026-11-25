// components/fire/FireKpis.tsx
// KPI della sezione FIRE (FIRE Number, Dopo il pensionamento, Runway, Andamento anno),
// pillola colorata condivisa e InfoBox di spiegazione.
'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import KpiCard, { fmtEuro, fmtPct } from '@/components/ui/KpiCard'
import InfoBox from '@/components/ui/InfoBox'
import { IconCheck } from '@/components/ui/Icons'
import type {
  AnnoProiezione, ConfrontoAnnuale, FireNumberResult, PostFireResult, RunwayResult,
} from '@/lib/fireCalculations'

// ─── Pillola ─────────────────────────────────────────────────────
type PillTone = 'positive' | 'negative' | 'warning' | 'neutral'

const PILL: Record<PillTone, string> = {
  positive: 'bg-green-50 text-green-700',
  negative: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-700',
  neutral: 'bg-surface-100 text-gray-500',
}

/** Pillola come i chip di KpiCard (DeltaChip), ma con testo libero. */
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap ${PILL[tone]}`}>
      {children}
    </span>
  )
}

// ─── InfoBox ─────────────────────────────────────────────────────
export function FireInfoBox() {
  return (
    <InfoBox title="Come leggere FIRE">
      <p><strong>Due fasi, una proiezione</strong>: finché non sei FIRE sei in <strong>accumulo</strong> (investi ogni anno, le spese le copre il lavoro); dall&apos;anno dopo entri in <strong>decumulo</strong> (niente investimento, le spese nette escono dal capitale).</p>
      <p><strong>Quando sei FIRE</strong>: è una verifica simulata, non un rapporto fisso. Ogni anno si simula &ldquo;se smettessi di investire da qui, il capitale arriva vivo a fine orizzonte?&rdquo; con le tue assunzioni (rendimento, tasse, inflazione, crescita spese, fondo pensione). Il primo anno col sì è il tuo anno FIRE.</p>
      <p><strong>FIRE Number</strong> = spese attuali ÷ SWR (regola del 4%): è solo un riferimento storico, non decide il passaggio di fase. Può scattare prima se le spese restano piatte, dopo se crescono più del margine tra rendimento netto e SWR.</p>
      <p><strong>Dopo il pensionamento</strong>: se il capitale regge fino a fine orizzonte o per quanti anni. <strong>Runway</strong>: quanto dura se smetti di lavorare oggi; il fondo pensione conta solo dopo lo sblocco.</p>
      <p><strong>Fondo pensione</strong>: bloccato fino all&apos;età di sblocco, poi una quota va al capitale (tipo TFR) e il resto riduce le spese annue. <strong>Debiti</strong>: la rata esce dalle spese dall&apos;anno di estinzione.</p>
      <p><strong>Andamento</strong>: confronta i dati reali di quest&apos;anno con la previsione salvata. Le tasse su investimenti e fondo sono già nei rendimenti netti.</p>
    </InfoBox>
  )
}

// ─── FIRE Number (featured) ──────────────────────────────────────
export function FireNumberCard({
  risultato, proiezione, etichettaCalcolo,
}: {
  risultato: FireNumberResult
  proiezione: AnnoProiezione[]
  etichettaCalcolo: string
}) {
  const raggiunto = risultato.anniMancanti !== null && risultato.anniMancanti <= 0

  const badge =
    risultato.annoStimato === null ? <Pill tone="warning">Non raggiunto nell&apos;orizzonte</Pill>
    : raggiunto ? <Pill tone="positive">Già raggiunto</Pill>
    : <Pill tone="positive">{risultato.anniMancanti} anni al FIRE</Pill>

  // Trend: patrimonio fino a qualche anno dopo il FIRE (max 40 punti)
  const idxFire = proiezione.findIndex(a => a.fireRaggiunto)
  const fine = idxFire >= 0 ? Math.min(idxFire + 6, 40) : 40
  const spark = proiezione.slice(0, Math.max(fine, 2)).map(a => a.patrimonioTotale)

  return (
    <KpiCard
      variant="featured"
      label="FIRE Number"
      value={fmtEuro(risultato.fireNumberOggi)}
      color="#3f6b4f"
      delta={null}
      badge={badge}
      spark={spark}
      headerRight={
        <>
          {etichettaCalcolo && <span>Previsione {etichettaCalcolo}</span>}
          <FireInfoBox />
        </>
      }
      extra={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-surface-100 pt-2.5 text-[12px] text-gray-500">
          {risultato.annoStimato !== null && (
            <>
              <span>Sostenibile dal <strong className="font-mono font-semibold text-gray-900">{risultato.annoStimato}</strong></span>
              <span>Età <strong className="font-mono font-semibold text-gray-900">{risultato.etaStimata}</strong></span>
            </>
          )}
          <span className="sm:ml-auto text-[11px] text-gray-400">Riferimento: spese attuali ÷ SWR</span>
        </div>
      }
    />
  )
}

// ─── Dopo il pensionamento ───────────────────────────────────────
export function PostFireCard({
  risultato, etaRitiroFondoPensione,
}: {
  risultato: PostFireResult
  etaRitiroFondoPensione: number
}) {
  let value = '—'
  let tone: 'neutral' | 'positive' | 'warning' = 'neutral'
  let badge = <Pill>Non ancora</Pill>
  let minis: { label: string; value: string; sub?: string; tone?: 'negative' }[] | undefined

  if (risultato.applicabile && risultato.sostenibileFinoOrizzonte) {
    value = 'Copre l\u2019orizzonte'
    tone = 'positive'
    badge = <Pill tone="positive">Sostenibile</Pill>
    minis = [{ label: 'Sblocco fondo', value: `${etaRitiroFondoPensione} anni` }]
  } else if (risultato.applicabile) {
    value = `${risultato.anniDiRendita} anni`
    tone = 'warning'
    badge = <Pill tone="warning">Si esaurisce</Pill>
    minis = [{ label: 'Esaurito nel', value: `${risultato.annoEsaurimento}`, sub: `età ${risultato.etaEsaurimento}`, tone: 'negative' }]
  }

  return (
    <KpiCard
      variant="compact"
      label="Dopo il pensionamento"
      value={value}
      color="#5b7a99"
      tone={tone}
      delta={null}
      badge={badge}
      minis={minis}
    />
  )
}

// ─── Runway ──────────────────────────────────────────────────────
export function RunwayCard({
  calcolaRunway,
}: {
  calcolaRunway: (includiFondoPensione: boolean) => RunwayResult
}) {
  const [includiFondoPensione, setIncludiFondoPensione] = useState(false)
  const risultato = calcolaRunway(includiFondoPensione)

  const toggle = (
    <button
      type="button"
      onClick={() => setIncludiFondoPensione(v => !v)}
      aria-pressed={includiFondoPensione}
      title="Includi il fondo pensione nel calcolo (si sblocca comunque solo all'età impostata)"
      className={`inline-flex items-center gap-1 rounded-full border text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap transition-colors ${
        includiFondoPensione
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-surface-100 text-gray-500 border-transparent hover:text-gray-800'
      }`}
    >
      {includiFondoPensione && <IconCheck size={12} />}
      Fondo pensione
    </button>
  )

  return (
    <KpiCard
      variant="compact"
      label="Runway se smetti oggi"
      value={risultato.sostenibileIndefinitamente ? 'Indefinitamente' : `${risultato.anniDiAutonomia} anni`}
      color="#8a9a5b"
      tone={risultato.sostenibileIndefinitamente ? 'positive' : 'neutral'}
      delta={null}
      badge={toggle}
      minis={
        risultato.sostenibileIndefinitamente
          ? [{ label: 'Rendimento netto', value: 'copre le spese' }]
          : [{ label: 'Esaurito nel', value: `${risultato.annoEsaurimento}`, sub: `età ${risultato.etaEsaurimento}`, tone: 'negative' }]
      }
    />
  )
}

// ─── Andamento anno ──────────────────────────────────────────────
function scostPct(reale: number, previsto: number): number {
  return previsto !== 0 ? ((reale - previsto) / Math.abs(previsto)) * 100 : 0
}

export function FireReviewCard({
  confronto, onClick,
}: {
  confronto: ConfrontoAnnuale | null
  onClick: () => void
}) {
  if (!confronto) {
    return (
      <KpiCard variant="compact" label="Andamento anno" value="—" color="#c65d3b" delta={null} onClick={onClick} />
    )
  }
  const sSpese = scostPct(confronto.speseReali, confronto.speseSimulate)
  const sInvest = scostPct(confronto.investimentoReale, confronto.investimentoSimulato)

  return (
    <KpiCard
      variant="compact"
      label={`Andamento ${confronto.anno} · patrimonio`}
      value={fmtEuro(confronto.patrimonioReale)}
      color="#c65d3b"
      delta={{ value: confronto.patrimonioReale - confronto.patrimonioSimulato, pct: confronto.scostamentoPatrimonioPct }}
      minis={[
        { label: 'Spese', value: fmtEuro(confronto.speseReali), sub: fmtPct(sSpese), tone: sSpese <= 0 ? 'positive' : 'negative' },
        { label: 'Invest.', value: fmtEuro(confronto.investimentoReale), sub: fmtPct(sInvest), tone: sInvest >= 0 ? 'positive' : 'negative' },
      ]}
      onClick={onClick}
    />
  )
}

function Riga({
  label, reale, previsto, invertiColore = false,
}: { label: string; reale: number; previsto: number; invertiColore?: boolean }) {
  const pct = scostPct(reale, previsto)
  const positivo = invertiColore ? pct <= 0 : pct >= 0
  return (
    <div className="py-3 border-b border-surface-100 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-gray-600">{label}</span>
        <Pill tone={positivo ? 'positive' : 'negative'}>{fmtPct(pct)}</Pill>
      </div>
      <p className="mt-1 font-mono text-sm tabular-nums text-gray-900">
        {fmtEuro(reale)} <span className="text-xs text-gray-400">/ {fmtEuro(previsto)} previsti</span>
      </p>
    </div>
  )
}

/** Contenuto del Drawer "Andamento anno". */
export function FireReviewDettaglio({ confronto }: { confronto: ConfrontoAnnuale }) {
  return (
    <div>
      <Riga label="Spese annualizzate" reale={confronto.speseReali} previsto={confronto.speseSimulate} invertiColore />
      <Riga label="Investimento annualizzato" reale={confronto.investimentoReale} previsto={confronto.investimentoSimulato} />
      <Riga label="Patrimonio (oggi vs fine anno previsto)" reale={confronto.patrimonioReale} previsto={confronto.patrimonioSimulato} />
      <p className="mt-4 text-[12px] leading-relaxed text-gray-500">
        Spese e investimento sono già annualizzati sul ritmo attuale, quindi confrontabili con la proiezione a fine anno.
        Il patrimonio è il valore di oggi confrontato con il target di fine anno: a metà anno uno scostamento negativo è normale.
        Per le spese, scendere sotto il previsto è un miglioramento.
      </p>
    </div>
  )
}
