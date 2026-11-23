// components/ui/KpiCard.tsx
// Card KPI: numero principale, chip di variazione ben visibile, sparkline di trend
// e "mini box" per i dettagli. Se riceve onClick diventa cliccabile (apre un dettaglio).
'use client'

import type { ReactNode } from 'react'
import { IconArrowUp, IconArrowDown, IconChevronRight } from './Icons'

export function fmtEuro(n: number) {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
const fmtSigned = (n: number) => `${n >= 0 ? '+' : '−'}${fmtEuro(Math.abs(n))}`
const fmtPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')}%`

export type Delta = { value: number; pct: number | null } | null | undefined
export type Tone = 'neutral' | 'positive' | 'negative' | 'warning'

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-gray-900',
  positive: 'text-green-700',
  negative: 'text-red-700',
  warning: 'text-amber-600',
}

/** Chip colorato con la variazione vs periodo precedente. */
export function DeltaChip({ delta, label = 'vs mese prec.' }: { delta: Delta; label?: string }) {
  if (!delta) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-100 text-gray-400 text-[11px] font-medium px-2 py-0.5">
        N/D {label}
      </span>
    )
  }
  const up = delta.value >= 0
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap ${
        up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {up ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
      {fmtSigned(delta.value)}
      {delta.pct != null && <span className="font-medium opacity-80">· {fmtPct(delta.pct)}</span>}
      <span className="font-normal opacity-60">{label}</span>
    </span>
  )
}

/** Mini grafico di trend (nessuna dipendenza). */
export function Sparkline({ values, color = '#3f6b4f' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const w = 96, h = 32, pad = 2
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return [x, y] as const
  })
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${pad},${h} ${line} ${w - pad},${h}`
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.2} fill={color} />
    </svg>
  )
}

/** Riquadro secondario sotto il KPI principale. */
export function MiniStat({
  label, value, sub, tone = 'neutral',
}: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-lg bg-surface-50 border border-surface-100 px-3 py-2 min-w-0">
      <p className="text-[11px] text-gray-500 truncate">{label}</p>
      <p className={`text-sm font-semibold font-mono tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
      {sub && <p className={`text-[11px] font-medium ${TONE_TEXT[tone === 'neutral' ? 'neutral' : tone]} opacity-80`}>{sub}</p>}
    </div>
  )
}

export default function KpiCard({
  label, value, color, delta, spark, footnote, onClick,
}: {
  label: string
  value: string
  /** colore della categoria (stesso del grafico): pallino accanto all'etichetta + sparkline */
  color: string
  delta: Delta
  spark?: number[]
  footnote?: ReactNode
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-medium text-gray-600">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </p>
        {onClick && <IconChevronRight size={16} className="text-gray-300 group-hover:text-brand-600 transition-colors" />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="num-display text-2xl font-semibold text-gray-900 leading-none">{value}</p>
        {spark && <Sparkline values={spark} color={color} />}
      </div>
      <div className="mt-2.5"><DeltaChip delta={delta} /></div>
      {footnote && <div className="mt-2 text-[11px] text-amber-600 leading-snug">{footnote}</div>}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card group text-left w-full hover:border-brand-200 hover:shadow-sm transition-all"
      >
        {body}
      </button>
    )
  }
  return <div className="card">{body}</div>
}
