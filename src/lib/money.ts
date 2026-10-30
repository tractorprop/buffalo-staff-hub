import type { InvoiceLine } from './types'

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export const money = (n: number) => gbp.format(n)
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Prices are excluding VAT; VAT is worked out per line and rounded to the penny.
export function lineTotals(l: InvoiceLine) {
  const net = round2(l.qty * l.unit_price)
  const vat = round2(net * l.vat_rate)
  return { net, vat, amount: round2(net + vat) }
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
