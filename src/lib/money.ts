import type { InvoiceLine, Model } from './types'

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export const money = (n: number) => gbp.format(n)
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Prices are entered INCLUDING 20% VAT, so the line amount always matches the website price exactly;
// the net and VAT are worked back from it. "No VAT" lines charge the price without VAT.
export function lineTotals(l: InvoiceLine) {
  if (l.unit_price_inc != null) {
    const unitNet = round2(l.unit_price_inc / 1.2)
    const gross = round2(l.qty * l.unit_price_inc)
    const net = round2(gross / 1.2)
    if (l.vat_rate === 0) return { unitNet, net, vat: 0, amount: net }
    return { unitNet, net, vat: round2(gross - net), amount: gross }
  }
  // Older invoices stored the price excluding VAT.
  const unitNet = l.unit_price ?? 0
  const net = round2(l.qty * unitNet)
  const vat = round2(net * l.vat_rate)
  return { unitNet, net, vat, amount: round2(net + vat) }
}

export function invoiceTotals(lines: InvoiceLine[]) {
  let subtotal = 0
  let vat = 0
  for (const l of lines) {
    const t = lineTotals(l)
    subtotal += t.net
    vat += t.vat
  }
  return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) }
}

export const invoiceNumber = (n: number) => `BM-${n}`

// Price INCLUDING VAT for a model, or for one of its sizes. null = not set yet.
export function priceOf(m: Pick<Model, 'price' | 'size_prices' | 'sizes'>, size?: string | null): number | null {
  if (m.sizes.length) {
    const p = size ? m.size_prices?.[size] : undefined
    return p == null ? null : Number(p)
  }
  return m.price == null ? null : Number(m.price)
}
