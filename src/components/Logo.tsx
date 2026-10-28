import { brand } from '../brand'

export function Logo({ className = '' }: { className?: string }) {
  if (brand.logoUrl) return <img src={brand.logoUrl} alt={brand.logoText} className={`h-8 ${className}`} />
  return (
    <span className={`font-black tracking-widest text-brand-600 dark:text-brand-500 ${className}`}>{brand.logoText}</span>
  )
}
