import { brand } from '../brand'

export function Logo({ className = 'h-9 w-auto' }: { className?: string }) {
  if (brand.logoUrl) return <img src={brand.logoUrl} alt={brand.logoText} className={className} />
  return <span className="font-black tracking-widest text-brand-500">{brand.logoText}</span>
}
