import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Rendimenti giornalieri a 1 anno, indicizzati per giorno (UTC) per allineare borse diverse.
async function serieRendimenti(ticker: string): Promise<Map<number, number> | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return null
    const json = await res.json()
    const r = json?.chart?.result?.[0]
    const ts: number[] = r?.timestamp ?? []
    const cl: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? []
    const out = new Map<number, number>()
    let prev: number | null = null
    for (let i = 0; i < ts.length; i++) {
      const c = cl[i]
      if (c == null) continue
      if (prev !== null) out.set(Math.floor(ts[i] / 86400), c / prev - 1)
      prev = c
    }
    return out
  } catch {
    return null
  }
}

// GET /api/correlazione?strumento=XYZ&long=AAA:12000,BBB:8000
export async function GET(req: NextRequest) {
  const strumento = req.nextUrl.searchParams.get('strumento')
  const longParam = req.nextUrl.searchParams.get('long')
  if (!strumento || !longParam) {
    return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })
  }

  const pesi = longParam
    .split(',')
    .map(s => s.split(':'))
    .map(([t, v]) => ({ ticker: (t ?? '').trim(), peso: Number(v) }))
    .filter(x => x.ticker && x.peso > 0)
    .slice(0, 8)
  if (pesi.length === 0) return NextResponse.json({ error: 'Nessun long valido' }, { status: 400 })

  const [serieStr, ...serieLong] = await Promise.all([
    serieRendimenti(strumento),
    ...pesi.map(p => serieRendimenti(p.ticker)),
  ])
  if (!serieStr) return NextResponse.json({ error: 'Strumento non trovato' }, { status: 404 })

  const pesoTot = pesi.reduce((s, p) => s + p.peso, 0)
  const xs: number[] = []
  const ys: number[] = []
  for (const [giorno, rStr] of serieStr) {
    let somma = 0
    let pesoDisp = 0
    pesi.forEach((p, i) => {
      const r = serieLong[i]?.get(giorno)
      if (r !== undefined) {
        somma += r * p.peso
        pesoDisp += p.peso
      }
    })
    if (pesoDisp / pesoTot < 0.5) continue
    xs.push(somma / pesoDisp) // rendimento paniere long
    ys.push(rStr) // rendimento strumento
  }

  const n = xs.length
  if (n < 30) return NextResponse.json({ error: 'Storico insufficiente' }, { status: 422 })

  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my)
    vx += (xs[i] - mx) ** 2
    vy += (ys[i] - my) ** 2
  }
  if (vx === 0 || vy === 0) return NextResponse.json({ error: 'Dati piatti' }, { status: 422 })

  return NextResponse.json({ corr: cov / Math.sqrt(vx * vy), beta: cov / vx, n })
}
