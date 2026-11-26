'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { Notifica } from '@/types'
import AlertDettaglioCard from '@/components/AlertDettaglioCard'

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

// Dettaglio degli ultimi alert scattati: stessi numeri della mail (calcolati al momento del check).
// `nuovo` mostra la pillola "Nuovo"; `onVisto` scatta quando la sezione è visibile a schermo;
// `compatto` nasconde il titolo (già presente nel pulsante del pannello che la contiene).
export default function AlertDettaglioSezione({ nuovo = false, onVisto, compatto = false }: { nuovo?: boolean; onVisto?: () => void; compatto?: boolean }) {
  const supabase = createClient()
  const [righe, setRighe] = useState<Notifica[] | null>(null)
  const [idx, setIdx] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

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

  // Segna l'alert come visto quando la sezione entra in vista
  useEffect(() => {
    if (!onVisto || !rootRef.current) return
    const obs = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { onVisto(); obs.disconnect() } }, { threshold: 0.4 })
    obs.observe(rootRef.current)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [righe])

  const n = righe && righe.length > 0 ? righe[Math.min(idx, righe.length - 1)] : null

  return (
    <section ref={rootRef} id="alert-dettaglio" className="flex flex-col gap-4 scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {!compatto && (
            <div className="flex items-center gap-2">
              <h2 className="num-display text-base font-semibold text-gray-900">Dettaglio alert</h2>
              {nuovo && <span className="rounded-full bg-red-50 text-red-700 text-[10px] font-semibold px-2 py-0.5">Nuovo</span>}
            </div>
          )}
          <p className={`text-xs text-gray-400 ${compatto ? '' : 'mt-0.5'}`}>Calcolato al momento dello scatto: gli stessi numeri della mail.</p>
        </div>
        {righe && righe.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Alert del
            <select value={idx} onChange={e => setIdx(Number(e.target.value))} className="input text-xs py-1.5 w-auto">
              {righe.map((r, i) => <option key={r.id} value={i}>{fmt(r.created_at)}{i === 0 ? ' · ultimo' : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      {righe === null && <div className="card text-xs text-gray-400">Caricamento…</div>}
      {righe !== null && righe.length === 0 && (
        <div className="card text-xs text-gray-500">Nessun alert da mostrare. Il dettaglio compare quando scatta una soglia con accumulo attivo.</div>
      )}
      {n?.dettaglio && <AlertDettaglioCard dettaglio={n.dettaglio} />}
    </section>
  )
}
