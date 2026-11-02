export type Role = 'staff' | 'manager' | 'founder'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: Role
}

export interface Model {
  id: string
  model_number: string
  name: string | null
  sizes: string[]
  notes: string | null
  reorder_level?: number | null // low-stock level; missing until 03-calendar-and-low-stock.sql is run
  kind?: 'machine' | 'accessory' // missing until 04-accessories-and-task-rules.sql is run
  fits_models?: string[] // for accessories: the machine models it fits
  category?: 'Construction' | 'Forestry' | 'Agriculture' | null // missing until 05-categories.sql is run
  price?: number | null // selling price INCLUDING VAT (see 09-prices-include-vat.sql); missing until 07-sales.sql is run
  size_prices?: Record<string, number> // price per size (inc VAT) for models with sizes; missing until 08-size-prices.sql is run
  created_at: string
}

export type MachineStatus = 'in_stock' | 'en_route' | 'sold'

export interface Machine {
  id: string
  model_id: string
  size: string | null
  serial_number: string | null
  status: MachineStatus
  container_ref: string | null
  eta: string | null
  location: string | null
  sold_date: string | null
  notes: string | null
  stock_reference?: string | null // reference typed on the last stock entry (after 12-stock-entry-reference.sql)
  created_at: string
  updated_at: string
}

export interface WaitlistEntry {
  id: string
  customer_name: string
  phone: string | null
  email: string | null
  model_id: string
  size_wanted: string | null
  notes: string | null
  contacted: boolean
  contacted_by: string | null
  contacted_at: string | null
  created_by: string | null
  created_at: string
  // Deposits (after 20-waitlist-deposits.sql)
  deposit_paid?: boolean
  deposit_amount?: number | null
  deposit_date?: string | null
  deposit_by?: string | null
}

export type Priority = 'Low' | 'Normal' | 'High'

export interface Task {
  id: string
  title: string
  assignee_id: string | null
  due_date: string | null
  priority: Priority
  done: boolean
  related_model: string | null
  created_at: string
}

export type HolidayType = 'Annual leave' | 'Sick' | 'Unpaid' | 'Other'
export type HolidayStatus = 'pending' | 'approved' | 'declined'

export interface Holiday {
  id: string
  staff_id: string
  start_date: string
  end_date: string
  type: HolidayType
  note: string | null
  status: HolidayStatus
  created_at: string
}

export interface AuditEntry {
  id: number
  table_name: string
  record_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_by: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_at: string
}

export interface ModelStockSummary {
  model_id: string
  model_number: string
  name: string | null
  sizes: string[]
  in_stock: number
  en_route: number
  sold: number
  waiting: number
}

export interface CalendarEvent {
  id: string
  title: string
  start_date: string
  end_date: string
  note: string | null
  created_by: string | null
  created_at: string
}

export interface CompanySettings {
  company_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  bank_name: string | null
  account_number: string | null
  sort_code: string | null
  vat_number: string | null
  company_number: string | null
  terms: string | null
  prices_include_vat?: boolean // true once 09-prices-include-vat.sql has converted old prices
}

export interface InvoiceLine {
  description: string
  qty: number
  unit_price_inc?: number // price per item INCLUDING 20% VAT (how prices are entered)
  unit_price?: number // older invoices only: price per item excluding VAT
  vat_rate: number // 0.2, or 0 for no VAT (customer then pays the price without VAT)
  model_id?: string // the stock item this line is for (newer invoices), so the warehouse can send it out
  size?: string | null
}

// Invoices never store customer details.
export interface Invoice {
  id: string
  number: number
  invoice_date: string
  lines: InvoiceLine[]
  subtotal: number
  vat: number
  total: number
  created_by: string | null
  created_at: string
}

// A container check-in submitted by staff, waiting for a manager to approve it.
export interface ContainerCheckin {
  id: string
  container_ref: string
  arrive_ids: string[]
  remove_ids: string[]
  extras: { model_id: string; size: string | null; qty: number }[]
  location: string | null
  status: 'pending' | 'approved' | 'rejected'
  submitted_by: string | null
  submitted_at: string
  decided_by: string | null
  decided_at: string | null
}

// A Shopify order waiting to be packed. Only the order number, date and items are kept (no customer details).
export interface ShopifyOrder {
  id: number // rounded in the browser (Shopify ids are too long): use id_text to find the row
  id_text: string
  name: string // e.g. #1052
  ordered_at: string
  items: { key: string; title: string; qty: number }[]
}

// Which Shopify listing is which hub item. No model = not a stock item.
export interface ShopifyLink {
  item_key: string
  model_id: string | null
  size: string | null
  title: string
}

// An after-sales query. The chat itself stays in WhatsApp: no customer details here.
export type AfterSalesStatus = 'waiting' | 'diagnosing' | 'resolved'
export interface AfterSalesQuery {
  id: number
  invoice_ref: string
  model_id: string | null
  issue: string
  assignee_id: string | null
  urgent: boolean
  status: AfterSalesStatus
  updates: { at: string; by: string | null; text: string }[]
  created_by: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

// Machines and accessories ordered from the factory, still being built.
export interface ProductionItem {
  model_id: string
  size: string | null
  qty: number
}
export interface ProductionOrder {
  id: string
  ref: string
  ready_date: string | null // expected to leave the factory
  eta: string | null // expected arrival in the UK
  items: ProductionItem[]
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// The factory invoice for a production order / container. Founder only.
export interface StockDocument {
  id: string
  production_id: string | null
  container_ref: string | null
  path: string
  name: string
  uploaded_at: string
}
