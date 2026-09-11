'use client'
import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { MESI } from '@/types'

// Stesse abbreviazioni usate in tutto il resto dell'app (types/index.ts):
// ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
const MESI_LABEL: Record<string, string> = {
  gen: 'Gennaio', feb: 'Febbraio', mar: 'Marzo', apr: 'Aprile', mag: 'Maggio', giu: 'Giugno',
  lug: 'Luglio', ago: 'Agosto', set: 'Settembre', ott: 'Ottobre', nov: 'Novembre', dic: 'Dicembre',
}

// Stessa regola usata in Gestione: si registra sempre l'ULTIMO MESE CONCLUSO.
function meseDaRegistrare() {
  const oggi = new Date()
  const meseIdx = oggi.getMonth()
  const meseScorsoIdx = meseIdx === 0 ? 11 : meseIdx - 1
  const annoScorso = meseIdx === 0 ? oggi.getFullYear() - 1 : oggi.getFullYear()
  return { mese: MESI[meseScorsoIdx], anno: annoScorso }
}

export default function SnapshotReminder({ compact = false }: { compact?: boolean }) {
  const supabase = createClient()
  const [missing, setMissing] = useState(false)

  const check = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { count: nAsset } = await supabase
      .from('portafoglio')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    if (!nAsset) { setMissing(false); return }

    const { mese, anno } = meseDaRegistrare()
    const { count } = await supabase
      .from('portafoglio_storico')
      .select('mese', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('anno', anno)
      .eq('mese', mese)
    setMissing((count ?? 0) === 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    check()
    window.addEventListener('notifiche:refresh', check)
    return () => window.removeEventListener('notifiche:refresh', check)
  }, [check])

  if (!missing) return null
  const { mese, anno } = meseDaRegistrare()
  const annoCorrente = new Date().getFullYear()

  if (compact) {
    return (
      <Link
        href="/dashboard/gestione"
        title={`Registra chiusura ${MESI_LABEL[mese]}`}
        className="relative h-9 w-9 flex items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
      >
        <span className="text-base leading-none">📅</span>
        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
      </Link>
    )
  }

  return (
    <Link
      href="/dashboard/gestione"
      title="Gestione → scheda Portafoglio → Storico prezzi mensili"
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 hover:bg-amber-100 transition-colors"
    >
      <span className="text-sm shrink-0">📅</span>
      <span className="flex-1 leading-snug">
        <span className="block">
          Registra chiusura <strong>{MESI_LABEL[mese]}</strong>{anno !== annoCorrente ? ` ${anno}` : ''}
        </span>
        <span className="block text-[10px] text-amber-600 mt-0.5">
          Gestione → Portafoglio → Storico prezzi
        </span>
      </span>
      <span className="shrink-0 text-amber-600">→</span>
    </Link>
  )
}
