'use client'
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase'
import {
  Liquidita, AssetPortafoglio, Movimento, FondoPensione, Profilo, statoAttuale,
} from '@/types'
import { calcolaAnalisiFinanziaria, AnalisiFinanziaria } from '@/lib/analisiCalculations'
import { generaSezioniReport } from '@/lib/generaReportTesto'
import { generaPromptAI } from '@/lib/generaPromptAI'

function calcolaEta(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null
  const nascita = new Date(birthDate)
  if (isNaN(nascita.getTime())) return null
  const oggi = new Date()
  let eta = oggi.getFullYear() - nascita.getFullYear()
  const compleannoPassato =
    oggi.getMonth() > nascita.getMonth() ||
    (oggi.getMonth() === nascita.getMonth() && oggi.getDate() >= nascita.getDate())
  if (!compleannoPassato) eta -= 1
  return eta
}

export default function AnalisiFinanziariaModal({ compact = false }: { compact?: boolean }) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [analisi, setAnalisi] = useState<AnalisiFinanziaria | null>(null)
  const [copiato, setCopiato] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const annoCorrente = new Date().getFullYear()
    const [profRes, liqRes, portRes, movRes, fondoRes] = await Promise.all([
      supabase.from('profili').select('*').eq('user_id', user.id).single(),
      supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', annoCorrente),
      supabase.from('portafoglio').select('*').eq('user_id', user.id),
      supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', annoCorrente),
      supabase.from('fondo_pensione').select('*').eq('user_id', user.id).eq('anno', annoCorrente),
    ])

    const profilo = profRes.data as (Profilo & { birth_date?: string | null }) | null
    const portafoglio = (portRes.data ?? []) as AssetPortafoglio[]

    // Prezzi correnti via lo stesso proxy usato in Patrimonio; se fallisce si
    // ricade sul prezzo di carico (nessun blocco della UI).
    let prezziAttuali: Record<string, number> = {}
    const tickers = portafoglio
      .filter(a => statoAttuale(a).quantita > 0)
      .map(a => a.ticker)
    if (tickers.length > 0) {
      try {
        const res = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(','))}`)
        const json: Record<string, { price: number }> = await res.json()
        for (const [ticker, q] of Object.entries(json)) prezziAttuali[ticker] = q.price
      } catch {
        // silenzioso: si userà il prezzo di carico
      }
    }

    const risultato = calcolaAnalisiFinanziaria({
      anno: annoCorrente,
      movimenti: (movRes.data ?? []) as Movimento[],
      portafoglio,
      liquidita: (liqRes.data ?? []) as Liquidita[],
      fondoPensione: (fondoRes.data ?? []) as FondoPensione[],
      prezziAttuali,
      etaAttuale: calcolaEta(profilo?.birth_date),
    })
    setAnalisi(risultato)
    setLoading(false)
  }, [supabase])

  function apri() {
    setOpen(true)
    if (!analisi) carica()
  }

  async function copiaPrompt() {
    if (!analisi) return
    try {
      await navigator.clipboard.writeText(generaPromptAI(analisi))
      setCopiato(true)
      setTimeout(() => setCopiato(false), 2000)
    } catch {
      setErrore('Impossibile copiare automaticamente: seleziona e copia manualmente dal testo mostrato.')
    }
  }

  async function scaricaPdf() {
    if (!analisi) return
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    const marginX = 15
    let y = 20
    const pageHeight = doc.internal.pageSize.getHeight()

    function nuovaRiga(altezza = 6) {
      y += altezza
      if (y > pageHeight - 15) { doc.addPage(); y = 20 }
    }

    doc.setFontSize(16)
    doc.text(`Analisi Finanziaria — ${analisi.anno}`, marginX, y)
    nuovaRiga(10)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(`Generato il ${new Date().toLocaleDateString('it-IT')}`, marginX, y)
    doc.setTextColor(0)
    nuovaRiga(10)

    for (const sezione of generaSezioniReport(analisi)) {
      if (y > pageHeight - 30) { doc.addPage(); y = 20 }
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(sezione.titolo, marginX, y)
      doc.setFont('helvetica', 'normal')
      nuovaRiga(7)
      doc.setFontSize(10)
      for (const riga of sezione.righe) {
        const linee = doc.splitTextToSize(`•  ${riga}`, 180)
        for (const linea of linee) {
          if (y > pageHeight - 15) { doc.addPage(); y = 20 }
          doc.text(linea, marginX, y)
          nuovaRiga(6)
        }
      }
      nuovaRiga(4)
    }

    doc.save(`analisi-finanziaria-${analisi.anno}.pdf`)
  }

  const modal = open && (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-surface-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Analisi Finanziaria</h3>
            <p className="text-xs text-gray-400 mt-0.5">Anno corrente · aggiornata a ogni apertura</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">Calcolo in corso…</div>
          )}
          {errore && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{errore}</p>
          )}
          {!loading && analisi && generaSezioniReport(analisi).map(sezione => (
            <div key={sezione.titolo} className="card p-4">
              <h4 className="text-xs font-semibold text-gray-900 mb-2">{sezione.titolo}</h4>
              <ul className="space-y-1">
                {sezione.righe.map((r, i) => (
                  <li key={i} className="text-xs text-gray-600 num-display">{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {!loading && analisi && (
          <div className="px-5 py-3 border-t border-surface-100 flex flex-wrap gap-2 shrink-0">
            <button onClick={scaricaPdf} className="btn-secondary text-xs">⬇ Scarica PDF</button>
            <button onClick={copiaPrompt} className="btn-primary text-xs">
              {copiato ? '✓ Prompt copiato' : '📋 Copia prompt per AI'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <button
        onClick={apri}
        className={compact
          ? 'h-9 w-9 flex items-center justify-center rounded-lg border border-surface-200 text-gray-600'
          : 'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors'}
        title="Analisi Finanziaria"
      >
        📊 {!compact && 'Analisi Finanziaria'}
      </button>

      {mounted && modal && createPortal(modal, document.body)}
    </>
  )
}
