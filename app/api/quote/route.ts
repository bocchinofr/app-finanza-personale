import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface QuoteData {
  price: number
  high52: number | null
  changeFromHigh: number | null
  monthAgoClose: number | null
  changeFromMonth: number | null
}

async function fetchQuote(ticker: string): Promise<QuoteData | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return null
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return null

    const meta = result.meta
    const price: number | undefined = meta?.regularMarketPrice
    if (!price) return null
    const high52: number | null = meta?.fiftyTwoWeekHigh ?? null

    // Trova la chiusura più vicina a ~30 giorni fa per il confronto mensile
    const timestamps: number[] = result.timestamp ?? []
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? []
    let monthAgoClose: number | null = null
    if (timestamps.length && closes.length) {
      const targetTs = Date.now() / 1000 - 30 * 24 * 3600
      let bestIdx = -1
      let bestDiff = Infinity
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue
        const diff = Math.abs(timestamps[i] - targetTs)
        if (diff < bestDiff) {
          bestDiff = diff
          bestIdx = i
        }
      }
      if (bestIdx >= 0) monthAgoClose = closes[bestIdx]
    }

    const changeFromHigh = high52 ? ((price - high52) / high52) * 100 : null
    const changeFromMonth = monthAgoClose ? ((price - monthAgoClose) / monthAgoClose) * 100 : null

    return { price, high52, changeFromHigh, monthAgoClose, changeFromMonth }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers')
  if (!tickersParam) {
    return NextResponse.json({ error: 'Missing tickers param' }, { status: 400 })
  }
  const tickers = [...new Set(tickersParam.split(',').map(t => t.trim()).filter(Boolean))]

  const entries = await Promise.all(
    tickers.map(async ticker => {
      const data = await fetchQuote(ticker)
      return [ticker, data] as const
    })
  )

  const result: Record<string, QuoteData> = {}
  for (const [ticker, data] of entries) {
    if (data) result[ticker] = data
  }

  return NextResponse.json(result)
}
