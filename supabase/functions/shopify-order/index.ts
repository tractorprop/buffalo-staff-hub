// Supabase Edge Function "shopify-order".
// Shopify sends each new order here. This passes it, untouched, to the database
// function receive_shopify_order, which checks Shopify's signature and keeps only
// the order number, date, listings and quantities (no customer details).
// It uses only the public key: no secret keys live here.

const SUPABASE_URL = 'https://ufxyfcjuptrokhbccqww.supabase.co'
const PUBLIC_KEY = 'sb_publishable_utD45YOMKiZ7I5di1hKvWQ_jJZmIdBo'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Buffalo Staff Hub: Shopify orders', { status: 200 })
  const body = await req.text()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/receive_shopify_order`, {
    method: 'POST',
    headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_body: body, p_hmac: req.headers.get('x-shopify-hmac-sha256') }),
  })
  if (!res.ok) console.error('Order not saved:', res.status, await res.text())
  return new Response(res.ok ? 'ok' : 'rejected', { status: res.ok ? 200 : 401 })
})
