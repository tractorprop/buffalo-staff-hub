import type { Model } from './types'

type Labelled = Pick<Model, 'model_number'> & Partial<Pick<Model, 'kind' | 'fits_models'>>

// How a model is named across the app. Accessories get the machine(s) they fit
// added, e.g. "Thumb" that fits the B600 shows as "Thumb B600".
export function modelLabel(m: Labelled | undefined, models: Pick<Model, 'id' | 'model_number'>[], size?: string | null) {
  if (!m) return '?'
  let label = m.model_number
  if (m.kind === 'accessory' && m.fits_models?.length) {
    const fits = m.fits_models
      .map((id) => models.find((x) => x.id === id)?.model_number)
      .filter((n): n is string => !!n && !label.toLowerCase().includes(n.toLowerCase()))
    if (fits.length) label += ` ${fits.join('/')}`
  }
  return size ? `${label} ${size}` : label
}

export function labelFor(id: string, models: (Labelled & Pick<Model, 'id'>)[], size?: string | null) {
  return modelLabel(
    models.find((m) => m.id === id),
    models,
    size,
  )
}

// How an item is written on an invoice line, e.g. "Mini Digger (B600)" or "Thumb B600 Large".
export function invoiceDescription(m: Model, models: Model[], size?: string | null) {
  const base = isMachine(m) && m.name ? `${m.name} (${m.model_number})` : modelLabel(m, models)
  return size ? `${base} ${size}` : base
}

export const isMachine = (m: Pick<Model, 'kind'> | undefined) => m?.kind !== 'accessory'

type LowStockInfo = Pick<Model, 'model_number' | 'name'> & Partial<Pick<Model, 'kind' | 'category' | 'reorder_level'>>

// Tractor implements: agriculture models, or anything named "implement". Their low stock is checked per size.
export const isImplement = (m: LowStockInfo) =>
  m.kind !== 'accessory' && (m.category === 'Agriculture' || /implement/i.test(`${m.model_number} ${m.name ?? ''}`))

// Default low stock levels, used when a model has no level of its own.
export function defaultLowStock(m: LowStockInfo): number | null {
  if (isImplement(m)) return 4
  if (m.kind === 'accessory') return 10
  const text = `${m.model_number} ${m.name ?? ''}`.toLowerCase()
  if (/dumper/.test(text)) return 7
  if (/digger|excavator|skid/.test(text)) return 10
  return null
}

// The low stock level that applies: the model's own, otherwise the default for its type.
export const lowStockLevel = (m: LowStockInfo) => m.reorder_level ?? defaultLowStock(m)
