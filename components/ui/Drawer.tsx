// components/ui/Drawer.tsx
// Pannello a comparsa: laterale da destra su desktop, "bottom sheet" su mobile.
// Chiusura con Esc, clic sullo sfondo o pulsante. Blocca lo scroll della pagina sotto.
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './Icons'

export default function Drawer({
  open, onClose, title, subtitle, headerExtra, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  headerExtra?: ReactNode
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30 fade-in" onClick={onClose} />
      <div
        className="absolute bg-white shadow-2xl flex flex-col
                   max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[88vh] max-sm:rounded-t-2xl sheet-in
                   sm:top-0 sm:right-0 sm:h-full sm:w-full sm:max-w-3xl sm:border-l sm:border-surface-200 drawer-in"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-100 shrink-0">
          <div className="min-w-0">
            <h2 className="num-display text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-gray-500 hover:bg-surface-100 hover:text-gray-800 transition-colors"
          >
            <IconClose size={18} />
          </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
