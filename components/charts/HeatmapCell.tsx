'use client'

interface HeatmapCellProps {
  value: number
  max: number
  isPositive: boolean
  format?: (n: number) => string
  className?: string
}

// ----- PALETTE COLORI (modifica qui i colori esadecimali) -----
const POSITIVE_LIGHT = '#f0faf0'   // colore per valori minimi (quasi bianco)
const POSITIVE_DARK = '#9ac37c'    // colore per valori massimi (verde)
const NEGATIVE_LIGHT = '#faf0f0'   // colore per valori minimi (quasi bianco)
const NEGATIVE_DARK = '#eda7a7'    // colore per valori massimi (rosso)

// Funzione per convertire hex in RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { r: 0, g: 0, b: 0 }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  }
}

// Interpola tra due colori RGB
function interpolateRgb(
  color1: { r: number; g: number; b: number },
  color2: { r: number; g: number; b: number },
  t: number
): string {
  const r = Math.round(color1.r + (color2.r - color1.r) * t)
  const g = Math.round(color1.g + (color2.g - color1.g) * t)
  const b = Math.round(color1.b + (color2.b - color1.b) * t)
  return `rgb(${r},${g},${b})`
}

function getHeatColor(ratio: number, isPositive: boolean): string {
  if (ratio === 0) return 'transparent'

  const intensity = Math.min(ratio, 1)

  const light = isPositive ? POSITIVE_LIGHT : NEGATIVE_LIGHT
  const dark = isPositive ? POSITIVE_DARK : NEGATIVE_DARK

  const rgbLight = hexToRgb(light)
  const rgbDark = hexToRgb(dark)

  return interpolateRgb(rgbLight, rgbDark, intensity)
}

function getTextColor(ratio: number, isPositive: boolean): string {
  if (ratio === 0) return '#9ca3af'
  const intensity = ratio
  if (isPositive) {
    return intensity > 0.6 ? '#033617' : '#166534'
  } else {
    return intensity > 0.6 ? '#710505' : '#991b1b'
  }
}

export function HeatmapCell({
  value,
  max,
  isPositive,
  format,
  className = '',
}: HeatmapCellProps) {
  const ratio = max > 0 ? value / max : 0
  const bg = getHeatColor(ratio, isPositive)
  const color = getTextColor(ratio, isPositive)
  const fmt = format ?? ((n: number) =>
    n === 0 ? '–' : `€${n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  )

  return (
    <td
      style={{ backgroundColor: bg, color, transition: 'background-color 0.2s' }}
      className={`px-3 py-1.5 text-right text-xs font-medium tabular-nums whitespace-nowrap border-b border-surface-200/50 ${className}`}
    >
      {fmt(value)}
    </td>
  )
}