// components/portfolio/AllocazioneDonut.tsx
'use client'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { fmtEuro } from '@/lib/portfolioFormat'

export interface FettaDonut {
  nome: string
  valore: number
  colore: string
}

export default function AllocazioneDonut({
  fette, centro, sub, altezza = 150,
}: {
  fette: FettaDonut[]; centro: string; sub?: string; altezza?: number
}) {
  const positive = fette.filter(f => f.valore > 0)
  const vuoto = positive.length === 0
  const dati = vuoto ? [{ nome: '', valore: 1, colore: '#ececE1' }] : positive
  return (
    <div className="relative w-full" style={{ height: altezza }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={dati} dataKey="valore" nameKey="nome"
            innerRadius="62%" outerRadius="92%" paddingAngle={vuoto ? 0 : 1.5} stroke="none" isAnimationActive={false}
          >
            {dati.map((f, i) => <Cell key={i} fill={f.colore} />)}
          </Pie>
          {!vuoto && <Tooltip formatter={(v, n) => [fmtEuro(Number(v)), String(n)]} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="num-display text-base font-bold tabular-nums text-gray-900">{centro}</span>
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </div>
    </div>
  )
}
