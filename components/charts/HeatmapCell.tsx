'use client'

interface HeatmapCellProps {
  value: number
  max: number
  isPositive: boolean
  format?: (n: number) => string
}

function getHeatColor(ratio: number, isPositive: boolean): string {
  if (ratio === 0) return 'transparent'
  const intensity = Math.min(ratio, 1)

  if (isPositive) {
    // Green scale: very light to saturated green
    const r = Math.round(234 - intensity * 100)
    const g = Math.round(243 - intensity * 50)
    const b = Math.round(222 - intensity * 130)
    return `rgb(${r},${g},${b})`
  } else {
    // Red scale: very light to saturated red
    const r = Math.round(252 - intensity * 30)
    const g = Math.round(235 - intensity * 130)
    const b = Math.round(235 - intensity * 130)
    return `rgb(${r},${g},${b})`
  }
}

function getTextColor(ratio: number, isPositive: boolean): string {
  if (ratio === 0) return '#9ca3af'
  const intensity = ratio
  if (isPositive) {
    return intensity > 0.5 ? '#14532d' : '#166534'
  } else {
    return intensity > 0.5 ? '#7f1d1d' : '#991b1b'
  }
}

export function HeatmapCell({ value, max, isPositive, format }: HeatmapCellProps) {
  const ratio = max > 0 ? value / max : 0
  const bg = getHeatColor(ratio, isPositive)
  const color = getTextColor(ratio, isPositive)
  const fmt = format ?? ((n: number) => n === 0 ? '–' : `€${n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)

  return (
    <td
      style={{ backgroundColor: bg, color, transition: 'background-color 0.2s' }}
      className="px-3 py-1.5 text-right text-xs font-medium tabular-nums whitespace-nowrap border-b border-white"
    >
      {fmt(value)}
    </td>
  )
}
