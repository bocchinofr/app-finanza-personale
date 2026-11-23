// components/ui/KpiCard.tsx
// Card KPI uniforme: etichetta, numero, chip di variazione, trend (sparkline)
// e mini box di dettaglio opzionali. Cliccabile se riceve onClick.
'use client'

import type { ReactNode } from 'react'
import { IconArrowUp, IconArrowDown } from './Icons'

export function fmtEuro(n: number) {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
export const fmtSigned = (n: number) => `${n >= 0 ? '+' : '−'}${fmtEuro(Math.abs(n))}`
export const fmtPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')}%`

export type Delta = { value: number; pct: number | null } | null | undefined
export type Tone = 'neutral' | 'positive' | 'negative' | 'warning'

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-gray-900',
  positive: 'text-green-700',
  negative: 'text-red-700',
  warning: 'text-amber-600',
}

/** Chip colorato con la variazione rispetto al periodo precedente. */
export function DeltaChip({ delta }: { delta: Delta }) {
  if (!delta) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-100 text-gray-400 text-[11px] font-medium px-2 py-0.5">
        N/D
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
      {delta.pct != null && <span className="font-medium opacity-75">· {fmtPct(delta.pct)}</span>}
    </span>
  )
}

/** Mini grafico di trend a tutta larghezza (nessuna dipendenza). */
export function Sparkline({ values, color = '#3f6b4f', height = 28 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} />
  const w = 100, pad = 2
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = height - pad - ((v - min) / span) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="block">
      <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={color} opacity={0.1} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round"
                strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Riquadro secondario con un dettaglio del KPI. */
export function MiniStat({
  label, value, sub, tone = 'neutral',
}: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-lg bg-surface-50 border border-surface-100 px-3 py-1.5 min-w-0">
      <p className="text-[11px] text-gray-500 truncate">{label}</p>
      <p className={`flex items-baseline gap-1.5 ${TONE_TEXT[tone]}`}>
        <span className="text-[13px] font-semibold font-mono tabular-nums">{value}</span>
        {sub && <span className="text-[11px] font-medium opacity-80">{sub}</span>}
      </p>
    </div>
  )
}

export type MiniDef = { label: string; value: string; sub?: string; tone?: Tone }

export default function KpiCard({
  label, value, color, tone = 'neutral', delta, spark, minis, footnote, onClick, className = '',
}: {
  label: string
  value: string
  /** colore della categoria (stesso del grafico) */
  color: string
  tone?: Tone
  delta: Delta
  spark?: number[]
  minis?: MiniDef[]
  footnote?: ReactNode
  onClick?: () => void
  className?: string
}) {
  const body = (
    <>
      <p className="flex items-center gap-2 text-[13px] font-medium text-gray-600">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </p>
      <p className={`num-display text-2xl font-semibold leading-none mt-2.5 ${TONE_TEXT[tone]}`}>{value}</p>
      <div className="mt-2.5"><DeltaChip delta={delta} /></div>
      {spark && <div className="mt-3"><Sparkline values={spark} color={color} /></div>}
      {minis && minis.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {minis.map(m => <MiniStat key={m.label} {...m} />)}
        </div>
      )}
      {footnote && <div className="mt-2 text-[11px] text-amber-600 leading-snug">{footnote}</div>}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card text-left w-full hover:border-brand-200 hover:shadow-sm transition-all ${className}`}
      >
        {body}
      </button>
    )
  }
  return <div className={`card ${className}`}>{body}</div>
}
