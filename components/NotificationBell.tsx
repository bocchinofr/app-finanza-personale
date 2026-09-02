'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Notifica } from '@/types'

export default function NotificationBell() {
  const supabase = createClient()
  const [notifiche, setNotifiche] = useState<Notifica[]>([])
  const [open, setOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('notifiche')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    const list = (data as Notifica[]) ?? []
    setNotifiche(list)
    setHasUnread(list.some(n => !n.letta))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('notifiche:refresh', load)
    return () => window.removeEventListener('notifiche:refresh', load)
  }, [load])

  async function togglePanel() {
    const next = !open
    setOpen(next)
    if (next && hasUnread) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('notifiche').update({ letta: true }).eq('user_id', user.id).eq('letta', false)
        setHasUnread(false)
        setNotifiche(prev => prev.map(n => ({ ...n, letta: true })))
      }
    }
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="relative">
      <button
        onClick={togglePanel}
        aria-label="Notifiche"
        className="relative p-2 rounded-lg border border-surface-200 text-gray-600 hover:bg-surface-50 transition-colors"
      >
        <span className="text-lg leading-none">🔔</span>
        {hasUnread && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-w-[85vw] max-h-96 overflow-y-auto bg-white border border-surface-200 rounded-xl shadow-lg z-50">
            <div className="px-4 py-3 border-b border-surface-100 sticky top-0 bg-white">
              <p className="text-sm font-semibold text-gray-900">Notifiche</p>
              <p className="text-xs text-gray-400">Ultime {notifiche.length} (max 20)</p>
            </div>
            {notifiche.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">Nessuna notifica</p>
            ) : (
              <ul className="divide-y divide-surface-100">
                {notifiche.map(n => (
                  <li key={n.id} className="px-4 py-3">
                    <p className="text-xs text-gray-700">{n.messaggio}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{fmtTime(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
