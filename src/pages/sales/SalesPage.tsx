import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLive } from '../../lib/useLive'
import { useAuth } from '../../auth/AuthProvider'
import type { CompanySettings, Invoice, Model } from '../../lib/types'
import { ErrorText, Loading } from '../../components/ui'
import { NewInvoice } from './NewInvoice'
import { InvoiceHistory } from './InvoiceHistory'
import { PriceList } from './PriceList'
import { CompanyDetails } from './CompanyDetails'

export interface SalesData {
  models: Model[]
  invoices: Invoice[]
  company: CompanySettings | null
  missing: boolean // true until database/07-sales.sql has been run
}

async function load() {
  const [models, invoices, company] = await Promise.all([
    supabase!.from('models').select('*').order('model_number'),
    supabase!.from('invoices').select('*').order('number', { ascending: false }).limit(500),
    supabase!.from('company_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  if (models.error) return { data: null, error: models.error }
  return {
    data: {
      models: models.data as Model[],
      invoices: (invoices.data as Invoice[] | null) ?? [],
      company: (company.data as CompanySettings | null) ?? null,
      missing: !!invoices.error || !!company.error,
    },
    error: null,
  }
}

const tabs = [
  { key: 'new', label: '🧾 New invoice' },
  { key: 'history', label: '📚 Invoice history' },
  { key: 'prices', label: '£ Price list' },
  { key: 'company', label: '🏢 Company details' },
] as const

export function SalesPage() {
  const { isManager } = useAuth()
  const { data, error, loading } = useLive<SalesData>(['models', 'invoices', 'company_settings'], load)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'new'

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sales</h1>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs
          .filter((t) => t.key !== 'company' || isManager)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.key
                  ? 'border-brand-600 text-brand-700 dark:text-brand-500'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      <ErrorText>{error}</ErrorText>
      {loading ? (
        <Loading />
      ) : !data ? null : data.missing ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Sales is not switched on yet. A manager needs to run <code>database/07-sales.sql</code> in Supabase.
        </p>
      ) : tab === 'history' ? (
        <InvoiceHistory data={data} />
      ) : tab === 'prices' ? (
        <PriceList models={data.models} />
      ) : tab === 'company' && isManager ? (
        <CompanyDetails company={data.company} />
      ) : (
        <NewInvoice data={data} />
      )}
    </div>
  )
}
