'use client'
import { useState } from 'react'

interface Props {
  ddMax: number
  frazioneAPmc?: number // non più usato (mantenuto per compatibilità)
}

export default function InfoAccumuloModal({ ddMax }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il calcolo dell'investimento consigliato"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[11px] font-semibold hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        i
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Quanto investire sui ribassi</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
            </div>

            <ol className="space-y-3 text-xs text-gray-600 leading-relaxed list-decimal pl-4">
              <li>
                <strong className="text-gray-800">Budget.</strong> Liquidità e asset svincolati. Per ogni classe (azioni / obbligazioni)
                si usa al massimo quanto manca al tuo peso target, diviso in parti uguali tra gli ETF scattati.
              </li>
              <li>
                <strong className="text-gray-800">Quota sbloccata.</strong> Più l&apos;ETF scende dal massimo, più budget si sblocca:
                ribasso ÷ DD max ({Math.round(ddMax * 100)}%). A DD max si usa tutto il budget dell&apos;ETF.
              </li>
              <li>
                <strong className="text-gray-800">Limite PMC.</strong> Se l&apos;acquisto alzerebbe il PMC oltre il massimo che hai scelto,
                l&apos;importo viene ridotto. Sotto il PMC non c&apos;è limite: l&apos;acquisto lo abbassa.
              </li>
            </ol>

            <p className="text-xs text-gray-600 mt-3">
              ETF con la stessa soglia possono avere importi diversi perché cambiano ribasso, PMC e classe: la riga sotto ogni importo mostra il motivo.
            </p>
            <p className="text-[11px] text-gray-400 mt-3">
              Con più soglie sullo stesso asset l&apos;importo è uno solo (non si somma). È un suggerimento: decidi sempre tu.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
