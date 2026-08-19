'use client'
import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { parseMovimentiSheet } from '@/lib/parseXlsx'
import { parseMovimentiCsv, parseLiquiditaCsv, parsePortafoglioCsv, parseFondoPensioneCsv } from '@/lib/parseGoogleSheet'
import { Movimento } from '@/types'

type Status = 'idle' | 'fetching' | 'parsing' | 'saving' | 'done' | 'error'

function extractSheetId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{20,80}$/.test(trimmed)) return trimmed
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

async function fetchSheet(sheetId: string, sheetName: string): Promise<string[][]> {
  const res = await fetch(`/api/sync-sheets?sheetId=${encodeURIComponent(sheetId)}&sheet=${encodeURIComponent(sheetName)}`)
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? `Errore HTTP ${res.status}`)
  }
  return res.json()
}

export default function UploadPage() {
  const [dragging, setDragging]       = useState(false)
  const [status, setStatus]           = useState<Status>('idle')
  const [message, setMessage]         = useState('')
  const [anno, setAnno]               = useState(new Date().getFullYear())
  const [sheetId, setSheetId]         = useState<string | null>(null)
  const [sheetInput, setSheetInput]   = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [savingSheet, setSavingSheet] = useState(false)
  const supabase = createClient()

  // Carica il foglio salvato nel profilo
  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setProfileLoading(false); return }
      const { data } = await supabase.from('profili').select('google_sheet_id').eq('user_id', user.id).single()
      const id = data?.google_sheet_id ?? null
      setSheetId(id)
      setSheetInput(id ?? '')
      setProfileLoading(false)
    }
    loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Salva (o aggiorna) il foglio Google nel profilo
  async function saveSheetId() {
    const id = extractSheetId(sheetInput)
    if (!id) {
      setStatus('error')
      setMessage('Formato URL/ID non valido.')
      return
    }
    setSavingSheet(true)
    setStatus('idle')
    setMessage('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')
      const { error } = await supabase
        .from('profili')
        .upsert({ user_id: user.id, google_sheet_id: id, updated_at: new Date().toISOString() })
      if (error) throw error
      setSheetId(id)
      setSheetInput(id)
      setStatus('done')
      setMessage('✓ Foglio collegato con successo.')
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore nel salvataggio del foglio')
    } finally {
      setSavingSheet(false)
    }
  }

  async function saveMovimenti(movimenti: Movimento[], userId: string) {
    await supabase.from('movimenti').delete().eq('user_id', userId).eq('anno', anno)
    const rows = movimenti.map(m => ({ ...m, user_id: userId }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('movimenti').insert(rows.slice(i, i + 500))
      if (error) throw error
    }
  }

  async function syncGoogleSheets() {
    if (!sheetId) {
      setStatus('error')
      setMessage('Nessun foglio collegato. Inserisci un URL/ID e clicca "Salva foglio".')
      return
    }

    setStatus('fetching')
    setMessage('Recupero dati da Google Sheets…')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      setMessage('Lettura movimenti conto…')
      const rowsMovimenti = await fetchSheet(sheetId, 'Movimenti conto')
      const movimenti = parseMovimentiCsv(rowsMovimenti, anno)
      if (movimenti.length === 0) throw new Error('Nessun movimento trovato nel foglio "Movimenti conto".')

      setStatus('saving')
      setMessage(`Salvataggio ${movimenti.length} movimenti…`)
      await saveMovimenti(movimenti, user.id)

      let liquiditaCount = 0
      try {
        setMessage('Lettura liquidità…')
        const rowsLiq = await fetchSheet(sheetId, 'Liquidità')
        const liquidita = parseLiquiditaCsv(rowsLiq)
        if (liquidita.length > 0) {
          await supabase.from('liquidita').delete().eq('user_id', user.id).eq('anno', anno)
          const rows = liquidita.map(l => ({ ...l, user_id: user.id }))
          const { error } = await supabase.from('liquidita').insert(rows)
          if (error) throw error
          liquiditaCount = liquidita.length
        }
      } catch { /* opzionale */ }

      let fondoPensioneCount = 0
      try {
        setMessage('Lettura fondo pensione…')
        const rowsFondo = await fetchSheet(sheetId, 'Fondo Pensione')
        const fondoPensione = parseFondoPensioneCsv(rowsFondo)
        if (fondoPensione.length > 0) {
          await supabase.from('fondo_pensione').delete().eq('user_id', user.id).eq('anno', anno)
          const rows = fondoPensione.map(f => ({ ...f, user_id: user.id }))
          const { error } = await supabase.from('fondo_pensione').insert(rows)
          if (error) throw error
          fondoPensioneCount = fondoPensione.length
        }
      } catch { /* opzionale: foglio non presente per chi non ha un fondo pensione */ }

      let portafoglioCount = 0
      try {
        setMessage('Lettura portafoglio…')
        const rowsPort = await fetchSheet(sheetId, 'Anagrafica Portafoglio')
        const portafoglio = parsePortafoglioCsv(rowsPort)
        if (portafoglio.length > 0) {
          // Upsert per ticker: aggiorna solo i campi di anagrafica (dal foglio),
          // senza mai toccare quantita_attuale/prezzo_carico_attuale se già
          // presenti — quei campi sono di competenza della riconciliazione in app.
          const rows = portafoglio
            .filter(p => p.ticker) // serve un ticker per la chiave stabile
            .map(p => ({ ...p, user_id: user.id }))
          const { error } = await supabase
            .from('portafoglio')
            .upsert(rows, { onConflict: 'user_id,ticker' })
          if (error) throw error

          // Inizializza lo stato attuale (quantita_attuale/prezzo_carico_attuale)
          // solo per gli asset appena creati dal sync, senza toccare quelli
          // già riconciliati in precedenza. Va fatto riga per riga perché il
          // valore iniziale dipende dai dati anagrafici di ciascun asset.
          const { data: righeSenzaStato } = await supabase
            .from('portafoglio')
            .select('id, ticker, prezzo_acquisto, quantita')
            .eq('user_id', user.id)
            .is('quantita_attuale', null)
          if (righeSenzaStato && righeSenzaStato.length > 0) {
            for (const r of righeSenzaStato) {
              await supabase.from('portafoglio').update({
                quantita_attuale: r.quantita,
                prezzo_carico_attuale: r.prezzo_acquisto,
              }).eq('id', r.id)
            }
          }
          portafoglioCount = portafoglio.length
        }
      } catch { /* opzionale */ }

      setStatus('done')
      setMessage(
        `✓ Sincronizzazione completata — ${movimenti.length} movimenti` +
        (liquiditaCount > 0 ? `, ${liquiditaCount} righe liquidità` : '') +
        (fondoPensioneCount > 0 ? `, ${fondoPensioneCount} righe fondo pensione` : '') +
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
      await supabase.from('fondo_pensione').delete().eq('user_id', user.id).eq('anno', anno)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anno])

  const isLoading = ['fetching','parsing','saving'].includes(status)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Importa dati</h1>
      <p className="text-sm text-gray-500 mb-6">
        Scegli come caricare i movimenti. I dati esistenti per l&apos;anno selezionato verranno sostituiti.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">

        {/* Card 1: Anno + Google Sheets con input per foglio */}
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
              <p className="text-xs text-gray-400">Caricamento…</p>
            ) : (
              <>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  URL o ID del foglio Google
                </label>
                <div className="flex gap-2">
                  <input
                    value={sheetInput}
                    onChange={e => setSheetInput(e.target.value)}
                    placeholder="Incolla URL o ID"
                    className="input flex-1"
                  />
                  <button
                    onClick={saveSheetId}
                    disabled={savingSheet}
                    className="btn-secondary text-xs whitespace-nowrap"
                  >
                    {savingSheet ? 'Salvo…' : 'Salva foglio'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Deve essere condiviso come <strong>Visualizzatore</strong> per chiunque abbia il link.
                </p>

                {sheetId && (
                  <div className="mt-3 pt-3 border-t border-surface-100">
                    <p className="text-xs text-gray-500 mb-1">Foglio attualmente collegato:</p>
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${sheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-600 underline break-all"
                    >
                      ↗ {sheetId}
                    </a>
                  </div>
                )}

                <button
                  onClick={syncGoogleSheets}
                  disabled={isLoading || !sheetId}
                  className="btn-primary text-sm w-full mt-3"
                >
                  {isLoading && status === 'fetching' ? '⟳ Sincronizzazione…' : 'Sincronizza ora'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Card 2: Upload file .xlsx (invariata) */}
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

        {/* Card 3: Template info (invariata) */}
        <div className="card space-y-4">
          <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <span className="text-base">📋</span> Non hai ancora un foglio?
          </h2>
          <p className="text-xs text-gray-500">
            Apri il template, fai <strong>File → Crea una copia</strong> per salvarlo sul tuo Google Drive,
            compilalo con i tuoi movimenti e incolla il link nella sezione qui accanto.
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

      {/* Guida configurazione (invariata) */}
      <details className="mt-6 card bg-surface-50">
        <summary className="text-sm font-semibold text-gray-700 cursor-pointer hover:text-brand-600 transition-colors">
          📖 Come configurare il tuo foglio Google
        </summary>
        {/* ... contenuto invariato ... */}
        <div className="space-y-3 pt-3 text-xs text-gray-500">
          <p>
            Il template contiene <strong className="text-gray-700">3 fogli</strong> che puoi compilare.
            Solo il foglio <strong className="text-gray-700">&quot;Movimenti conto&quot;</strong> è obbligatorio.
          </p>
          <div className="bg-surface-50/50 rounded-lg p-3 space-y-1 border border-surface-200/50">
            <p className="font-medium text-gray-700 text-xs">📊 Foglio 1: Movimenti conto (obbligatorio)</p>
            <p className="text-gray-500">Contiene l&apos;elenco di tutte le transazioni del conto.</p>
            <div className="space-y-0.5 pt-1">
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">MESE</code> — abbreviazione: gen, feb, mar…</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Data operazione</code> — formato GG/MM/AAAA</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Descrizione</code> — testo libero</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Entrate</code> / <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Uscite</code> — importo numerico senza simbolo €</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">CATEGORIA</code> — usa i valori dell&apos;elenco nel template</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">COMPONENTE</code> — opzionale, es. &quot;Giulia&quot; o &quot;Famiglia&quot;</p>
            </div>
          </div>
          <div className="bg-surface-50/50 rounded-lg p-3 space-y-1 border border-surface-200/50">
            <p className="font-medium text-gray-700 text-xs">💰 Foglio 2: Liquidità (opzionale)</p>
            <p className="text-gray-500">Traccia il saldo dei conti correnti e dei depositi.</p>
            <div className="space-y-0.5 pt-1">
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Data</code> — formato GG/MM/AAAA</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Conto</code> — nome del conto (es. &quot;Intesa&quot;, &quot;Fineco&quot;)</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Saldo</code> — importo numerico</p>
            </div>
          </div>
          <div className="bg-surface-50/50 rounded-lg p-3 space-y-1 border border-surface-200/50">
            <p className="font-medium text-gray-700 text-xs">📈 Foglio 3: Anagrafica Portafoglio (opzionale)</p>
            <p className="text-gray-500">Elenco degli asset finanziari (azioni, obbligazioni, ETF, fondi).</p>
            <div className="space-y-0.5 pt-1">
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Tipo</code> — Azioni, Obbligazioni, ETF, Fondi, Crypto</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Ticker</code> — codice identificativo (es. &quot;AAPL&quot;, &quot;VWCE&quot;)</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Quantità</code> — numero di unità possedute</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Prezzo medio carico</code> — prezzo di acquisto medio</p>
              <p>• <code className="bg-surface-200 px-1.5 py-0.5 rounded text-[11px]">Valore attuale</code> — valore di mercato aggiornato</p>
            </div>
          </div>
          <div className="mt-2 pt-3 border-t border-surface-200 space-y-1">
            <p className="font-medium text-gray-700 text-xs">🚀 Come iniziare</p>
            <p>1. Apri il <a href="https://docs.google.com/spreadsheets/d/1fLJoECuxa8bjYPAskzFi7RhRx6-O_1TWB_lmTHWBZ34" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">template</a> e fai <strong className="text-gray-700">File → Crea una copia</strong></p>
            <p>2. Rinomina il file e compila i fogli che ti servono</p>
            <p>3. Condividilo: <strong className="text-gray-700">Condividi → Chiunque abbia il link → Visualizzatore</strong></p>
            <p>4. Incolla l&apos;URL qui sopra e clicca <strong className="text-gray-700">Salva foglio</strong></p>
            <p>5. Clicca <strong className="text-gray-700">Sincronizza ora</strong></p>
          </div>
        </div>
      </details>

      {/* Zona pericolo */}
      <div className="mt-6 card border-red-200 bg-red-50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-red-800">⚠️ Cancella dati {anno}</p>
            <p className="text-xs text-red-600 mt-0.5">Rimuove movimenti e liquidità per l&apos;anno selezionato.</p>
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