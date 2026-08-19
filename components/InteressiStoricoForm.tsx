'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, MESI } from '@/types'

const MESI_LABEL: Record<string, string> = {
  gen: 'Gen', feb: 'Feb', mar: 'Mar', apr: 'Apr', mag: 'Mag', giu: 'Giu',
  lug: 'Lug', ago: 'Ago', set: 'Set', ott: 'Ott', nov: 'Nov', dic: 'Dic',
}

type RigaInteresse = { id?: string; asset_id: string | null; valore: number }

export default function InteressiStoricoForm({
  anno, portafoglio, meseCorrente, onSaved,
}: {
  anno: number
  portafoglio: AssetPortafoglio[]
  meseCorrente: string
  onSaved: () => void
}) {
  const supabase = createClient()
  const [mese, setMese] = useState(meseCorrente)
  const [modalita, setModalita] = useState<'aggregato' | 'per_asset'>('aggregato')
  const [valoreAggregato, setValoreAggregato] = useState('')
  const [valoriPerAsset, setValoriPerAsset] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const assetAttivi = portafoglio.filter(a => (a.quantita_attuale ?? 0) > 0)

  const loadEsistenti = useCallback(async () => {
    setLoaded(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('interessi_storico')
      .select('*')
      .eq('user_id', user.id)
      .eq('anno', anno)
      .eq('mese', mese)

    const righe: RigaInteresse[] = data ?? []
    const aggregata = righe.find(r => r.asset_id === null)
    const perAsset = righe.filter(r => r.asset_id !== null)

    if (perAsset.length > 0) {
      setModalita('per_asset')
      const map: Record<string, string> = {}
      for (const r of perAsset) if (r.asset_id) map[r.asset_id] = String(r.valore)
      setValoriPerAsset(map)
      setValoreAggregato('')
    } else if (aggregata) {
      setModalita('aggregato')
      setValoreAggregato(String(aggregata.valore))
      setValoriPerAsset({})
    } else {
      setValoreAggregato('')
      setValoriPerAsset({})
    }
    setLoaded(true)
  }, [anno, mese])

  useEffect(() => { loadEsistenti() }, [loadEsistenti])

  async function salva() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    // Pattern delete+insert coerente con liquidita: pulisce il mese e riscrive
    await supabase.from('interessi_storico').delete().eq('user_id', user.id).eq('anno', anno).eq('mese', mese)

    if (modalita === 'aggregato') {
      const v = parseFloat(valoreAggregato.replace(',', '.'))
      if (!isNaN(v)) {
        await supabase.from('interessi_storico').insert({
          user_id: user.id, anno, mese, asset_id: null, valore: v,
        })
      }
    } else {
      const rows = Object.entries(valoriPerAsset)
        .map(([asset_id, val]) => ({ asset_id, valore: parseFloat(val.replace(',', '.')) }))
        .filter(r => !isNaN(r.valore))
        .map(r => ({ user_id: user.id, anno, mese, asset_id: r.asset_id, valore: r.valore }))
      if (rows.length > 0) {
        await supabase.from('interessi_storico').insert(rows)
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-900 mb-3">Registra plus/minus del mese</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={mese} onChange={e => setMese(e.target.value)} className="input w-24 text-sm">
          {MESI.map(m => <option key={m} value={m}>{MESI_LABEL[m]}</option>)}
        </select>

        <div className="inline-flex rounded-lg border border-surface-200 overflow-hidden text-xs">
          <button
            onClick={() => setModalita('aggregato')}
            className={`px-3 py-1.5 ${modalita === 'aggregato' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-500'}`}
          >
            Totale unico
          </button>
          <button
            onClick={() => setModalita('per_asset')}
            className={`px-3 py-1.5 border-l border-surface-200 ${modalita === 'per_asset' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-500'}`}
          >
            Per singolo asset
          </button>
        </div>
      </div>

      {!loaded ? (
        <p className="text-xs text-gray-400">Caricamento…</p>
      ) : modalita === 'aggregato' ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="es. 1250 oppure -430"
            value={valoreAggregato}
            onChange={e => setValoreAggregato(e.target.value)}
            className="input flex-1 text-sm"
          />
          <span className="text-xs text-gray-400">€</span>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {assetAttivi.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-600 truncate flex-1">{a.nome || a.ticker}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={a.id ? (valoriPerAsset[a.id] ?? '') : ''}
                onChange={e => a.id && setValoriPerAsset(prev => ({ ...prev, [a.id!]: e.target.value }))}
                className="input w-28 text-xs py-1"
              />
            </div>
          ))}
          {assetAttivi.length === 0 && (
            <p className="text-xs text-gray-400">Nessun asset attivo in portafoglio.</p>
          )}
        </div>
      )}

      <button
        onClick={salva}
        disabled={saving}
        className="btn-primary text-sm mt-4 w-full sm:w-auto"
      >
        {saving ? 'Salvataggio…' : `Salva ${MESI_LABEL[mese]}`}
      </button>
    </div>
  )
}
