import { NextRequest, NextResponse } from 'next/server'
import { fetchQuote, QuoteData } from '@/lib/fetchQuote'

export const dynamic = 'force-dynamic'

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
