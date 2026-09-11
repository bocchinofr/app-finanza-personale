'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

const CONTATTO_EMAIL = 'appfinanzapersonale.alert@gmail.com'

export default function ContactModal({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [copiato, setCopiato] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  async function copiaEmail() {
    try {
      await navigator.clipboard.writeText(CONTATTO_EMAIL)
      setCopiato(true)
      setTimeout(() => setCopiato(false), 2000)
    } catch {
      // clipboard non disponibile: l'utente può comunque selezionare il testo
    }
  }

  // Il modal va in un React Portal su document.body: la sidebar è
  // "position: fixed" e crea un proprio stacking context, che altrimenti
  // intrappola lo z-50 del modal facendolo apparire sotto al contenuto
  // della pagina (stesso problema risolto per NotificationBell).
  const modal = open && (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Contatti</h3>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Per segnalazioni, domande o assistenza sull&apos;app, scrivi a questo indirizzo:
        </p>

        <div className="flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-lg px-3 py-2.5">
          <span className="flex-1 text-sm font-medium text-gray-800 break-all">{CONTATTO_EMAIL}</span>
          <button
            onClick={copiaEmail}
            className="shrink-0 text-xs font-semibold text-brand-700 hover:text-brand-800 px-2 py-1 rounded-md hover:bg-brand-50 transition-colors"
          >
            {copiato ? '✓ Copiata' : 'Copia'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={compact
          ? 'text-[11px] font-medium text-brand-700 hover:underline'
          : 'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors'}
      >
        ✉ Contatti
      </button>

      {mounted && modal && createPortal(modal, document.body)}
    </>
  )
}
