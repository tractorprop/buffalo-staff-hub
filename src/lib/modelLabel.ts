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

export const isMachine = (m: Pick<Model, 'kind'> | undefined) => m?.kind !== 'accessory'
