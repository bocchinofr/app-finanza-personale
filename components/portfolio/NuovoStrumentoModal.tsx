// components/portfolio/NuovoStrumentoModal.tsx
'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { MetaStrumento } from '@/lib/portfolioLookthrough'

type Tipo = 'etf' | 'azione' | 'inverso1' | 'inverso2'

interface Props {
  etfReali: { id: string; nome: string }[]
  saving: boolean
  onClose: () => void
  onSave: (meta: MetaStrumento) => void
}

const num = (s: string) => Number(s.replace(',', '.')) || 0

export default function NuovoStrumentoModal({ etfReali, saving, onClose, onSave }: Props) {
  const [tipo, setTipo] = useState<Tipo>('etf')
  const [nome, setNome] = useState('')
  const [ticker, setTicker] = useState('')
  const [valuta, setValuta] = useState<'EUR' | 'USD'>('EUR')
  const [classe, setClasse] = useState<MetaStrumento['classe']>('azionario')
  const [riferimento, setRiferimento] = useState(etfReali[0]?.id ?? '')
  const [prezzo, setPrezzo] = useState('')
  const [stato, setStato] = useState<'idle' | 'loading' | 'errore'>('idle')

  const inverso = tipo === 'inverso1' || tipo === 'inverso2'
  const leva = tipo === 'inverso1' ? -1 : tipo === 'inverso2' ? -2 : 1

  function cambiaTipo(t: Tipo) {
    setTipo(t)
    if (t === 'inverso1' || t === 'inverso2') setClasse('altro')
    else if (t === 'azione') setClasse('azionario')
  }

  async function recuperaPrezzo() {
    if (!ticker.trim()) return
    setStato('loading')
    try {
      const simboli = valuta === 'USD' ? `${ticker.trim()},EURUSD=X` : ticker.trim()
      const res = await fetch(`/api/quote?tickers=${encodeURIComponent(simboli)}`)
      const j = res.ok ? await res.json() : {}
      const p: number | undefined = j[ticker.trim()]?.price
      const fx: number | undefined = j['EURUSD=X']?.price
      if (!p) throw new Error('prezzo non trovato')
      if (valuta === 'USD') {
        if (!fx) throw new Error('cambio non trovato')
        setPrezzo((p / fx).toFixed(2))
      } else {
        setPrezzo(p.toFixed(2))
      }
      setStato('idle')
    } catch {
      setStato('errore')
    }
  }

  const valido = nome.trim() && ticker.trim() && num(prezzo) > 0 && (!inverso || riferimento)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Nuovo strumento da simulare</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['etf', 'ETF'], ['azione', 'Azione singola'], ['inverso1', 'ETF inverso -1x'], ['inverso2', 'ETF inverso -2x'],
            ] as const).map(([k, l]) => (
              <button
                key={k} onClick={() => cambiaTipo(k)}
                className={`px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                  tipo === k ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-surface-200 text-gray-600 hover:bg-surface-50'}`}
              >{l}</button>
            ))}
          </div>

          <div>
            <label className="block text-gray-500 mb-1">Nome</label>
            <input className="input" value={nome} onChange={e => setNome(e.target.value)} placeholder={tipo === 'azione' ? 'Berkshire Hathaway' : 'Nome dello strumento'} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-gray-500 mb-1">Ticker Yahoo</label>
              <input className="input font-mono" value={ticker} onChange={e => setTicker(e.target.value)} placeholder={tipo === 'azione' ? 'BRK-B' : 'VWCE.DE'} />
            </div>
            <div>
              <label className="block text-gray-500 mb-1">Valuta</label>
              <select className="input" value={valuta} onChange={e => setValuta(e.target.value as 'EUR' | 'USD')}>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-500 mb-1">Classe</label>
              <select className="input" value={classe} onChange={e => setClasse(e.target.value as MetaStrumento['classe'])}>
                <option value="azionario">Azionario</option>
                <option value="obbligazionario">Obbligazionario</option>
                <option value="altro">Altro</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-500 mb-1">Prezzo in euro</label>
              <div className="flex gap-1.5">
                <input className="input font-mono" inputMode="decimal" value={prezzo} onChange={e => setPrezzo(e.target.value)} placeholder="0,00" />
                <button onClick={recuperaPrezzo} disabled={!ticker.trim() || stato === 'loading'} className="btn-secondary !px-2 text-xs shrink-0">
                  {stato === 'loading' ? '…' : 'Auto'}
                </button>
              </div>
            </div>
          </div>
          {stato === 'errore' && <p className="text-amber-700">Prezzo non trovato: controlla il ticker o inseriscilo a mano.</p>}

          {inverso && (
            <div>
              <label className="block text-gray-500 mb-1">Indice replicato (ETF di riferimento)</label>
              {etfReali.length === 0 ? (
                <p className="text-amber-700">Nessun ETF azionario nel portafoglio da usare come riferimento.</p>
              ) : (
                <select className="input" value={riferimento} onChange={e => setRiferimento(e.target.value)}>
                  {etfReali.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              )}
              <p className="text-[11px] text-gray-400 mt-1">
                Un ETF inverso sottrae esposizione: per il look-through uso la composizione dell&apos;ETF scelto, con segno negativo e leva {leva}x.
              </p>
            </div>
          )}

          {tipo === 'azione' && (
            <p className="text-[11px] text-gray-400">
              Per un&apos;azione singola la società è la stessa al 100%. Settore e paese li puoi inserire dopo con il pulsante Dati.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Annulla</button>
          <button
            disabled={saving || !valido}
            onClick={() => onSave({
              nome: nome.trim(), ticker: ticker.trim(), classe, leva,
              riferimentoId: inverso ? riferimento : null,
              prezzo: num(prezzo), valuta, azioneSingola: tipo === 'azione',
            })}
            className="btn-primary text-sm"
          >
            {saving ? 'Salvo…' : 'Aggiungi'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
