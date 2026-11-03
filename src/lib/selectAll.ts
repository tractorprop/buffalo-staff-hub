// The database sends at most 1,000 rows per request, so bigger lists (every machine and
// accessory unit, the activity log) are fetched page by page. The query must have an order.
type Result<T> = { data: T[] | null; error: { message: string; code?: string } | null }
type Paged<T> = { range: (from: number, to: number) => PromiseLike<Result<T>> }

export async function selectAll<T>(build: () => Paged<T>, pageSize = 1000): Promise<Result<T>> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    out.push(...(data ?? []))
    if (!data || data.length < pageSize) return { data: out, error: null }
  }
}
