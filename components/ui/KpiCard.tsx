// components/ui/KpiCard.tsx
// Card KPI uniforme: etichetta, numero, chip di variazione, trend (sparkline)
// e mini box di dettaglio opzionali. Cliccabile se riceve onClick.
'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { IconArrowUp, IconArrowDown, IconChevronRight } from './Icons'

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

function pillClass(tone: Tone) {
  return tone === 'positive' ? 'bg-green-50 text-green-700'
    : tone === 'negative' ? 'bg-red-50 text-red-700'
    : 'bg-surface-100 text-gray-500'
}

/** Dettaglio in linea (versione compatta): etichetta, valore e pillola % sulla stessa riga. */
function MiniInline({ label, value, sub, tone = 'neutral' }: MiniDef) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-[12px]">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold font-mono tabular-nums ${TONE_TEXT[tone]}`}>{value}</span>
      {sub && <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${pillClass(tone)}`}>{sub}</span>}
    </span>
  )
}

export type MiniDef = { label: string; value: string; sub?: string; tone?: Tone }

/** Riga di dettaglio sotto il KPI: etichetta + pillola %, valore sotto. Leggera, senza riquadri. */
function MiniRow({ label, value, sub, tone = 'neutral' }: MiniDef) {
  const pill =
    tone === 'positive' ? 'bg-green-50 text-green-700'
    : tone === 'negative' ? 'bg-red-50 text-red-700'
    : 'bg-surface-100 text-gray-500'
  return (
    <div className="py-2 border-b border-surface-100 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-gray-500 truncate">{label}</span>
        {sub && <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${pill}`}>{sub}</span>}
      </div>
      <p className={`mt-0.5 text-[13px] font-semibold font-mono tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
    </div>
  )
}

export type KpiVariant = 'default' | 'featured' | 'compact'

export default function KpiCard({
  label, value, color, tone = 'neutral', delta, badge, spark, minis, footnote, onClick, href, cta,
  variant = 'default', headerRight, extra, minisInRow = false, className = '',
}: {
  label: string
  value: string
  /** colore della categoria (stesso del grafico) */
  color: string
  tone?: Tone
  delta: Delta
  /** al posto del chip di variazione (es. KPI non in €) */
  badge?: ReactNode
  spark?: number[]
  minis?: MiniDef[]
  footnote?: ReactNode
  onClick?: () => void
  /** se presente la card è un link a un'altra sezione (con cta come etichetta) */
  href?: string
  cta?: string
  /** default = verticale; featured = in evidenza (numero grande + trend a lato); compact = tile bassa */
  variant?: KpiVariant
  /** contenuto in alto a destra (variant featured), es. data di aggiornamento e info */
  headerRight?: ReactNode
  /** contenuto in fondo alla card (variant featured), es. barra di composizione */
  extra?: ReactNode
  /** variant default: dettagli affiancati su due colonne */
  minisInRow?: boolean
  className?: string
}) {
  const chip = badge ?? <DeltaChip delta={delta} />
  const dot = <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
  const warn = footnote ? <div className="mt-2 text-[11px] text-amber-600 leading-snug">{footnote}</div> : null
  const link = href ? (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand-700 group-hover:underline whitespace-nowrap">
      {cta ?? 'Apri sezione'} <IconChevronRight size={12} />
    </span>
  ) : null

  let body: ReactNode
  if (variant === 'featured') {
    body = (
      <>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-600">{dot}{label}</p>
          {headerRight && <div className="flex items-center gap-1.5 text-[11px] text-gray-400">{headerRight}</div>}
        </div>
        <div className="mt-2.5 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <p className={`num-display text-3xl 2xl:text-4xl font-semibold leading-none ${TONE_TEXT[tone]}`}>{value}</p>
            <div className="mt-2.5">{chip}</div>
          </div>
          {spark && <div className="w-32 sm:w-56 2xl:w-72 pb-0.5"><Sparkline values={spark} color={color} height={52} /></div>}
        </div>
        {extra && <div className="mt-4">{extra}</div>}
        {warn}
      </>
    )
  } else if (variant === 'compact') {
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="flex items-center gap-2 text-[13px] font-medium text-gray-600 min-w-0">{dot}<span className="truncate">{label}</span></p>
          <div className="shrink-0">{chip}</div>
        </div>
        <div className="mt-1.5 flex items-end justify-between gap-3">
          <p className={`num-display text-2xl font-semibold leading-none ${TONE_TEXT[tone]}`}>{value}</p>
          {link}
        </div>
        {minis && minis.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-surface-100 flex flex-wrap gap-x-5 gap-y-1">
            {minis.map(m => <MiniInline key={m.label} {...m} />)}
          </div>
        )}
        {warn}
      </>
    )
  } else {
    body = (
      <>
        <p className="flex items-center gap-2 text-[13px] font-medium text-gray-600">{dot}<span className="truncate">{label}</span></p>
        <p className={`num-display text-2xl font-semibold leading-none mt-2.5 ${TONE_TEXT[tone]}`}>{value}</p>
        <div className="mt-2.5">{chip}</div>
        {spark && <div className="mt-3"><Sparkline values={spark} color={color} /></div>}
        {minis && minis.length > 0 && (
          <div className={`mt-2 border-t border-surface-100 ${minisInRow ? 'grid grid-cols-2 gap-x-4 [&>div]:border-b-0' : ''}`}>
            {minis.map(m => <MiniRow key={m.label} {...m} />)}
          </div>
        )}
        {warn}
        {link && <p className="mt-3">{link}</p>}
      </>
    )
  }

  const pad = variant === 'compact' ? '!p-4 h-full' : ''
  if (href) {
    return (
      <Link href={href} className={`card group block text-left hover:border-brand-200 hover:shadow-sm transition-all ${pad} ${className}`}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card text-left w-full hover:border-brand-200 hover:shadow-sm transition-all ${pad} ${className}`}
      >
        {body}
      </button>
    )
  }
  return <div className={`card ${pad} ${className}`}>{body}</div>
}
