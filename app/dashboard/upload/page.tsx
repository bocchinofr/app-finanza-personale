'use client'
import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { parseMovimentiSheet } from '@/lib/parseXlsx'
import { parseMovimentiCsv, parseLiquiditaCsv, parsePortafoglioCsv, parseFondoPensioneCsv } from '@/lib/parseGoogleSheet'
import { Movimento } from '@/types'
import { serveCongelamento, congelaAnno } from '@/lib/patrimonioAnnuale'
import Drawer from '@/components/ui/Drawer'
import InfoBox from '@/components/ui/InfoBox'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { IconSync, IconUpload, IconTrash, IconCheck, IconArrowRight, IconTable } from '@/components/ui/Icons'

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

const TEMPLATE_URL = 'https://docs.google.com/spreadsheets/d/1fLJoECuxa8bjYPAskzFi7RhRx6-O_1TWB_lmTHWBZ34'

const FOGLI: { nome: string; obbl: boolean; desc: string; campi: [string, string][] }[] = [
  {
    nome: 'Movimenti conto', obbl: true,
    desc: 'Elenco di tutte le transazioni del conto.',
    campi: [
      ['MESE', 'abbreviazione: gen, feb, mar…'],
      ['Data operazione', 'formato GG/MM/AAAA'],
      ['Descrizione', 'testo libero'],
      ['Entrate / Uscite', 'importo numerico senza simbolo €'],
      ['CATEGORIA', 'usa i valori dell\'elenco nel template'],
      ['COMPONENTE', 'opzionale, es. Giulia o Famiglia'],
    ],
  },
  {
    nome: 'Liquidità', obbl: false,
    desc: 'Saldo di conti e depositi, mese per mese.',
    campi: [
      ['ANNO', 'es. 2026'],
      ['MESE', 'abbreviazione: gen, feb, mar…'],
      ['CONTO', 'nome del conto (es. Intesa, Fineco)'],
      ['SALDO', 'importo numerico'],
    ],
  },
  {
    nome: 'Fondo Pensione', obbl: false,
    desc: 'Saldo e interessi maturati sul fondo pensione.',
    campi: [
      ['ANNO', 'es. 2026'],
      ['MESE', 'abbreviazione: gen, feb, mar…'],
      ['FONDO', 'nome del fondo'],
      ['SALDO', 'importo numerico'],
      ['INTERESSI', 'interessi maturati nel mese'],
    ],
  },
  {
    nome: 'Anagrafica Portafoglio', obbl: false,
    desc: 'Asset finanziari: azioni, obbligazioni, ETF, fondi.',
    campi: [
      ['ASSET', 'nome o codice sintetico della posizione'],
      ['TICKER / ISIN', 'identificativi per il recupero quotazioni'],
      ['NOME / DESCRIZIONE', 'nome esteso dell\'asset'],
      ['DATA ACQUISTO', 'formato GG/MM/AAAA'],
      ['PREZZO ACQUISTO / QUANTITÀ', 'prezzo medio di carico e quantità possedute'],
      ['CLASSE', 'azionario, obbligazionario o altro'],
      ['SVINCOLATO', 'S se il capitale è libero e concorre alla riserva di accumulo'],
    ],
  },
]

