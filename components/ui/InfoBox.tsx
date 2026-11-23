// components/ui/InfoBox.tsx
// Icona "i" con piccolo popup ancorato: spiega come si legge un pannello
// senza allungare la pagina. Si chiude con Esc, clic fuori o scroll.
'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconInfo } from './Icons'

export default function InfoBox({ title = 'Come si legge', children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // Calcola la posizione dopo il render del popup (serve l'altezza reale)
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const b = btnRef.current
    const p = popRef.current
    if (!b || !p) return
    const r = b.getBoundingClientRect()
    const w = p.offsetWidth
    const h = p.offsetHeight
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    const sotto = r.bottom + 8
    const top = sotto + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : sotto
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={title}
        aria-expanded={open}
        title={title}
        className={`h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-full transition-colors
          ${open ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-brand-700 hover:bg-brand-50'}`}
      >
        <IconInfo size={16} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={title}
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className="fixed z-[120] w-80 max-w-[calc(100vw-1rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-surface-200
                     bg-white shadow-xl p-3.5 text-[12px] leading-relaxed text-gray-600 space-y-1.5"
        >
          <p className="text-[13px] font-semibold text-gray-900">{title}</p>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
