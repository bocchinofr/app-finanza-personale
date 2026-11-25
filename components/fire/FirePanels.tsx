// components/fire/FirePanels.tsx
// Pannelli della sezione FIRE: previsione (grafico / tabella anno per anno),
// riepilogo ipotesi chiave (colonna destra) ed esito del ricalcolo (Drawer).
'use client'

import { useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import InfoBox from '@/components/ui/InfoBox'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { fmtEuro, fmtPct } from '@/components/ui/KpiCard'
import { IconSliders, IconArrowUp, IconArrowDown } from '@/components/ui/Icons'
import type { AnnoProiezione, EsitoRicalcolo, FireParametri } from '@/lib/fireCalculations'
import { Pill } from './FireKpis'

/** Valore compatto per tabelle: 1,23 M oltre il milione, altrimenti migliaia con punto. */
export function euroCompatto(v: number): string {
  const abs = Math.abs(v)
  const segno = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${segno}${(abs / 1_000_000).toFixed(2).replace('.', ',')} M`
  return `${segno}${abs.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`
}

// ─── Grafico ─────────────────────────────────────────────────────
function formatEuroCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`
  return `${Math.round(v)}`
}

interface TooltipPayloadItem { color: string; name: string; value: number }

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: number }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-xl border border-surface-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="num-display text-sm font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />{p.name}
          </span>
          <span className="font-mono tabular-nums text-gray-900">
            {p.value.toLocaleString('it-IT', { maximumFractionDigits: 0 })} €
          </span>
        </p>
      ))}
    </div>
  )
}