function UploadPageInner() {
  const [dragging, setDragging]       = useState(false)
  const [status, setStatus]           = useState<Status>('idle')
  const [message, setMessage]         = useState('')
  const [anno, setAnno]               = useState(new Date().getFullYear())
  const [sheetId, setSheetId]         = useState<string | null>(null)
  const [sheetInput, setSheetInput]   = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [savingSheet, setSavingSheet] = useState(false)
  // Modale "congela l'anno precedente": azione = sync/import da eseguire dopo la scelta
  const [conferma, setConferma]       = useState<{ annoPrec: number; azione: () => Promise<void> } | null>(null)
  const [congelando, setCongelando]   = useState(false)
  const [modo, setModo]               = useState<'sheets' | 'xlsx'>('sheets')
  const [guida, setGuida]             = useState(false)
  const [confermaCancella, setConfermaCancella] = useState(false)
  const supabase = createClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const autoSyncTriggered = useRef(false)

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

  // Sync automatico se si arriva da ?autosync=1 (es. bottone "Sincronizza" in sidebar)
  useEffect(() => {
    if (profileLoading || autoSyncTriggered.current) return
    if (searchParams.get('autosync') === '1' && sheetId) {
      autoSyncTriggered.current = true
      router.replace('/dashboard/upload')
      conControlloCongelamento(syncGoogleSheets)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, sheetId])

  // Primo caricamento di un anno nuovo: se l'anno precedente non è ancora in archivio
  // (storico_annuale) chiede se congelarlo prima di importare, perché il capitale
  // investito si ricostruisce dal portafoglio attuale e potrebbe cambiare.
  async function conControlloCongelamento(azione: () => Promise<void>) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user && await serveCongelamento(supabase, user.id, anno)) {
        setConferma({ annoPrec: anno - 1, azione })
        return
      }
    } catch { /* se il controllo fallisce non blocco la sincronizzazione */ }
    await azione()
  }

  async function confermaCongelamento(congela: boolean) {
    if (!conferma) return
    const { annoPrec, azione } = conferma
    if (congela) {
      setCongelando(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('Non autenticato')
        await congelaAnno(supabase, user.id, annoPrec)
      } catch (err: unknown) {
        setCongelando(false)
        setConferma(null)
        setStatus('error')
        setMessage(`Salvataggio del ${annoPrec} non riuscito: ${err instanceof Error ? err.message : 'errore sconosciuto'}. Sincronizzazione annullata.`)
        return
      }
      setCongelando(false)
    }
    setConferma(null)
    await azione()
  }

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

  // Chiave "naturale" di un movimento, usata per riconoscere la stessa riga tra
  // un sync e l'altro senza affidarsi all'id. Non include mese/componente perché
  // derivati da data_operazione/categoria e quindi ridondanti.
  function chiaveMovimento(m: Movimento): string {
    const round2 = (n: number) => Math.round((n || 0) * 100) / 100
    return [
      (m.data_operazione || '').trim(),
      (m.descrizione || '').trim().toUpperCase(),
      round2(m.entrate),
      round2(m.uscite),
      (m.categoria || '').trim().toUpperCase(),
      (m.nome_etf || '').trim().toUpperCase(),
    ].join('|')
  }

  // Sync "a diff" invece di delete+insert: le righe già presenti (stessa chiave
  // naturale) non vengono toccate, così restano intatti riconciliato/portafoglio_id
  // per i movimenti già gestiti. Si inseriscono solo le righe nuove del foglio e si
  // eliminano solo quelle non più presenti nel foglio.
  async function saveMovimenti(movimentiFoglio: Movimento[], userId: string) {
    const { data: esistenti, error: errSelect } = await supabase
      .from('movimenti').select('*').eq('user_id', userId).eq('anno', anno)
    if (errSelect) throw errSelect

    const esistentiPerChiave = new Map<string, Movimento[]>()
    for (const m of (esistenti ?? []) as Movimento[]) {
      const k = chiaveMovimento(m)
      const arr = esistentiPerChiave.get(k) ?? []
      arr.push(m)
      esistentiPerChiave.set(k, arr)
    }

    const daInserire: Movimento[] = []
    for (const m of movimentiFoglio) {
      const k = chiaveMovimento(m)
      const arr = esistentiPerChiave.get(k)
      if (arr && arr.length > 0) {
        arr.shift() // già presente in DB con la stessa chiave: non toccarla
      } else {
        daInserire.push(m)
      }
    }

    // Ciò che resta nella mappa non è più presente nel foglio: rimosso.
    const daEliminare: string[] = []
    for (const arr of esistentiPerChiave.values()) {
      for (const r of arr) if (r.id) daEliminare.push(r.id)
    }
    if (daEliminare.length > 0) {
      await supabase.from('movimenti').delete().in('id', daEliminare)
    }

    const rows = daInserire.map(m => ({ ...m, user_id: userId }))
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
          // Upsert manuale per ticker (non tramite ON CONFLICT: l'indice unique su
          // (user_id, ticker) è parziale — WHERE ticker IS NOT NULL AND ticker <> '' —
          // e Postgres non lo usa come bersaglio di ON CONFLICT senza ripetere la
          // stessa clausola WHERE, cosa che il client Supabase non permette di fare).
          // Aggiorna solo i campi di anagrafica (dal foglio), senza mai toccare
          // quantita_attuale/prezzo_carico_attuale se già presenti — quei campi sono
          // di competenza della riconciliazione in app.
          const rows = portafoglio
            .filter(p => p.ticker) // serve un ticker per la chiave stabile
            .map(p => ({ ...p, user_id: user.id }))

          const { data: esistenti, error: errSelect } = await supabase
            .from('portafoglio')
            .select('id, ticker')
            .eq('user_id', user.id)
          if (errSelect) throw errSelect
          const idPerTicker = new Map((esistenti ?? []).map(r => [r.ticker, r.id]))

          for (const riga of rows) {
            const idEsistente = idPerTicker.get(riga.ticker)
            if (idEsistente) {
              const { error } = await supabase.from('portafoglio').update(riga).eq('id', idEsistente)
              if (error) throw error
            } else {
              // La colonna quantita_attuale ha un default a 0 sul database: lo
              // forziamo esplicitamente a null in inserimento, altrimenti "0"
              // verrebbe trattato come già inizializzato e l'anagrafica (quantita)
              // non verrebbe mai usata per il calcolo dello stato attuale.
              const { error } = await supabase.from('portafoglio').insert({
                ...riga,
                quantita_attuale: null,
                prezzo_carico_attuale: null,
              })
              if (error) throw error
            }
          }

          portafoglioCount = portafoglio.length
        }
      } catch (err: unknown) {
        setStatus('error')
        setMessage(`Errore salvataggio portafoglio: ${err instanceof Error ? err.message : 'errore sconosciuto'}`)
        return
      }

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
    setConfermaCancella(false)
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
    await conControlloCongelamento(() => importaFile(file))
  }

  async function importaFile(file: File) {
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
    <div className="max-w-[1680px] mx-auto flex flex-col gap-4">
      {/* Azioni */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Anno</span>
          <SegmentedControl<string>
            ariaLabel="Anno di riferimento"
            options={[2024, 2025, 2026, 2027].map(y => ({ value: String(y), label: String(y) }))}
            value={String(anno)}
            onChange={v => setAnno(Number(v))}
          />
          <InfoBox title="Come funziona">
            <p>Scegli l&apos;anno, poi la sorgente: Google Sheets (sincronizzazione) oppure un file .xlsx.</p>
            <p>I dati esistenti dell&apos;anno selezionato vengono aggiornati con quelli del foglio. Le righe già presenti non vengono toccate.</p>
          </InfoBox>
        </div>
        <div className="flex items-center gap-2">
          <a href={TEMPLATE_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex items-center gap-1.5">
            <IconTable size={16} /> Template
          </a>
          <button type="button" onClick={() => setGuida(true)} className="btn-secondary">Guida al foglio</button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Sorgente dati */}
        <section className="card flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Sorgente dati · {anno}</h2>
            <SegmentedControl<'sheets' | 'xlsx'>
              ariaLabel="Sorgente"
              options={[{ value: 'sheets', label: 'Google Sheets' }, { value: 'xlsx', label: 'File .xlsx' }]}
              value={modo}
              onChange={setModo}
            />
          </div>

          {modo === 'sheets' ? (
            <div className="space-y-3">
              {profileLoading ? (
                <p className="text-xs text-gray-400">Caricamento…</p>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">URL o ID del foglio Google</label>
                    <div className="flex gap-2">
                      <input
                        value={sheetInput}
                        onChange={e => setSheetInput(e.target.value)}
                        placeholder="Incolla URL o ID"
                        className="input flex-1"
                      />
                      <button onClick={saveSheetId} disabled={savingSheet} className="btn-secondary text-xs whitespace-nowrap">
                        {savingSheet ? 'Salvo…' : 'Salva foglio'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      Deve essere condiviso come <strong>Visualizzatore</strong> per chiunque abbia il link.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-50 border border-surface-100 px-3 py-2">
                    {sheetId ? (
                      <>
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${sheetId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-600 hover:underline truncate"
                        >
                          ↗ Foglio collegato: {sheetId}
                        </a>
                        <span className="shrink-0 rounded-full bg-green-50 text-green-700 text-[11px] font-semibold px-2 py-0.5">Collegato</span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-gray-500">Nessun foglio collegato</span>
                        <span className="shrink-0 rounded-full bg-surface-100 text-gray-500 text-[11px] font-medium px-2 py-0.5">Non collegato</span>
                      </>
                    )}
                  </div>

                  <button
                    onClick={() => conControlloCongelamento(syncGoogleSheets)}
                    disabled={isLoading || !sheetId}
                    className="btn-primary w-full inline-flex items-center justify-center gap-2"
                  >
                    <IconSync size={16} className={isLoading ? 'animate-spin' : ''} />
                    {isLoading && status === 'fetching' ? 'Sincronizzazione…' : 'Sincronizza ora'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors flex flex-col items-center justify-center
                ${dragging ? 'border-brand-400 bg-brand-50' : 'border-surface-300 bg-surface-50 hover:border-surface-400'}`}
            >
              <span className="h-11 w-11 inline-flex items-center justify-center rounded-full bg-brand-50 text-brand-700 mb-3">
                <IconUpload size={22} />
              </span>
              <p className="text-sm font-medium text-gray-700 mb-1">Carica file .xlsx</p>
              <p className="text-xs text-gray-400 mb-4">Trascina il file qui oppure</p>
              <label className="btn-primary cursor-pointer inline-block text-sm">
                Scegli file
                <input type="file" accept=".xlsx" className="hidden" onChange={e => {
                  const f = e.target.files?.[0]; if (f) processFile(f)
                }} />
              </label>
              <p className="text-xs text-gray-400 mt-3">Compatibile con il template Google Sheets (solo foglio Movimenti conto)</p>
            </div>
          )}

          {message && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2
              ${status === 'done' ? 'bg-green-50 text-green-700' :
                status === 'error' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'}`}>
              {isLoading ? <IconSync size={16} className="animate-spin shrink-0" /> : status === 'done' ? <IconCheck size={16} className="shrink-0" /> : null}
              <span>{message.replace(/^✓\s*/, '')}</span>
            </div>
          )}
          {status === 'done' && (
            <a href="/dashboard" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
              Vai al Patrimonio <IconArrowRight size={14} />
            </a>
          )}
        </section>

        {/* Cosa viene importato + zona pericolo */}
        <section className="card flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Cosa viene importato</h2>
            <InfoBox title="Fogli del template">
              <p>Il foglio Google può contenere fino a 4 schede. Solo Movimenti conto è obbligatoria.</p>
              <p>Il dettaglio delle colonne è nella Guida al foglio.</p>
            </InfoBox>
          </div>
          <ul className="divide-y divide-surface-100">
            {FOGLI.map(f => (
              <li key={f.nome} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-gray-900">{f.nome}</p>
                  <p className="text-xs text-gray-500">{f.desc}</p>
                </div>
                <span className={`shrink-0 rounded-full text-[11px] font-semibold px-2 py-0.5 ${f.obbl ? 'bg-green-50 text-green-700' : 'bg-surface-100 text-gray-500'}`}>
                  {f.obbl ? 'Obbligatorio' : 'Opzionale'}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-3 border-t border-surface-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-gray-900">Cancella dati {anno}</p>
              <p className="text-xs text-gray-500">Rimuove movimenti, liquidità e fondo pensione dell&apos;anno.</p>
            </div>
            <button
              type="button"
              onClick={() => setConfermaCancella(true)}
              disabled={isLoading}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
            >
              <IconTrash size={14} /> Cancella
            </button>
          </div>
        </section>
      </div>

      {/* Guida al foglio */}
      <Drawer open={guida} onClose={() => setGuida(false)} title="Guida al foglio Google" subtitle="Come preparare il tuo foglio">
        <div className="space-y-4 text-xs text-gray-500">
          <p>
            Il template contiene <strong className="text-gray-700">4 fogli</strong>. Solo{' '}
            <strong className="text-gray-700">Movimenti conto</strong> è obbligatorio.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {FOGLI.map(f => (
              <div key={f.nome} className="rounded-lg border border-surface-200 p-3 space-y-1.5">
                <p className="font-semibold text-gray-800 text-[13px]">
                  {f.nome} <span className="font-normal text-gray-400">· {f.obbl ? 'obbligatorio' : 'opzionale'}</span>
                </p>
                <p>{f.desc}</p>
                <ul className="space-y-0.5 pt-1">
                  {f.campi.map(([c, d]) => (
                    <li key={c}>
                      <code className="bg-surface-100 px-1.5 py-0.5 rounded text-[11px] text-gray-700">{c}</code> — {d}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-surface-100 space-y-1">
            <p className="font-semibold text-gray-800 text-[13px]">Come iniziare</p>
            <p>1. Apri il <a href={TEMPLATE_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">template</a> e fai <strong className="text-gray-700">File → Crea una copia</strong></p>
            <p>2. Rinomina il file e compila i fogli che ti servono</p>
            <p>3. Condividilo: <strong className="text-gray-700">Condividi → Chiunque abbia il link → Visualizzatore</strong></p>
            <p>4. Incolla l&apos;URL e premi <strong className="text-gray-700">Salva foglio</strong></p>
            <p>5. Premi <strong className="text-gray-700">Sincronizza ora</strong></p>
          </div>
        </div>
      </Drawer>

      {/* Congelamento anno precedente */}
      <Drawer
        open={!!conferma}
        onClose={() => { if (!congelando) setConferma(null) }}
        variant="center"
        closeOnBlankClick={false}
        title={conferma ? `Congelare il ${conferma.annoPrec} prima di importare il ${anno}?` : ''}
      >
        {conferma && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Stai caricando il primo file del {anno} e il {conferma.annoPrec} non è ancora salvato nella vista annuale.
              Se non lo congeli, in futuro i suoi totali verranno ricalcolati dai dati attuali.
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Attenzione: il <strong>capitale investito</strong> si ricostruisce dagli asset in portafoglio oggi.
              Se hai già venduto o modificato posizioni dopo il {conferma.annoPrec}, il valore salvato
              potrebbe risultare inesatto. Congelare adesso, prima del sync, è il momento più preciso.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button onClick={() => confermaCongelamento(true)} disabled={congelando} className="btn-primary text-sm">
                {congelando ? 'Salvo…' : `Congela ${conferma.annoPrec} e sincronizza`}
              </button>
              <button onClick={() => confermaCongelamento(false)} disabled={congelando} className="btn-secondary text-sm">
                Sincronizza senza congelare
              </button>
              <button onClick={() => setConferma(null)} disabled={congelando} className="text-xs text-gray-400 hover:text-gray-600 py-1">
                Annulla
              </button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Conferma cancellazione */}
      <Drawer
        open={confermaCancella}
        onClose={() => setConfermaCancella(false)}
        variant="center"
        closeOnBlankClick={false}
        title={`Cancellare i dati del ${anno}?`}
      >
        <p className="text-xs text-gray-500">
          Verranno rimossi tutti i movimenti, la liquidità e il fondo pensione del {anno}. L&apos;operazione non si può annullare.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setConfermaCancella(false)} className="btn-secondary">Annulla</button>
          <button onClick={clearData} className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors">
            Cancella definitivamente
          </button>
        </div>
      </Drawer>
    </div>
  )
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 p-4">Caricamento…</div>}>
      <UploadPageInner />
    </Suspense>
  )
}
