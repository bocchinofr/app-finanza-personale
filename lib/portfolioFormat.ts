// lib/portfolioFormat.ts — formattatori condivisi dai pannelli di analisi portafoglio
export const fmtEuro = (n: number) => `${n < 0 ? '-' : ''}€${Math.abs(Math.round(n)).toLocaleString('it-IT')}`
export const fmtEuroDelta = (n: number) => `${n > 0 ? '+' : ''}${fmtEuro(n)}`
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d).replace('.', ',')}%`
export const fmtPctSegno = (n: number, d = 1) => `${n > 0 ? '+' : ''}${fmtPct(n, d)}`
export const fmtPp = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')} pp`
export const fmtPrezzo = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtQta = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 4 })
export const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–'

// Colori asset class (coerenti con la palette dell'app)
export const COLORI_CLASSE = {
  azionario: '#3f6b4f',
  obbligazionario: '#5b7a99',
  altro: '#a9b092',
  liquidita: '#e0a93b',
} as const