function FireProjectionChart({ proiezione }: { proiezione: AnnoProiezione[] }) {
  const annoFire = proiezione.find(a => a.fireRaggiunto)?.anno

  const dati = proiezione.map(a => ({
    anno: a.anno,
    'Patrimonio rilevante': Math.round(a.patrimonioRilevantePerFire),
    'FIRE number target': Math.round(a.fireNumberTarget),
    'Patrimonio totale': Math.round(a.patrimonioTotale),
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={dati} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fireRilevante" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f6b4f" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#3f6b4f" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#ececE1" />
        <XAxis dataKey="anno" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={{ stroke: '#d8dcc9' }} minTickGap={28} />
        <YAxis tickFormatter={formatEuroCompact} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {annoFire && (
          <ReferenceLine
            x={annoFire}
            stroke="#3f6b4f"
            strokeDasharray="4 4"
            label={{ value: 'FIRE', position: 'top', fill: '#3f6b4f', fontSize: 11, fontWeight: 600 }}
          />
        )}
        <Area type="monotone" dataKey="Patrimonio rilevante" stroke="#3f6b4f" strokeWidth={2.4} fill="url(#fireRilevante)" dot={false} />
        <Line type="monotone" dataKey="Patrimonio totale" stroke="#a9b092" strokeWidth={1.6} dot={false} />
        <Line type="monotone" dataKey="FIRE number target" stroke="#78716c" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── Tabella anno per anno ───────────────────────────────────────
const COLONNE: { k: string; titolo: string; title: string; w: string; align: 'left' | 'right' }[] = [
  { k: 'anno', titolo: 'Anno', title: 'Anno (valori a fine anno)', w: 'xl:w-[15%]', align: 'left' },
  { k: 'eta', titolo: 'Età', title: 'Età a fine anno', w: 'xl:w-[8%]', align: 'right' },
  { k: 'fase', titolo: 'Fase', title: 'Fase: accumulo o decumulo', w: 'xl:w-[14%]', align: 'left' },
  { k: 'entrate', titolo: 'Entrate', title: 'Entrate annue da lavoro', w: 'xl:w-[15%]', align: 'right' },
  { k: 'uscite', titolo: 'Uscite', title: 'Spese annue nette', w: 'xl:w-[15%]', align: 'right' },
  { k: 'risparmio', titolo: 'Risparmio', title: 'Risparmio = entrate − uscite (in decumulo è il prelievo)', w: 'xl:w-[16%]', align: 'right' },
  { k: 'patrimonio', titolo: 'Patrimonio', title: 'Patrimonio totale = investito + fondo pensione', w: 'xl:w-[17%]', align: 'right' },
]

function FireTabellaPrevisionale({
  proiezione, annoCorrente,
}: {
  proiezione: AnnoProiezione[]
  annoCorrente: number
}) {
  const annoFire = proiezione.find(a => a.fireRaggiunto)?.anno ?? null
  const mancanoEntrate = proiezione.length > 0 && proiezione[0].entrateAnnue === undefined

  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      {mancanoEntrate && (
        <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Questa previsione è stata salvata prima dell&apos;introduzione di entrate e risparmio: premi Ricalcola per completarla.
        </p>
      )}
      <div className="max-h-[28rem] xl:max-h-none xl:flex-1 min-h-0 overflow-auto rounded-lg border border-surface-100">
        <table className="w-full min-w-[640px] xl:min-w-0 xl:table-fixed border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {COLONNE.map(c => (
                <th
                  key={c.k}
                  title={c.title}
                  className={`${c.w} px-3 py-2 bg-surface-50 border-b border-surface-200 whitespace-nowrap font-medium text-gray-400 uppercase tracking-wide
                    text-[10px] xl:text-[11px] 2xl:text-xs ${c.align === 'right' ? 'text-right' : 'text-left'}
                    ${c.k === 'anno' ? 'sticky left-0 z-20' : ''}`}
                >
                  {c.titolo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums text-gray-700 text-xs xl:text-[13px] 2xl:text-sm">
            {proiezione.map(a => {
              const isFire = annoFire === a.anno
              const isCorrente = a.anno === annoCorrente
              const sfondo = isFire ? 'bg-brand-50' : isCorrente ? 'bg-surface-50' : 'bg-white'
              const haEntrate = a.entrateAnnue !== undefined
              return (
                <tr key={a.anno} className={`border-t border-surface-100 ${sfondo}`}>
                  <td className={`sticky left-0 px-3 py-1.5 text-left whitespace-nowrap ${sfondo} ${isCorrente ? 'border-l-2 border-l-brand-600 font-semibold text-gray-900' : ''}`}>
                    {a.anno}
                    {isFire && (
                      <span className="ml-2 rounded-full bg-brand-600 px-1.5 py-0.5 font-sans text-[9px] font-semibold tracking-wide text-white">
                        FIRE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{a.eta}</td>
                  <td className="px-3 py-1.5 text-left">
                    <span className={`rounded-full px-2 py-0.5 font-sans text-[10px] font-semibold ${
                      a.fase === 'accumulo' ? 'bg-accent2-50 text-accent2-700' : 'bg-surface-100 text-gray-600'
                    }`}>
                      {a.fase === 'accumulo' ? 'Accumulo' : 'Decumulo'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{haEntrate ? euroCompatto(a.entrateAnnue) : '—'}</td>
                  <td className="px-3 py-1.5 text-right">{euroCompatto(a.speseAnnue)}</td>
                  <td className={`px-3 py-1.5 text-right ${haEntrate && a.risparmioAnnuo >= 0 ? 'text-green-700' : 'text-gray-500'}`}>
                    {haEntrate ? euroCompatto(a.risparmioAnnuo) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{euroCompatto(a.patrimonioTotale)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Pannello previsione (grafico | tabella) ─────────────────────
type Vista = 'grafico' | 'tabella'

export function FirePrevisionePanel({
  proiezione, proiezioneSalvata, annoCorrente, etichettaCalcolo,
}: {
  proiezione: AnnoProiezione[]          // proiezione "live" (segue le ipotesi)
  proiezioneSalvata: AnnoProiezione[] | null // previsione di riferimento salvata
  annoCorrente: number
  etichettaCalcolo: string
}) {
  const [vista, setVista] = useState<Vista>('grafico')
  const annoFire = proiezione.find(a => a.fireRaggiunto)?.anno

  return (
    <section className="card h-full flex flex-col min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <SegmentedControl<Vista>
            ariaLabel="Vista previsione"
            value={vista}
            onChange={setVista}
            options={[
              { value: 'grafico', label: 'Proiezione' },
              { value: 'tabella', label: 'Anno per anno' },
            ]}
          />
          <InfoBox title={vista === 'grafico' ? 'Come leggere il grafico' : 'Come leggere la tabella'}>
            {vista === 'grafico' ? (
              <>
                <p><strong>Patrimonio rilevante</strong> (area verde): il capitale che conta per il FIRE, cioè l&apos;investito (più il fondo se lo includi da bloccato).</p>
                <p><strong>Patrimonio totale</strong>: investito + fondo pensione. La linea tratteggiata è il <strong>FIRE number</strong> di riferimento (spese ÷ SWR); la linea verticale segna l&apos;anno in cui la simulazione dice che sei FIRE.</p>
                <p>Il grafico segue subito le modifiche alle ipotesi; la tabella resta ferma finché non premi Ricalcola.</p>
              </>
            ) : (
              <>
                <p>Previsione di riferimento: resta ferma finché non la ricalcoli, così puoi confrontarla con i dati reali.</p>
                <p>Valori a fine anno. <strong>Risparmio</strong> = entrate − uscite; in decumulo le entrate da lavoro sono zero e il valore negativo è il prelievo dal capitale. <strong>Patrimonio</strong> = investito + fondo pensione.</p>
              </>
            )}
          </InfoBox>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          {vista === 'tabella' && etichettaCalcolo && <span>Previsione {etichettaCalcolo}</span>}
          {vista === 'grafico' && annoFire && <Pill tone="positive">FIRE nel {annoFire}</Pill>}
        </div>
      </div>

      <div className="mt-3 flex-1 min-h-0">
        {vista === 'grafico' ? (
          <div className="h-[300px] sm:h-[360px] xl:h-full">
            <FireProjectionChart proiezione={proiezione} />
          </div>
        ) : proiezioneSalvata ? (
          <FireTabellaPrevisionale proiezione={proiezioneSalvata} annoCorrente={annoCorrente} />
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">Previsione in preparazione…</p>
        )}
      </div>
    </section>
  )
}

// ─── Riepilogo ipotesi (colonna destra) ──────────────────────────
const pct = (v: number) => `${v.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`

function Riga({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 border-b border-surface-100 last:border-b-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-gray-900">{children}</span>
    </li>
  )
}

export function FireAssunzioniRiepilogo({
  parametri, onModifica,
}: {
  parametri: FireParametri
  onModifica: () => void
}) {
  const debitiAttivi = parametri.debiti.filter(d => d.annoEstinzione >= parametri.annoIniziale).length

  return (
    <section className="card h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="num-display text-base font-semibold text-gray-900">Ipotesi chiave</h2>
          <InfoBox title="Ipotesi del modello">
            <p>Sono i parametri con cui la proiezione viene calcolata. Entrate, spese e investimento partono dalla media annualizzata dei movimenti dell&apos;anno.</p>
            <p>Con <strong>Modifica</strong> apri il pannello completo: grafico e KPI si aggiornano subito, ma la previsione di riferimento cambia solo con Ricalcola.</p>
          </InfoBox>
        </div>
        <button type="button" onClick={onModifica} className="btn-secondary !px-2.5 !py-1.5 text-xs inline-flex items-center gap-1.5">
          <IconSliders size={14} /> Modifica
        </button>
      </div>

      <ul className="mt-2 flex-1 min-h-0 overflow-y-auto">
        <Riga label="Età attuale">{parametri.etaIniziale} anni</Riga>
        <Riga label="Entrate annue">{fmtEuro(parametri.entrateAnnueBase)}</Riga>
        <Riga label="Spese annue">{fmtEuro(parametri.speseAnnueBase)}</Riga>
        <Riga label="Investimento annuo">{fmtEuro(parametri.investimentoAnnuoBase)}</Riga>
        <Riga label="Rendimento atteso"><Pill tone="neutral">{pct(parametri.rendimentoInvestimentiPct)}</Pill></Riga>
        <Riga label="SWR"><Pill tone="neutral">{pct(parametri.swrPct)}</Pill></Riga>
        <Riga label="Inflazione"><Pill tone="neutral">{pct(parametri.inflazionePct)}</Pill></Riga>
        <Riga label="Sblocco fondo pensione">{parametri.etaRitiroFondoPensione} anni</Riga>
        <Riga label="Orizzonte">{parametri.orizzonteAnni} anni</Riga>
        {debitiAttivi > 0 && <Riga label="Debiti in corso">{debitiAttivi}</Riga>}
      </ul>
    </section>
  )
}

// ─── Esito ricalcolo (contenuto Drawer) ──────────────────────────
export function FireEsitoRicalcolo({ esito }: { esito: EsitoRicalcolo }) {
  let testoFire: string | null = null
  if (esito.annoFireNuovo !== null && esito.annoFirePrecedente !== null) {
    const diff = esito.annoFireNuovo - esito.annoFirePrecedente
    if (diff < 0) testoFire = `FIRE anticipato di ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'anno' : 'anni'} (ora ${esito.annoFireNuovo})`
    else if (diff > 0) testoFire = `FIRE posticipato di ${diff} ${diff === 1 ? 'anno' : 'anni'} (ora ${esito.annoFireNuovo})`
    else testoFire = `Anno FIRE invariato (${esito.annoFireNuovo})`
  } else if (esito.annoFireNuovo !== null) {
    testoFire = `Ora il FIRE risulta raggiungibile nel ${esito.annoFireNuovo}`
  } else if (esito.annoFirePrecedente !== null) {
    testoFire = 'Ora il FIRE non risulta più raggiungibile nell\u2019orizzonte'
  }

  const titolo =
    esito.esito === 'migliorata' ? 'Proiezione migliorata'
    : esito.esito === 'peggiorata' ? 'Proiezione peggiorata'
    : 'Proiezione invariata'

  return (
    <div>
      <div className="flex items-center gap-2">
        {esito.esito === 'migliorata' && <Pill tone="positive"><IconArrowUp size={12} />{titolo}</Pill>}
        {esito.esito === 'peggiorata' && <Pill tone="negative"><IconArrowDown size={12} />{titolo}</Pill>}
        {esito.esito === 'invariata' && <Pill tone="neutral">{titolo}</Pill>}
        <span className="text-[12px] text-gray-400">rispetto alla precedente</span>
      </div>

      <ul className="mt-3">
        {esito.righe.map(r => (
          <li key={r.anno} className="py-3 border-b border-surface-100 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-gray-600">Patrimonio a fine {r.anno}</span>
              <Pill tone={r.deltaPct >= 0 ? 'positive' : 'negative'}>{fmtPct(r.deltaPct)}</Pill>
            </div>
            <p className="mt-1 font-mono text-sm tabular-nums text-gray-900">
              {fmtEuro(r.patrimonioNuovo)} <span className="text-xs text-gray-400">/ {fmtEuro(r.patrimonioPrecedente)} previsti</span>
            </p>
          </li>
        ))}
      </ul>

      {testoFire && <p className="mt-4 text-[13px] text-gray-700">{testoFire}</p>}
    </div>
  )
}
