'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, Movimento, statoAttuale } from '@/types'
import { trovaAssetCorrispondente, estraiQuantitaPrezzo, calcolaNuovoStato, estraiPattern, RegolaMatching } from '@/lib/riconciliazione'

function fmt(n: number) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

interface RigaBozza {
  movimento: Movimento
  assetSuggerito: AssetPortafoglio | null
  assetSelezionatoId: string
  quantita: string
  errore?: string
  ignorato: boolean
}

export default function RiconciliazionePage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [portafoglio, setPortafoglio] = useState<AssetPortafoglio[]>([])
  const [regole, setRegole] = useState<RegolaMatching[]>([])
  const [righe, setRighe] = useState<RigaBozza[]>([])
  const [messaggio, setMessaggio] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [movRes, portRes, regRes] = await Promise.all([
      supabase.from('movimenti').select('*')
        .eq('user_id', user.id)
        .eq('categoria', 'INVESTIMENTI')
        .eq('riconciliato', false),
      supabase.from('portafoglio').select('*').eq('user_id', user.id),
      supabase.from('regole_riconciliazione').select('pattern, portafoglio_id').eq('user_id', user.id),
    ])

    const port = (portRes.data as AssetPortafoglio[]) ?? []
    const movs = (movRes.data as Movimento[]) ?? []
    const reg = (regRes.data as RegolaMatching[]) ?? []
    setPortafoglio(port)
    setRegole(reg)

    setRighe(movs.map(m => {
      const suggerito = trovaAssetCorrispondente(m, port, reg)
      const { quantita } = estraiQuantitaPrezzo(m.descrizione)
      return {
        movimento: m,
        assetSuggerito: suggerito,
        assetSelezionatoId: suggerito?.id ?? '',
        quantita: quantita != null ? String(quantita) : '',
        ignorato: false,
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function aggiornaRiga(idx: number, patch: Partial<RigaBozza>) {
    setRighe(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  async function conferma(idx: number) {
    const riga = righe[idx]
    const asset = portafoglio.find(a => a.id === riga.assetSelezionatoId)
    const qta = parseFloat(riga.quantita.replace(',', '.'))

    if (!asset) { aggiornaRiga(idx, { errore: 'Seleziona un asset corrispondente.' }); return }
    if (!qta || qta <= 0) { aggiornaRiga(idx, { errore: 'Inserisci una quantità valida.' }); return }

    const risultato = calcolaNuovoStato(asset, riga.movimento, qta)
    if (risultato.errore) { aggiornaRiga(idx, { errore: risultato.errore }); return }

    setSalvando(riga.movimento.id ?? String(idx))
    try {
      const { error: e1 } = await supabase.from('portafoglio').update({
        quantita_attuale: risultato.nuovaQuantita,
        prezzo_carico_attuale: risultato.nuovoPrezzoCarico,
        ultimo_aggiornamento_at: new Date().toISOString(),
      }).eq('id', asset.id)
      if (e1) throw e1

      const { error: e2 } = await supabase.from('movimenti').update({
        riconciliato: true,
        portafoglio_id: asset.id,
      }).eq('id', riga.movimento.id)
      if (e2) throw e2

      // Salva/aggiorna la regola di matching per questo pattern di testo,
      // così un movimento futuro con la stessa descrizione (quantità diversa)
      // viene associato automaticamente all'asset.
      const pattern = estraiPattern(`${riga.movimento.nome_etf} ${riga.movimento.descrizione}`)
      if (pattern) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('regole_riconciliazione')
            .upsert({ user_id: user.id, pattern, portafoglio_id: asset.id }, { onConflict: 'user_id,pattern' })
          setRegole(prev => {
            const altre = prev.filter(r => r.pattern !== pattern)
            return [...altre, { pattern, portafoglio_id: asset.id! }]
          })
        }
      }

      setPortafoglio(prev => prev.map(a => a.id === asset.id
        ? { ...a, quantita_attuale: risultato.nuovaQuantita, prezzo_carico_attuale: risultato.nuovoPrezzoCarico }
        : a))
      setRighe(prev => prev.filter((_, i) => i !== idx))
      setMessaggio(`✓ ${asset.nome || asset.ticker} aggiornato.`)
    } catch (err: unknown) {
      aggiornaRiga(idx, { errore: err instanceof Error ? err.message : 'Errore durante il salvataggio' })
    } finally {
      setSalvando(null)
    }
  }

  async function ignora(idx: number) {
    const riga = righe[idx]
    setSalvando(riga.movimento.id ?? String(idx))
    try {
      await supabase.from('movimenti').update({ riconciliato: true }).eq('id', riga.movimento.id)
      setRighe(prev => prev.filter((_, i) => i !== idx))
    } finally {
      setSalvando(null)
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-gray-400">Caricamento…</div>

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Riconciliazione portafoglio</h1>
      <p className="text-sm text-gray-500 mb-6">
        Movimenti con categoria &quot;INVESTIMENTI&quot; non ancora collegati a un asset del portafoglio.
        Verifica quantità e asset suggeriti, poi conferma per aggiornare quantità e prezzo di carico.
      </p>

      {messaggio && <div className="mb-4 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{messaggio}</div>}

      {righe.length === 0 ? (
        <div className="card text-sm text-gray-400 text-center py-10">
          Nessun movimento da riconciliare. ✓
        </div>
      ) : (
        <div className="space-y-4">
          {righe.map((r, idx) => {
            const m = r.movimento
            const isAcquisto = m.uscite > 0
            const assetSel = portafoglio.find(a => a.id === r.assetSelezionatoId)
            const stato = assetSel ? statoAttuale(assetSel) : null
            const anteprima = assetSel && r.quantita
              ? calcolaNuovoStato(assetSel, m, parseFloat(r.quantita.replace(',', '.')) || 0)
              : null

            return (
              <div key={m.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isAcquisto ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                      {isAcquisto ? 'Acquisto (uscita)' : 'Vendita (entrata)'}
                    </span>
                    <p className="text-sm text-gray-800 mt-2">{m.descrizione || '—'}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {m.data_operazione} · {m.nome_etf || 'nome ETF non indicato'} · importo €{fmt(isAcquisto ? m.uscite : m.entrate)}
                    </p>
                  </div>

                  <div className="flex-1 min-w-64">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Asset corrispondente</label>
                    <select
                      className="input w-full mb-2"
                      value={r.assetSelezionatoId}
                      onChange={e => aggiornaRiga(idx, { assetSelezionatoId: e.target.value, errore: undefined })}
                    >
                      <option value="">— nessuno —</option>
                      {portafoglio.map(a => (
                        <option key={a.id} value={a.id}>{a.nome || a.descrizione} {a.ticker ? `(${a.ticker})` : ''}</option>
                      ))}
                    </select>
                    {!r.assetSuggerito && (
                      <p className="text-xs text-amber-600 mb-2">Nessun match automatico trovato — seleziona a mano.</p>
                    )}

                    <label className="block text-xs font-medium text-gray-600 mb-1">Quantità quote</label>
                    <input
                      className="input w-full"
                      value={r.quantita}
                      placeholder="es. 12,5"
                      onChange={e => aggiornaRiga(idx, { quantita: e.target.value, errore: undefined })}
                    />

                    {stato && (
                      <p className="text-xs text-gray-400 mt-2">
                        Attuale: {fmt(stato.quantita)} quote · carico €{fmt(stato.prezzoCarico)}
                        {anteprima && !anteprima.errore && (
                          <> → nuovo: <strong>{fmt(anteprima.nuovaQuantita)}</strong> quote · carico €<strong>{fmt(anteprima.nuovoPrezzoCarico)}</strong></>
                        )}
                      </p>
                    )}

                    {r.errore && <p className="text-xs text-red-600 mt-2">{r.errore}</p>}

                    <div className="flex gap-2 mt-3">
                      <button
                        className="btn-primary text-xs"
                        disabled={salvando === (m.id ?? String(idx))}
                        onClick={() => conferma(idx)}
                      >
                        {salvando === (m.id ?? String(idx)) ? 'Salvo…' : 'Conferma e aggiorna'}
                      </button>
                      <button
                        className="btn-secondary text-xs"
                        disabled={salvando === (m.id ?? String(idx))}
                        onClick={() => ignora(idx)}
                      >
                        Ignora (non è un movimento ETF)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
