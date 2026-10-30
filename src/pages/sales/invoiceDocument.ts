import { invoiceNumber, invoiceTotals, lineTotals, money } from '../../lib/money'
import type { CompanySettings, InvoiceLine } from '../../lib/types'

export interface Customer {
  name: string
  address: string
  phone: string
  email: string
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const lines = (s: string | null | undefined) => esc(s).replace(/\n/g, '<br>')

const ukDate = (d: string) => {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// The printable A4 invoice, matching the Buffalo Machines invoice design.
// Opened in its own window and saved as PDF from the print dialog.
export function invoiceHtml(opts: { number: number; date: string; customer: Customer; lines: InvoiceLine[]; company: CompanySettings }) {
  const { number, date, customer, company: c } = opts
  const origin = window.location.origin
  const t = invoiceTotals(opts.lines)
  const allStandard = opts.lines.every((l) => l.vat_rate === 0.2)
  const rows = opts.lines
    .map((l) => {
      const lt = lineTotals(l)
      return `<tr><td>${esc(l.description)}</td><td class="c">${l.qty}</td><td>${money(l.unit_price)}</td><td>${money(lt.vat)}</td><td>${money(lt.amount)}</td></tr>`
    })
    .join('')
  const filler = '<tr><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(Math.max(0, 6 - opts.lines.length))
  const title = `${invoiceNumber(number)}${customer.name ? ` - ${customer.name}` : ''}`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  :root { --yellow: #fdda03; --ink: #0b0b0b; --grey: #f2f2f2; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body { font-family: Inter, 'Segoe UI', Arial, sans-serif; color: var(--ink); font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; position: relative; overflow: hidden; padding-bottom: 30mm; margin: 0 auto; }
  .head { background: var(--yellow); height: 39mm; position: relative; display: flex; align-items: center; padding: 0 9mm; }
  .head .logo { height: 24mm; }
  .head .co { margin-left: auto; width: 82mm; line-height: 1.35; padding-bottom: 6mm; }
  .head .co b { font-size: 12pt; display: block; margin-bottom: 1mm; }
  .head .co a { color: #1155cc; text-decoration: none; }
  .head .slash { position: absolute; right: 0; bottom: 0; width: 98mm; height: 7mm; background: var(--ink); clip-path: polygon(4% 0, 100% 0, 100% 100%, 0 100%); }
  .meta { display: flex; padding: 8mm 9mm 0; }
  .to { width: 80mm; line-height: 1.45; }
  .to h3 { margin: 0 0 1mm; font-size: 10pt; }
  .title { margin-left: auto; width: 82mm; }
  .title h1 { margin: -2mm 0 1mm; font-size: 32pt; font-weight: 800; line-height: 1; }
  .title table { width: 100%; border-collapse: collapse; }
  .title td { padding: .4mm 0; }
  .title td:first-child { font-weight: 700; }
  .title td:last-child { text-align: right; }
  table.items { width: calc(100% - 18mm); margin: 9mm 9mm 0; border-collapse: collapse; }
  .items th { background: var(--yellow); text-align: right; padding: 2.4mm 2mm; font-weight: 700; }
  .items th:first-child, .items td:first-child { text-align: left; }
  .items th.c, .items td.c { text-align: center; }
  .items td { padding: 2.4mm 2mm; text-align: right; height: 9mm; font-variant-numeric: tabular-nums; }
  .items tr { break-inside: avoid; }
  .items tbody tr:nth-child(even) td { background: var(--grey); }
  .rule { margin: 6mm 9mm 0; border-top: 1px solid var(--ink); }
  .money { display: flex; padding: 5mm 9mm 0; break-inside: avoid; }
  .pay { width: 82mm; }
  .pay h4 { margin: 0 0 1mm; font-size: 10pt; }
  .pay table td { padding: .7mm 0; }
  .pay table td:first-child { font-weight: 700; width: 31mm; }
  .totals { margin-left: auto; width: 82mm; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 1mm; }
  .totals td:first-child { font-weight: 700; }
  .totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.gap td { height: 4mm; }
  .totals tr.total td { background: var(--yellow); border-top: 1px solid var(--ink); font-weight: 700; padding: 1.4mm 1mm; }
  .lower { display: flex; padding: 9mm 9mm 0; position: relative; z-index: 1; break-inside: avoid; }
  .notes { width: 80mm; line-height: 1.4; }
  .notes h4 { margin: 0; font-size: 10pt; }
  .notes p { margin: 0 0 2.5mm; }
  .notes a { color: #1155cc; text-decoration: none; }
  .notes .thanks { margin-top: 5mm; font-size: 13pt; font-weight: 700; font-style: italic; }
  .watermark { position: absolute; right: 8mm; bottom: 34mm; width: 78mm; }
  .foot { position: absolute; left: 0; right: 0; bottom: 7mm; height: 7mm; background: var(--ink); }
  .foot .tab { position: absolute; right: 0; bottom: 0; width: 70mm; height: 13mm; background: var(--yellow); clip-path: polygon(8% 0, 100% 0, 100% 100%, 0 100%); display: flex; align-items: center; justify-content: center; }
  .foot .tab img { height: 9mm; }
  @media screen { body { background: #e5e7eb; padding: 10mm 0; } .page { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.2); } }
  @media print { body { padding: 0; background: #fff; } .page { box-shadow: none; } }
</style></head>
<body><div class="page">
  <div class="head">
    <img class="logo" src="${origin}/invoice/logo.svg" alt="Buffalo Machines">
    <div class="co">
      <b>${esc(c.company_name || 'BUFFALO MACHINES')}</b>
      ${lines(c.address)}${c.address ? '<br>' : ''}
      ${esc(c.phone)}${c.phone ? '<br>' : ''}
      ${c.email ? `<a>${esc(c.email)}</a>` : ''}
    </div>
    <div class="slash"></div>
  </div>
  <div class="meta">
    <div class="to">
      <h3>INVOICE TO</h3>
      <b>${esc(customer.name)}</b><br>
      ${customer.address ? `${lines(customer.address)}<br>` : ''}
      ${customer.phone ? `Tel: ${esc(customer.phone)}<br>` : ''}
      ${customer.email ? `Email: ${esc(customer.email)}` : ''}
    </div>
    <div class="title">
      <h1>INVOICE</h1>
      <table>
        <tr><td>Invoice Number:</td><td>${invoiceNumber(number)}</td></tr>
        <tr><td>Invoice Date:</td><td>${ukDate(date)}</td></tr>
      </table>
    </div>
  </div>
  <table class="items">
    <thead><tr><th>Product Description</th><th class="c">Qty.</th><th>Price</th><th>${allStandard ? 'VAT 20%' : 'VAT'}</th><th>Amount</th></tr></thead>
    <tbody>${rows}${filler}</tbody>
  </table>
  <div class="rule"></div>
  <div class="money">
    <div class="pay">
      <h4>Payment Method</h4>
      <table>
        <tr><td>Bank Name:</td><td>${esc(c.bank_name)}</td></tr>
        <tr><td>Account No.:</td><td>${esc(c.account_number)}</td></tr>
        <tr><td>Sort Code:</td><td>${esc(c.sort_code)}</td></tr>
        <tr><td>Reference:</td><td>${invoiceNumber(number)}</td></tr>
      </table>
    </div>
    <div class="totals">
      <table>
        <tr><td>Subtotal (Exc. Tax):</td><td>${money(t.subtotal)}</td></tr>
        <tr><td>${allStandard ? 'VAT (20%):' : 'VAT:'}</td><td>${money(t.vat)}</td></tr>
        <tr class="gap"><td></td><td></td></tr>
        <tr class="total"><td>Total:</td><td>${money(t.total)}</td></tr>
      </table>
    </div>
  </div>
  <div class="lower">
    <div class="notes">
      ${c.terms ? `<h4>Terms</h4><p>${lines(c.terms)}</p>` : ''}
      ${c.website ? `<h4>Website</h4><p><a>${esc(c.website)}</a></p>` : ''}
      <p>${c.vat_number ? `VAT Number: ${esc(c.vat_number)}<br>` : ''}${c.company_number ? `Company Number: ${esc(c.company_number)}` : ''}</p>
      <p><b>Sincerely</b><br><b style="font-size:8.5pt">${esc((c.company_name || 'Buffalo Machines').toUpperCase())}</b></p>
      <div class="thanks">THANK YOU FOR YOUR BUSINESS!</div>
    </div>
  </div>
  <img class="watermark" src="${origin}/invoice/watermark.svg" alt="">
  <div class="foot"><div class="tab"><img src="${origin}/invoice/logo.svg" alt=""></div></div>
</div>
<script>
  window.addEventListener('load', function () {
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(function () { window.print() }, 300) })
  })
</script>
</body></html>`
}

// Opens a blank window straight away (so pop-up blockers allow it), then fills it in.
export function openInvoiceWindow() {
  return window.open('', '_blank')
}

export function showInvoice(win: Window, html: string) {
  win.document.open()
  win.document.write(html)
  win.document.close()
}
