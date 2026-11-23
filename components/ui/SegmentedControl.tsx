// components/ui/SegmentedControl.tsx
// Selettore a pillole (tab / toggle) riusabile: es. Mensile | Annuale, € | %.
'use client'

export default function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex items-center rounded-full bg-surface-100 p-0.5 text-xs shrink-0">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-full font-medium transition-colors ${
            value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
