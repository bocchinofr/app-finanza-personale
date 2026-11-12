// components/portfolio/ComposizioneEditor.tsx
'use client'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ComposizioneEtf, VocePeso, parseIncolla } from '@/lib/portfolioLookthrough'
import { normalizzaSettore, normalizzaPaese } from '@/lib/normalizzaNomi'

interface Props {
  etfNome: string
  iniziale: ComposizioneEtf | null
  saving: boolean
  onClose: () => void
  onSave: (dati: { top_holdings: VocePeso[]; settori: VocePeso[]; paesi: VocePeso[] }) => void
}

const aTesto = (v: VocePeso[] | undefined) =>
  (v ?? []).map(x => `${x.nome}\t${String(x.peso).replace('.', ',')}%`).join('\n')

function Blocco({
  titolo, aiuto, valore, onChange, attesaMax, tipo,
}: {
  titolo: string; aiuto: string; valore: string; onChange: (v: string) => void; attesaMax: number
  tipo?: 'settori' | 'paesi'
}) {
  const p = useMemo(() => parseIncolla(valore), [valore])
  // Anteprima unificazione nomi: solo righe cambiate e righe non riconosciute.
  const nomi = useMemo(() => {
    if (!tipo) return { cambiati: [] as [string, string][], ignoti: [] as string[] }
    const norm = tipo === 'settori' ? normalizzaSettore : normalizzaPaese
    const cambiati: [string, string][] = []
    const ignoti: string[] = []
    for (const v of p.voci) {
      const r = norm(v.nome)
      if (!r.riconosciuto) ignoti.push(r.nome)
      else if (r.nome !== v.nome.trim()) cambiati.push([v.nome.trim(), r.nome])
    }
    return { cambiati, ignoti }
  }, [p.voci, tipo])
  const troppoAlta = p.somma > 100.5
  const eccesso = p.voci.length > attesaMax
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-semibold text-gray-800">{titolo}</label>
        <span className="text-[11px] text-gray-400">{aiuto}</span>
      </div>
      <textarea
        value={valore}
        onChange={e => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={'Apple Inc\t7,10%\nMicrosoft Corp\t6,50%'}
        className="input font-mono text-xs leading-relaxed resize-y"
      />
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="text-gray-500">
          Riconosciute: <strong className="tabular-nums">{p.voci.length}</strong>
          {p.voci.length > 0 && <> · somma <strong className="tabular-nums">{p.somma.toFixed(2).replace('.', ',')}%</strong></>}
        </span>
        {p.scartate.length > 0 && (
          <span className="text-amber-700" title={p.scartate.join(' | ')}>
            {p.scartate.length} righe ignorate (senza peso)
          </span>
        )}
        {troppoAlta && <span className="text-red-600 font-medium">Somma oltre 100%: controlla i pesi</span>}
        {eccesso && !troppoAlta && <span className="text-gray-400">Più voci del previsto: va bene, vengono salvate tutte</span>}
      </div>
      {nomi.cambiati.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">
          <span className="text-gray-400">Nomi unificati: </span>
          {nomi.cambiati.map(([da, a], i) => (
            <span key={da + i} className="whitespace-nowrap">
              {i > 0 && ' · '}{da} <span className="text-gray-300">→</span> <strong className="font-medium text-gray-700">{a}</strong>
            </span>
          ))}
        </p>
      )}
      {nomi.ignoti.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-700 leading-relaxed">
          Nome non riconosciuto, resta com&apos;è e potrebbe creare una voce doppia: {nomi.ignoti.join(', ')}
        </p>
      )}
    </div>
  )
}

export default function ComposizioneEditor({ etfNome, iniziale, saving, onClose, onSave }: Props) {
  const [holdings, setHoldings] = useState(aTesto(iniziale?.top_holdings))
  const [settori, setSettori] = useState(aTesto(iniziale?.settori))
  const [paesi, setPaesi] = useState(aTesto(iniziale?.paesi))

  const ph = useMemo(() => parseIncolla(holdings), [holdings])
  const ps = useMemo(() => parseIncolla(settori), [settori])
  const pp = useMemo(() => parseIncolla(paesi), [paesi])
  const bloccato = ph.somma > 100.5 || ps.somma > 100.5 || pp.somma > 100.5
  const vuoto = ph.voci.length + ps.voci.length + pp.voci.length === 0

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Composizione ETF</h3>
            <p className="text-xs text-gray-500">{etfNome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
        </div>
        <p className="text-[11px] text-gray-400 mb-4">
          Incolla da justETF o dal sito dell&apos;emittente. Nome e peso sulla stessa riga o su righe consecutive.
          Nessun dato viene completato o stimato.
        </p>

        <div className="space-y-4">
          <Blocco titolo="Prime partecipazioni" aiuto="di solito le prime 10" valore={holdings} onChange={setHoldings} attesaMax={10} />
          <Blocco titolo="Settori" aiuto="tutte le righe disponibili" valore={settori} onChange={setSettori} attesaMax={12} tipo="settori" />
          <Blocco titolo="Paesi" aiuto="almeno i primi 5-8" valore={paesi} onChange={setPaesi} attesaMax={15} tipo="paesi" />
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Annulla</button>
          <button
            disabled={saving || bloccato || vuoto}
            onClick={() => onSave({ top_holdings: ph.voci, settori: ps.voci, paesi: pp.voci })}
            className="btn-primary text-sm"
          >
            {saving ? 'Salvo…' : 'Salva composizione'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
