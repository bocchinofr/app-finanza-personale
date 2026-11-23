// components/patrimonio/PatrimonioSezioni.tsx
// Sezioni della pagina Patrimonio, raggruppate in un solo file:
//  - PatrimonioHero: totale, composizione e plus/minus
//  - AndamentoPatrimonio: grafico mensile / vista anno su anno
//  - DettaglioMensileDrawer: riepilogo mensile in pannello a comparsa
'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { DeltaChip, MiniStat, Sparkline, fmtEuro, type Delta, type Tone } from '@/components/ui/KpiCard'
import Drawer from '@/components/ui/Drawer'
import InfoBox from '@/components/ui/InfoBox'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { IconTable, IconChevronDown } from '@/components/ui/Icons'
import PatrimonioAnnuale from '@/components/PatrimonioAnnuale'


// ─── Hero ────────────────────────────────────────────────────────

type Parte = { label: string; value: number; color: string }

const segno = (n: number) => `${n >= 0 ? '+' : '−'}${fmtEuro(Math.abs(n))}`
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')}%`

export default function PatrimonioHero({
  patrimonio, delta, aggiornatoA, spark, parti,
  plusMinus, plusMinusDelta, plusMinusTone,
  plusMinusInvestimenti, plusMinusInvestimentiPct,
  fondoInteressi, fondoInteressiPct,
}: {
  patrimonio: number
  delta: Delta
  aggiornatoA: string
  spark: number[]
  parti: Parte[]
  plusMinus: number
  plusMinusDelta: Delta
  plusMinusTone: Tone
  plusMinusInvestimenti: number
  plusMinusInvestimentiPct: number
  fondoInteressi: number
  fondoInteressiPct: number
}) {
  const totale = parti.reduce((s, p) => s + Math.max(p.value, 0), 0)
  const quota = (v: number) => (totale > 0 ? (Math.max(v, 0) / totale) * 100 : 0)

  return (
    <section className="card !p-0 overflow-hidden">
      <div className="grid lg:grid-cols-[1.15fr_1fr]">
        {/* Sinistra: totale + composizione */}
        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-gray-600">Patrimonio totale</p>
            <p className="text-[11px] text-gray-400">Aggiornato a {aggiornatoA}</p>
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <p className="num-display text-4xl font-semibold text-gray-900 leading-none">{fmtEuro(patrimonio)}</p>
            <Sparkline values={spark} color="#3f6b4f" />
          </div>
          <div className="mt-3"><DeltaChip delta={delta} /></div>

          {/* Barra di composizione */}
          <div className="mt-5">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-100" role="img"
                 aria-label="Composizione del patrimonio">
              {parti.map(p => (
                <div key={p.label} style={{ width: `${quota(p.value)}%`, backgroundColor: p.color }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {parti.map(p => (
                <span key={p.label} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label} <span className="font-mono tabular-nums text-gray-700">{quota(p.value).toFixed(0)}%</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Destra: rendimento non realizzato */}
        <div className="p-5 bg-surface-50/70 border-t lg:border-t-0 lg:border-l border-surface-200 flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-gray-600">Plus/minus non realizzato</p>
            <DeltaChip delta={plusMinusDelta} />
          </div>
          <p className={`mt-2 num-display text-2xl font-semibold leading-none ${
            plusMinusTone === 'negative' ? 'text-red-700' : plusMinusTone === 'warning' ? 'text-amber-600' : 'text-green-700'
          }`}>
            {segno(plusMinus)}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniStat
              label="Investimenti"
              value={segno(plusMinusInvestimenti)}
              sub={pct(plusMinusInvestimentiPct)}
              tone={plusMinusInvestimenti >= 0 ? 'positive' : 'negative'}
            />
            <MiniStat
              label="Fondo pensione"
              value={segno(fondoInteressi)}
              sub={pct(fondoInteressiPct)}
              tone={fondoInteressi >= 0 ? 'positive' : 'negative'}
            />
          </div>
          <div className="mt-auto pt-4">
            <InfoBox title="Come leggere questi numeri">
              <p><strong>Patrimonio totale</strong> = liquidità + capitale investito (a valore di mercato) + fondo pensione. Il plus/minus è già incluso nel valore di mercato, non si somma a parte.</p>
              <p><strong>Plus/minus non realizzato</strong> = guadagno o perdita sugli investimenti rispetto al prezzo di carico, più gli interessi del fondo pensione. Il chip mostra la variazione rispetto al mese precedente.</p>
              <p>Il grafico a destra del totale è il trend dei mesi dell&apos;anno selezionato.</p>
            </InfoBox>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Andamento (grafico) ─────────────────────────────────────────

export type RigaStorico = {
  mese: string
  'Liquidità': number
  'Capitale investito': number
  'Fondo pensione': number
  'Plus/minus': number | null
  Totale: number
}
export type VistaPatrimonio = 'mensile' | 'annuale'

const fmtK = (n: number) => `${(n / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k`

export function AndamentoPatrimonio({
  anno, data, vista, onVista, percentuale, onPercentuale, onMese, onApriDettaglio,
}: {
  anno: number
  data: RigaStorico[]
  vista: VistaPatrimonio
  onVista: (v: VistaPatrimonio) => void
  percentuale: boolean
  onPercentuale: (v: boolean) => void
  onMese: (mese: string) => void
  onApriDettaglio: () => void
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SegmentedControl<VistaPatrimonio>
            ariaLabel="Vista patrimonio"
            value={vista}
            onChange={onVista}
            options={[
              { value: 'mensile', label: `Mensile ${anno}` },
              { value: 'annuale', label: 'Anno su anno' },
            ]}
          />
        </div>
        {vista === 'mensile' && (
          <div className="flex items-center gap-2">
            <SegmentedControl<'eur' | 'pct'>
              ariaLabel="Unità del grafico"
              value={percentuale ? 'pct' : 'eur'}
              onChange={v => onPercentuale(v === 'pct')}
              options={[{ value: 'eur', label: '€' }, { value: 'pct', label: '%' }]}
            />
            <button
              type="button"
              onClick={onApriDettaglio}
              className="btn-secondary !py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
            >
              <IconTable size={14} /> Dettaglio mensile
            </button>
          </div>
        )}
      </div>

      <div className="mt-4">
        {vista === 'annuale' ? (
          <PatrimonioAnnuale embedded />
        ) : data.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dato disponibile per {anno}</p>
        ) : (
          <>
            <div className="cursor-pointer">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart
                  data={data}
                  margin={{ top: 22, right: 8, bottom: 4, left: 0 }}
                  onClick={state => { if (state?.activeLabel) onMese(String(state.activeLabel)) }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e7d8" />
                  <XAxis dataKey="mese" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    domain={percentuale ? [0, 100] : undefined}
                    tickFormatter={v => percentuale ? `${v}%` : `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(63,107,79,0.06)' }}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e4e7d8', fontSize: 12 }}
                    formatter={(v: number, name: string) =>
                      name === 'Totale' ? [fmtEuro(v), name] : percentuale ? [`${v}%`, name] : [fmtEuro(v), name]
                    }
                  />
                  <Legend verticalAlign="top" align="left" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
                  <Bar yAxisId="left" dataKey="Liquidità" stackId="patrimonio" fill="#4a6fa1" maxBarSize={40} />
                  <Bar yAxisId="left" dataKey="Capitale investito" stackId="patrimonio" fill="#3f6b4f" maxBarSize={40} />
                  <Bar yAxisId="left" dataKey="Fondo pensione" stackId="patrimonio" fill="#a67c3d" maxBarSize={40} />
                  <Bar yAxisId="left" dataKey="Plus/minus" stackId="patrimonio" fill="#c65d3b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  {!percentuale && (
                    <Line
                      yAxisId="left"
                      dataKey="Totale"
                      stroke="none"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      isAnimationActive={false}
                      label={{ position: 'top', fontSize: 11, fill: '#3a3a2e', formatter: (v: number) => fmtK(v) }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Tocca o clicca un mese per aprire il dettaglio.</p>
          </>
        )}
      </div>

      <div className="mt-3">
        <InfoBox title={vista === 'mensile' ? 'Come leggere il grafico' : 'Come leggere la vista annuale'}>
          {vista === 'mensile' ? (
            <>
              <p><strong>Capitale investito</strong>: versato cumulato (movimenti Investimento, al netto di eventuali prelievi).</p>
              <p><strong>Plus/minus</strong>: rendimento reale da snapshot, più interessi del fondo pensione (N/D nei mesi senza snapshot registrato).</p>
              <p>Con <strong>%</strong> ogni categoria è espressa come quota del patrimonio del mese. Cliccando un mese si apre il riepilogo con le variazioni.</p>
            </>
          ) : (
            <>
              <p>Patrimonio, fondo, capitale e liquidità sono valori di fine anno (per l&apos;anno in corso, l&apos;ultimo mese con dati). Entrate e uscite sono i totali dell&apos;anno.</p>
              <p>Con <strong>Salva anno</strong> i totali vengono congelati in archivio e non cambiano più. Le righe &ldquo;manuali&rdquo; sono totali inseriti a mano per anni senza dati dettagliati.</p>
            </>
          )}
        </InfoBox>
      </div>
    </section>
  )
}

// ─── Dettaglio mensile (drawer) ──────────────────────────────────

export type RigaRiepilogo = {
  row: RigaStorico
  totale: number
  varAssoluta: number | null
  varPct: number | null
  varTone: string
  plusMinusTone: string
}
export type ColonnaEvidenziata = 'Liquidità' | 'Capitale investito' | 'Fondo pensione' | null

const segnoVar = (n: number) => `${n >= 0 ? '+' : ''}${fmtEuro(n)}`

export function DettaglioMensileDrawer({
  open, onClose, anno, rows, mese, colonna,
}: {
  open: boolean
  onClose: () => void
  anno: number
  rows: RigaRiepilogo[]
  mese: string | null
  colonna: ColonnaEvidenziata
}) {
  const [espanso, setEspanso] = useState<string | null>(null)

  // All'apertura: espande (mobile) e porta in vista il mese cliccato
  useEffect(() => {
    if (!open) return
    setEspanso(mese)
    if (mese) {
      const t = setTimeout(() => {
        document.querySelectorAll(`[data-mese="${mese}"]`).forEach(el => {
          if ((el as HTMLElement).offsetParent !== null) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        })
      }, 60)
      return () => clearTimeout(t)
    }
  }, [open, mese])

  const hlCol = (c: ColonnaEvidenziata) => (colonna === c && c ? 'bg-brand-50/70' : '')
  const hlRow = (m: string) => (mese === m ? 'bg-brand-50/60' : '')

  return (
    <Drawer open={open} onClose={onClose} title="Dettaglio mensile" subtitle={`Anno ${anno} · dal mese più recente`}>
      {/* Desktop: tabella completa */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide sticky left-0 bg-white">Mese</th>
              <th className={`text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide ${hlCol('Liquidità')}`}>Liquidità</th>
              <th className={`text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide ${hlCol('Capitale investito')}`}>Capitale</th>
              <th className={`text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide ${hlCol('Fondo pensione')}`}>Fondo</th>
              <th className="text-right px-3 py-2 text-gray-500 font-semibold uppercase tracking-wide">Totale</th>
              <th className="text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Var.</th>
              <th className="text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Var. %</th>
              <th className="text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">Plus/minus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, totale, varAssoluta, varPct, varTone, plusMinusTone }) => (
              <tr key={row.mese} data-mese={row.mese} className={hlRow(row.mese)}>
                <td className="px-3 py-2 text-gray-700 font-medium sticky left-0 bg-inherit border-b border-surface-200/50">{row.mese}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums text-gray-600 border-b border-surface-200/50 ${hlCol('Liquidità')}`}>{fmtEuro(row['Liquidità'])}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums text-gray-600 border-b border-surface-200/50 ${hlCol('Capitale investito')}`}>{fmtEuro(row['Capitale investito'])}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums text-gray-600 border-b border-surface-200/50 ${hlCol('Fondo pensione')}`}>{fmtEuro(row['Fondo pensione'])}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-900 font-semibold border-b border-surface-200/50">{fmtEuro(totale)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums font-medium border-b border-surface-200/50 ${varTone}`}>
                  {varAssoluta == null ? '–' : segnoVar(varAssoluta)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums font-medium border-b border-surface-200/50 ${varTone}`}>
                  {varPct == null ? '–' : `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%`}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums font-medium border-b border-surface-200/50 ${plusMinusTone}`}>
                  {row['Plus/minus'] == null ? 'N/D' : segnoVar(row['Plus/minus'])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: righe espandibili */}
      <div className="md:hidden divide-y divide-surface-200/60">
        {rows.map(({ row, totale, varAssoluta, varPct, varTone, plusMinusTone }) => {
          const isOpen = espanso === row.mese
          return (
            <div key={row.mese} data-mese={row.mese} className={hlRow(row.mese)}>
              <button
                type="button"
                onClick={() => setEspanso(isOpen ? null : row.mese)}
                className="w-full flex items-center justify-between gap-2 py-3 text-left"
              >
                <span className="text-sm font-medium text-gray-700 w-12 shrink-0">{row.mese}</span>
                <span className="font-mono tabular-nums text-sm font-semibold text-gray-900 flex-1 text-right">{fmtEuro(totale)}</span>
                <span className={`font-mono tabular-nums text-xs font-medium w-16 text-right shrink-0 ${varTone}`}>
                  {varPct == null ? '–' : `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%`}
                </span>
                <IconChevronDown size={14} className={`text-gray-300 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="pb-3 pl-14 pr-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <span className="text-gray-400">Liquidità</span>
                  <span className="font-mono tabular-nums text-gray-700 text-right">{fmtEuro(row['Liquidità'])}</span>
                  <span className="text-gray-400">Capitale investito</span>
                  <span className="font-mono tabular-nums text-gray-700 text-right">{fmtEuro(row['Capitale investito'])}</span>
                  <span className="text-gray-400">Fondo pensione</span>
                  <span className="font-mono tabular-nums text-gray-700 text-right">{fmtEuro(row['Fondo pensione'])}</span>
                  <span className="text-gray-400">Var. mese</span>
                  <span className={`font-mono tabular-nums text-right font-medium ${varTone}`}>{varAssoluta == null ? '–' : segnoVar(varAssoluta)}</span>
                  <span className="text-gray-400">Plus/minus</span>
                  <span className={`font-mono tabular-nums text-right font-medium ${plusMinusTone}`}>
                    {row['Plus/minus'] == null ? 'N/D' : segnoVar(row['Plus/minus'])}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <InfoBox title="Come leggere il riepilogo">
          <p><strong>Var. / Var. %</strong>: variazione del patrimonio totale rispetto al mese precedente.</p>
          <p>
            <strong>Plus/minus</strong>: <span className="text-green-700 font-medium">verde</span> se positivo e in crescita,{' '}
            <span className="text-amber-600 font-medium">giallo</span> se positivo ma in calo rispetto al mese prima,{' '}
            <span className="text-red-700 font-medium">rosso</span> se negativo. N/D nei mesi senza snapshot registrato.
          </p>
          <p>Il mese o la colonna evidenziati sono quelli da cui hai aperto il pannello.</p>
        </InfoBox>
      </div>
    </Drawer>
  )
}
