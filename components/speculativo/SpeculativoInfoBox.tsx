// components/speculativo/SpeculativoInfoBox.tsx
'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function SpeculativoInfoBox() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il pannello Speculativo"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[11px] font-semibold hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        i
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Come funziona questo pannello</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
            </div>

            <div className="space-y-4 text-xs text-gray-600 leading-relaxed">
              <div>
                <p className="font-semibold text-gray-800 mb-1">A cosa serve</p>
                <p>
                  Ti aiuta a decidere quanto capitale usare per una posizione short di breve periodo (settimane o
                  mesi), finanziata solo con capitale libero, senza toccare i long di lungo termine. Mostra cosa
                  succede al patrimonio se la posizione va in stop o in target.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Quanto allocare</p>
                <p>
                  L&apos;importo suggerito è il <strong>più basso</strong> tra due limiti. Limite di rischio: perdita
                  massima accettata (% del patrimonio totale) divisa per la distanza dello stop. Limite di capitale:
                  quota massima del capitale disponibile che accetti di usare. L&apos;etichetta indica quale dei due
                  sta limitando. Lo slider ti permette di provare importi diversi: i segni sulla barra indicano i due limiti, il più basso è il suggerito.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Paniere long</p>
                <p>
                  Sono gli asset dei tuoi long usati per stimare correlazione, beta e effetto sul patrimonio. Di
                  default sono gli asset classificati come azionari (se non ce ne sono, tutti). Puoi sceglierli tu:
                  dopo ogni modifica premi di nuovo Analizza. Gli asset senza ticker contano nel valore ma non nella
                  correlazione.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Capitale disponibile</p>
                <p>
                  Puoi scegliere la riserva di accumulo (asset e conti svincolati), la liquidità totale oppure
                  entrambe. Usare questo capitale significa rinviare acquisti long: la percentuale usata ti mostra
                  quanto accumulo viene sottratto.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Scenari Stop / Neutro / Target</p>
                <p>
                  Stop e target sono movimenti della posizione contro o a favore di te. Per stimare cosa fanno nel
                  frattempo i tuoi long si usa il <strong>beta storico a 1 anno</strong> della posizione rispetto al
                  paniere dei tuoi long azionari: per esempio, se la posizione perde il 10% e il beta è circa -1, i
                  long avrebbero guadagnato circa il 10%. Sono stime coerenti con lo storico, non previsioni.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Affidabilità della copertura</p>
                <p>
                  Il badge usa la correlazione giornaliera a 1 anno tra la posizione e i tuoi long. Una singola
                  azione short ha spesso correlazione imperfetta: lo stop può scattare mentre i long non salgono
                  (o il contrario). Se il beta è troppo vicino a zero lo scenario sui long non viene stimato.
                  Gli ETF inversi ricalcolano ogni giorno: su settimane o mesi di mercato laterale e volatile il
                  rendimento può discostarsi da quello atteso.
                </p>
              </div>

              <div className="bg-surface-50 rounded-lg p-3">
                <p className="font-semibold text-gray-800 mb-1">Cosa non considera</p>
                <p>
                  Gap di prezzo oltre lo stop, commissioni e costi di finanziamento (trascurabili secondo le tue
                  impostazioni), effetto cambio. La nota fiscale è solo un promemoria generale: verifica sempre con
                  il tuo commercialista.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
