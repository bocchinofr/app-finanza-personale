'use client'
import { useState } from 'react'

// Info box dell'Anagrafica: spiega solo a cosa servono le soglie inserite lì.
export default function InfoSoglieModal() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="A cosa servono le soglie"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[11px] font-semibold hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        i
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">A cosa servono le soglie</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1" aria-label="Chiudi">✕</button>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Le soglie ti <strong className="text-gray-800">avvisano</strong> quando un asset scende troppo. Non comprano né vendono nulla: l&apos;avviso arriva in app e via mail.
            </p>

            <ul className="mt-3 space-y-2">
              <li className="rounded-lg bg-surface-50 ring-1 ring-surface-200 p-3 text-xs text-gray-600 leading-relaxed">
                <strong className="text-gray-800">Max %</strong>: avviso quando il prezzo è sceso di almeno quella % dal suo massimo. Es. 10 → avviso a −10% o peggio.
              </li>
              <li className="rounded-lg bg-surface-50 ring-1 ring-surface-200 p-3 text-xs text-gray-600 leading-relaxed">
                <strong className="text-gray-800">Mese %</strong>: stesso avviso, ma rispetto a circa 30 giorni fa.
              </li>
            </ul>

            <p className="mt-3 text-xs text-gray-500 leading-relaxed">
              Per gli asset nel <strong className="text-gray-700">Piano di accumulo</strong> la soglia Max % è sostituita dalle tranche del piano, dove decidi anche quanto investire. Resta solo la soglia Mese %, come semplice avviso.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
