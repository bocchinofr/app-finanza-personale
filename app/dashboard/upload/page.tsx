'use client'
import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { parseMovimentiSheet } from '@/lib/parseXlsx'
import { parseMovimentiCsv, parseLiquiditaCsv, parsePortafoglioCsv } from '@/lib/parseGoogleSheet'
import { Movimento } from '@/types'

type Status = 'idle' | 'fetching' | 'parsing' | 'saving' | 'done' | 'error'

async function fetchSheet(sheetId: string, sheetName: string): Promise<string> {
  const res = await fetch(`/api/sync-sheets?sheetId=${encodeURIComponent(sheetId)}&sheet=${encodeURIComponent(sheetName)}`)
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? `Errore HTTP ${res.status} per foglio "${sheetName}"`)
  }
  return res.text()
}

export default function UploadPage() {
  const [dragging, setDragging]       = useState(false)
  const [status, setStatus]           = useState<Status>('idle')
  const [message, setMessage]         = useState('')
  const [anno, setAnno]               = useState(new Date().getFullYear())
  const [sheetId, setSheetId]         = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setProfileLoading(false); return }
      const { data } = await supabase.from('profili').select('google_sheet_id').eq('user_id', user.id).single()
      setSheetId(data?.google_sheet_id ?? null)
      setProfileLoading(false)
    }
    loadProfile()
  }, [])

  async function saveMovimenti(movimenti: Movimento[], userId: string) {
    await supabase.from('movimenti').delete().eq('user_id', userId).eq('anno', anno)
    const rows = movimenti.map(m => ({ ...m, user_id: userId }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('movimenti').insert(rows.slice(i, i + 500))
      if (error) throw error
    }
  }

  async function syncGoogleSheets() {
    if (!sheetId) { setStatus('error'); setMessage('Nessun foglio collegato. Vai su Profilo.'); return }

    setStatus('fetching')
    setMessage('Recupero dati da Google Sheets…')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      // 1. Movimenti conto
      setMessage('Lettura movimenti conto…')
      const csvMovimenti = await fetchSheet(sheetId, 'Movimenti conto')
      const movimenti = parseMovimentiCsv(csvMovimenti, anno)
      if (movimenti.length === 0) throw new Error('Nessun movimento trovato nel foglio "Movimenti conto".')

      setStatus('saving')
      setMessage(`Salvataggio ${movimenti.length} movimenti…`)
      await saveMovimenti(movimenti, user.id)

      // 2. Liquidità (opzionale — non blocca se manca)
      let liquiditaCount = 0
      try {
        setMessage('Lettura liquidità…')
        const csvLiq = await fetchSheet(sheetId, 'Liquidità')
        const liquidita = parseLiquiditaCsv(csvLiq)
        if (liquidita.length > 0) {
          await supabase.from('liquidita').delete().eq('user_id', user.id).eq('anno', anno)
          const rows = liquidita.map(l => ({ ...l, user_id: user.id }))
          const { error } = await supabase.from('liquidita').insert(rows)
          if (error) throw error
          liquiditaCount = liquidita.length
        }
      } catch {
        // foglio Liquidità non presente o errore — non bloccante
      }

      // 3. Anagrafica Portafoglio (opzionale — non blocca se manca)
      let portafoglioCount = 0
      try {
        setMessage('Lettura portafoglio…')
        const csvPort = await fetchSheet(sheetId, 'Anagrafica Portafoglio')
        const portafoglio = parsePortafoglioCsv(csvPort)
        if (portafoglio.length > 0) {
          await supabase.from('portafoglio').delete().eq('user_id', user.id)
          const rows = portafoglio.map(p => ({ ...p, user_id: user.id }))
          const { error } = await supabase.from('portafoglio').insert(rows)
          if (error) throw error
          portafoglioCount = portafoglio.length
        }
      } catch {
        // foglio Portafoglio non presente o errore — non bloccante
      }

      setStatus('done')
      setMessage(
        `✓ Sincronizzazione completata — ${movimenti.length} movimenti` +
        (liquiditaCount > 0 ? `, ${liquiditaCount} righe liquidità` : '') +
        (portafoglioCount > 0 ? `, ${portafoglioCount} asset portafoglio` : '')
      )
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore durante la sincronizzazione')
    }
  }

  async function clearData() {
    if (!confirm(`Sei sicuro di voler cancellare tutti i movimenti del ${anno}?`)) return
    setStatus('saving')
    setMessage('Cancellazione in corso…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')
      await supabase.from('movimenti').delete().eq('user_id', user.id).eq('anno', anno)
      await supabase.from('liquidita').delete().eq('user_id', user.id).eq('anno', anno)
      setStatus('done')
      setMessage(`✓ Dati del ${anno} cancellati.`)
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore durante la cancellazione')
    }
  }

  async function processFile(file: File) {
    if (!file.name.endsWith('.xlsx')) { setStatus('error'); setMessage('Carica un file .xlsx'); return }
    setStatus('parsing'); setMessage('Lettura del file…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')
      const buffer = await file.arrayBuffer()
      const movimenti = parseMovimentiSheet(buffer, anno)
      setStatus('saving'); setMessage(`Trovati ${movimenti.length} movimenti. Salvataggio…`)
      await saveMovimenti(movimenti, user.id)
      setStatus('done'); setMessage(`✓ ${movimenti.length} movimenti importati per il ${anno}`)
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
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Importa dati</h1>
      <p className="text-sm text-gray-500 mb-6">
        Scegli come caricare i movimenti. I dati esistenti per l'anno selezionato verranno sostituiti.
      </p>

      {/* Griglia a 3 colonne */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">

        {/* Card 1: Anno + Google Sheets */}
        <div className="card space-y-4">
          <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <span className="text-base">📊</span> Sincronizzazione automatica
          </h2>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anno di riferimento</label>
            <select value={anno} onChange={e => setAnno(Number(e.target.value))} className="input w-full">
              {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
            </select>
          </div>

          <div className="pt-2 border-t border-surface-100">
            {profileLoading ? (
              <p className="text-xs text-gray-400">Caricamento profilo…</p>
            ) : sheetId ? (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  Legge il foglio collegato al tuo profilo. Sincronizza automaticamente:
                </p>
                <ul className="text-xs text-gray-500 mb-3 space-y-0.5 pl-3">
                  <li>• <strong>Movimenti conto</strong> (obbligatorio)</li>
                  <li>• <strong>Liquidità</strong> (opzionale)</li>
                  <li>• <strong>Anagrafica Portafoglio</strong> (opzionale)</li>
                </ul>
                <button onClick={syncGoogleSheets} disabled={isLoading} className="btn-primary text-sm w-full">
                  {isLoading && status === 'fetching' ? '⟳ Sincronizzazione…' : 'Sincronizza ora'}
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-500">
                Nessun foglio collegato.{' '}
                <a href="/dashboard/profilo" className="underline font-medium text-brand-600">Vai su Profilo</a> per impostarlo.
              </p>
            )}
          </div>
        </div>

        {/* Card 2: Upload file .xlsx */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors flex flex-col items-center justify-center
            ${dragging ? 'border-brand-400 bg-brand-50' : 'border-surface-300 bg-white hover:border-surface-400'}`}
        >
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm font-medium text-gray-700 mb-1">Carica file .xlsx</p>
          <p className="text-xs text-gray-400 mb-4">Trascina il file qui oppure</p>
          <label className="btn-secondary cursor-pointer inline-block text-sm">
            Scegli file
            <input type="file" accept=".xlsx" className="hidden" onChange={e => {
              const f = e.target.files?.[0]; if (f) processFile(f)
            }} />
          </label>
          <p className="text-xs text-gray-400 mt-3">
            Compatibile con il template Google Sheets
          </p>
        </div>

        {/* Card 3: Template info */}
        <div className="card space-y-4">
          <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <span className="text-base">📋</span> Non hai ancora un foglio?
          </h2>
          <p className="text-xs text-gray-500">
            Apri il template, fai <strong>File → Crea una copia</strong> per salvarlo sul tuo Google Drive,
            compilalo con i tuoi movimenti e incolla il link nella pagina Profilo.
          </p>
          <a
            href="https://docs.google.com/spreadsheets/d/1fLJoECuxa8bjYPAskzFi7RhRx6-O_1TWB_lmTHWBZ34"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs inline-block"
          >
            ↗ Apri template
          </a>
          <div className="pt-2 border-t border-surface-100">
            <p className="text-xs text-gray-400">
              Il foglio può contenere fino a 3 fogli:<br />
              <strong>Movimenti conto</strong> (obbligatorio), <strong>Liquidità</strong> e <strong>Anagrafica Portafoglio</strong> (opzionali).
            </p>
          </div>
        </div>
      </div>

      {/* Guida configurazione – collassabile con titolo più grande */}
      <details className="mt-6 card bg-surface-50">
        <summary className="text-sm font-semibold text-gray-700 cursor-pointer hover:text-brand-600 transition-colors">
          📖 Come configurare il tuo foglio Google
        </summary>
        <div className="space-y-3 pt-3 text-xs text-gray-500">
          
          <p>
            Il template contiene <strong className="text-gray-700">3 fogli</strong> che puoi compilare.
            Solo il foglio <strong className="text-gray-700">"Movimenti conto"</strong> è obbligatorio.
          </p>

          {/* Foglio 1: Movimenti conto */}
          <div className="bg-surface-50/50 rounded-lg p-3 space-y-1 border border-surface-200/50">
            <p className="font-medium text-gray-700 text-xs">📊 Foglio 1: Movimenti conto (obbligatorio)</p>
            <p className="text-gray-500">Contiene l'elenco di tutte le transazioni del conto.</p>
            <div className="space-y-0.5 pt-1">
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">MESE</code> — abbreviazione: gen, feb, mar…</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Data operazione</code> — formato GG/MM/AAAA</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Descrizione</code> — testo libero</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Entrate</code> / <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Uscite</code> — importo numerico senza simbolo €</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">CATEGORIA</code> — usa i valori dell'elenco nel template</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">COMPONENTE</code> — opzionale, es. "Giulia" o "Famiglia"</p>
            </div>
          </div>

          {/* Foglio 2: Liquidità */}
          <div className="bg-surface-50/50 rounded-lg p-3 space-y-1 border border-surface-200/50">
            <p className="font-medium text-gray-700 text-xs">💰 Foglio 2: Liquidità (opzionale)</p>
            <p className="text-gray-500">Traccia il saldo dei conti correnti e dei depositi.</p>
            <div className="space-y-0.5 pt-1">
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Data</code> — formato GG/MM/AAAA</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Conto</code> — nome del conto (es. "Intesa", "Fineco")</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Saldo</code> — importo numerico</p>
            </div>
          </div>

          {/* Foglio 3: Anagrafica Portafoglio */}
          <div className="bg-surface-50/50 rounded-lg p-3 space-y-1 border border-surface-200/50">
            <p className="font-medium text-gray-700 text-xs">📈 Foglio 3: Anagrafica Portafoglio (opzionale)</p>
            <p className="text-gray-500">Elenco degli asset finanziari (azioni, obbligazioni, ETF, fondi).</p>
            <div className="space-y-0.5 pt-1">
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Tipo</code> — Azioni, Obbligazioni, ETF, Fondi, Crypto</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Ticker</code> — codice identificativo (es. "AAPL", "VWCE")</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Quantità</code> — numero di unità possedute</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Prezzo medio carico</code> — prezzo di acquisto medio</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Valore attuale</code> — valore di mercato aggiornato</p>
            </div>
          </div>

          {/* Passaggi per configurare */}
          <div className="mt-2 pt-3 border-t border-surface-200 space-y-1">
            <p className="font-medium text-gray-700 text-xs">🚀 Come iniziare</p>
            <p>1. Apri il <a href="https://docs.google.com/spreadsheets/d/1fLJoECuxa8bjYPAskzFi7RhRx6-O_1TWB_lmTHWBZ34" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">template</a> e fai <strong className="text-gray-700">File → Crea una copia</strong></p>
            <p>2. Rinomina il file e compila i fogli che ti servono</p>
            <p>3. Condividilo: <strong className="text-gray-700">Condividi → Chiunque abbia il link → Visualizzatore</strong></p>
            <p>4. Vai su <a href="/dashboard/profilo" className="text-brand-600 underline">Profilo</a> e incolla l'URL del foglio</p>
            <p>5. Torna qui e clicca <strong className="text-gray-700">Sincronizza ora</strong></p>
          </div>
        </div>
      </details>

      {/* Zona pericolo - Full width */}
      <div className="mt-6 card border-red-200 bg-red-50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-red-800">⚠️ Cancella dati {anno}</p>
            <p className="text-xs text-red-600 mt-0.5">Rimuove movimenti e liquidità per l'anno selezionato.</p>
          </div>
          <button onClick={clearData} disabled={isLoading}
            className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-40">
            Cancella
          </button>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-sm flex items-center gap-2
          ${status === 'done' ? 'bg-green-50 text-green-700' :
            status === 'error' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'}`}>
          {isLoading && <span className="animate-spin text-base">⟳</span>}
          {message}
        </div>
      )}

      {status === 'done' && (
        <div className="mt-3 text-center">
          <a href="/dashboard" className="text-sm text-brand-600 hover:underline">→ Vai alla dashboard</a>
        </div>
      )}
    </div>
  )
}