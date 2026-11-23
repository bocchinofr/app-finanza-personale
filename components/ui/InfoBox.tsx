// components/ui/InfoBox.tsx
// Info box espandibile: spiega come si legge un pannello senza occupare spazio.
'use client'

import { useState, type ReactNode } from 'react'
import { IconInfo, IconChevronDown } from './Icons'

export default function InfoBox({ title = 'Come si legge', children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-gray-500 hover:text-brand-700 transition-colors"
      >
        <IconInfo size={14} />
        <span className="font-medium">{title}</span>
        <IconChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="panel-in mt-2 rounded-lg bg-brand-50/60 border border-brand-100 px-3 py-2.5 text-[12px] leading-relaxed text-gray-600 space-y-1.5">
          {children}
        </div>
      )}
    </div>
  )
}
