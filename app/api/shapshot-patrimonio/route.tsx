import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { AssetPortafoglio, MESI, statoAttuale } from '@/types'

export const dynamic = 'force-dynamic'

const CATEGORIA_FONDO_PENSIONE_LEGACY = 'Fondo Pensione'

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return null
    const json = await res.json()
    const price: number | undefined = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    return price ?? null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: portafoglioTutti, error } = await supabase
    .from('portafoglio')
    .select('*')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!portafoglioTutti || portafoglioTutti.length === 0) {
    return NextResponse.json({ message: 'Nessun asset in portafoglio, niente da fare.' })
  }

  // Un'unica fetch per ticker, condivisa fra tutti gli utenti che lo possiedono
  const tickers = [...new Set(
    portafoglioTutti
      .filter((a: AssetPortafoglio) => a.ticker && statoAttuale(a).quantita > 0)
      .map((a: AssetPortafoglio) => a.ticker)
  )]
  const prezzi: Record<string, number> = {}
  await Promise.all(tickers.map(async ticker => {
    const p = await fetchPrice(ticker)
    if (p != null) prezzi[ticker] = p
  }))

  // Raggruppa per utente
  const perUtente = new Map<string, AssetPortafoglio[]>()
  for (const a of portafoglioTutti as AssetPortafoglio[]) {
    const uid = a.user_id!
    if (!perUtente.has(uid)) perUtente.set(uid, [])
    perUtente.get(uid)!.push(a)
  }

  const oggi = new Date()
  const anno = oggi.getFullYear()
  const mese = MESI[oggi.getMonth()]

  let utentiSalvati = 0
  for (const [userId, assets] of perUtente) {
    const assetInvestiti = assets.filter(
      a => a.asset !== CATEGORIA_FONDO_PENSIONE_LEGACY && statoAttuale(a).quantita > 0
    )
    if (assetInvestiti.length === 0) continue

    let capitaleInvestito = 0
    let carico = 0
    for (const a of assetInvestiti) {
      const { quantita, prezzoCarico } = statoAttuale(a)
      const prezzo = prezzi[a.ticker] ?? prezzoCarico
      capitaleInvestito += prezzo * quantita
      carico += prezzoCarico * quantita
    }
    const plusMinus = capitaleInvestito - carico

    await supabase
      .from('patrimonio_storico')
      .upsert(
        { user_id: userId, anno, mese, capitale_investito: capitaleInvestito, plus_minus: plusMinus },
        { onConflict: 'user_id,anno,mese' }
      )
    utentiSalvati++
  }

  return NextResponse.json({
    message: `✓ Snapshot ${mese} ${anno} salvato per ${utentiSalvati} utenti (${tickers.length} ticker interrogati).`,
  })
}
