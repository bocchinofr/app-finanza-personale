'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { Notifica } from '@/types'
import AlertDettaglioCard from '@/components/AlertDettaglioCard'

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

// Dettaglio degli ultimi alert scattati: stessi numeri della mail (calcolati al momento del check).
export default function AlertDettaglioSezione() {
  const supabase = createClient()
  const [righe, setRighe] = useState<Notifica[] | null>(null)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('notifiche').select('*')
        .eq('user_id', user.id).not('dettaglio', 'is', null)
        .order('created_at', { ascending: false }).limit(30)
      // le notifiche dello stesso check condividono lo stesso dettaglio: se ne tiene una per generatoAt
      const viste = new Set<string>()
      const uniche = ((data as Notifica[]) ?? []).filter(n => {
        const k = n.dettaglio?.generatoAt ?? n.id
        if (viste.has(k)) return false
        viste.add(k); return true
      }).slice(0, 8)
      setRighe(uniche)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (righe === null) return <div className="card text-xs text-gray-400">Caricamento…</div>
  if (righe.length === 0) {
    return <div className="card text-xs text-gray-500">Nessun alert da mostrare. Il dettaglio compare quando scatta una soglia con accumulo attivo.</div>
  }
  const n = righe[Math.min(idx, righe.length - 1)]
  return (
    <div className="space-y-4" id="alert-dettaglio">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-gray-800">Dettaglio alert</p>
          <p className="text-[11px] text-gray-400">Calcolato al momento dello scatto, gli stessi numeri della mail.</p>
        </div>
        <select
          value={idx} onChange={e => setIdx(Number(e.target.value))}
          className="text-xs border border-surface-200 rounded-lg px-2 py-1 bg-white text-gray-700"
        >
          {righe.map((r, i) => <option key={r.id} value={i}>{fmt(r.created_at)}{i === 0 ? ' · ultimo' : ''}</option>)}
        </select>
      </div>
      {n.dettaglio && <AlertDettaglioCard dettaglio={n.dettaglio} />}
    </div>
  )
}
