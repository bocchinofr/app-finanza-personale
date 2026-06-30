'use client'
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { parseMovimentiSheet } from '@/lib/parseXlsx'
import { parseMovimentiCsv } from '@/lib/parseGoogleSheet'
import { Movimento } from '@/types'

type Status = 'idle' | 'fetching' | 'parsing' | 'saving' | 'done' | 'error'

export default function UploadPage() {
  const [dragging, setDragging]   = useState(false)
  const [status, setStatus]       = useState<Status>('idle')
  const [message, setMessage]     = useState('')
  const [anno, setAnno]           = useState(new Date().getFullYear())
  const supabase = createClient()

  async function saveToDb(movimenti: Movimento[]) {
    setStatus('saving')
    setMessage(`Trovati ${movimenti.length} movimenti. Salvataggio…`)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Non autenticato')

    await supabase.from('movimenti').delete().eq('user_id', user.id).eq('anno', anno)

    const rows = movimenti.map(m => ({ ...m, user_id: user.id }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('movimenti').insert(rows.slice(i, i + 500))
      if (error) throw error
    }

    setStatus('done')
    setMessage(`✓ ${movimenti.length} movimenti importati per l'anno ${anno}`)
  }

  // ---- From Google Sheets ----
  async function syncGoogleSheets() {
    setStatus('fetching')
    setMessage('Recupero dati da Google Sheets…')
    try {
      const res = await fetch(`/api/sync-sheets?sheet=movimenti%20conto`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const csv = await res.text()

      setStatus('parsing')
      setMessage('Analisi del foglio…')
      const movimenti = parseMovimentiCsv(csv, anno)
      if (movimenti.length === 0) throw new Error('Nessun movimento trovato nel foglio. Verifica che il foglio sia condiviso pubblicamente.')

      await saveToDb(movimenti)
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore durante la sincronizzazione')
    }
  }

  // ---- From file upload ----
  async function processFile(file: File) {
    if (!file.name.endsWith('.xlsx')) {
      setStatus('error'); setMessage('Carica un file .xlsx'); return
    }
    setStatus('parsing')
    setMessage('Lettura del file…')
    try {
      const buffer = await file.arrayBuffer()
      const movimenti = parseMovimentiSheet(buffer, anno)
      await saveToDb(movimenti)
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore durante l\'importazione')
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [anno])

  const isLoading = ['fetching','parsing','saving'].includes(status)

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Importa dati</h1>
      <p className="text-sm text-gray-500 mb-6">
        Scegli come caricare i movimenti. I dati esistenti per l'anno selezionato verranno sostituiti.
      </p>

      {/* Anno */}
      <div className="card mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1">Anno di riferimento</label>
        <select value={anno} onChange={e => setAnno(Number(e.target.value))} className="input w-32">
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Google Sheets sync */}
      <div className="card mb-4 border-brand-200 bg-brand-50">
        <div className="flex items-start gap-3">
          <div className="text-2xl mt-0.5">📊</div>
          <div className="flex-1">
            <p className="text-sm font-medium text-brand-900 mb-0.5">Sincronizza da Google Sheets</p>
            <p className="text-xs text-brand-700 mb-3">
              Legge direttamente il foglio condiviso. Nessun file da scaricare.
            </p>
            <button
              onClick={syncGoogleSheets}
              disabled={isLoading}
              className="btn-primary text-sm"
            >
              {isLoading && status === 'fetching' ? '⟳ Recupero…' : 'Sincronizza ora'}
            </button>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-surface-200" />
        <span className="text-xs text-gray-400">oppure carica un file</span>
        <div className="flex-1 h-px bg-surface-200" />
      </div>

      {/* File drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors
          ${dragging ? 'border-brand-400 bg-brand-50' : 'border-surface-300 bg-white hover:border-surface-400'}`}
      >
        <div className="text-3xl mb-2">📄</div>
        <p className="text-sm font-medium text-gray-700 mb-1">Trascina il file .xlsx</p>
        <p className="text-xs text-gray-400 mb-4">oppure</p>
        <label className="btn-secondary cursor-pointer inline-block text-sm">
          Scegli file
          <input type="file" accept=".xlsx" className="hidden" onChange={e => {
            const f = e.target.files?.[0]; if (f) processFile(f)
          }} />
        </label>
      </div>

      {/* Status message */}
      {message && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-sm flex items-center gap-2
          ${status === 'done'  ? 'bg-green-50 text-green-700' :
            status === 'error' ? 'bg-red-50 text-red-600' :
            'bg-blue-50 text-blue-700'}`}>
          {isLoading && <span className="animate-spin text-base">⟳</span>}
          {message}
        </div>
      )}

      {status === 'done' && (
        <div className="mt-3 text-center">
          <a href="/dashboard" className="text-sm text-brand-600 hover:underline">
            → Vai alla dashboard
          </a>
        </div>
      )}

      {/* Info box */}
      <div className="mt-6 card bg-surface-50 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-600 mb-2">Struttura attesa del foglio</p>
        <p>• Foglio: <code className="bg-surface-200 px-1 rounded">movimenti conto</code></p>
        <p>• Colonne: MESE · Data operazione · Descrizione · Entrate · Uscite · CATEGORIA · SOTTOCATEGORIA · nome ETF</p>
        <p>• Due tabelle nel foglio (persona G e persona F), separate da righe vuote con intestazione ripetuta</p>
      </div>
    </div>
  )
}
