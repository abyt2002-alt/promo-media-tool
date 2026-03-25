import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Loader2 } from 'lucide-react'
import AppLayout from '../components/layout/AppLayout'
import { getHistoricalPromoCalendar } from '../services/promoCalendarApi'

const HISTORICAL_CACHE_KEY = 'promo_historical_calendar_cache_v1'

const formatPct = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
const formatInr = (value) => `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))}`
const formatInt = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))

const getDiscountCellClass = (value) => {
  const v = Number(value) || 0
  if (v <= 0.01) return 'border-slate-200 bg-slate-100 text-slate-500'
  if (v <= 10) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (v <= 20) return 'border-sky-200 bg-sky-50 text-sky-700'
  if (v <= 30) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

const HistoricalPromoCalendarPage = ({ layoutProps = {} }) => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedCell, setSelectedCell] = useState(null)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await getHistoricalPromoCalendar()
      setData(response)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(HISTORICAL_CACHE_KEY, JSON.stringify(response))
      }
    } catch (err) {
      setError(err?.message || 'Failed to load historical promo calendar.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(HISTORICAL_CACHE_KEY)
        if (cached) {
          const parsed = JSON.parse(cached)
          if (parsed && Array.isArray(parsed.products)) {
            setData(parsed)
            return
          }
        }
      } catch {
        // ignore cache parse failure
      }
    }
    loadData()
  }, [])

  const groupedRows = useMemo(() => {
    const products = data?.products ?? []
    const weeks = data?.weeks ?? []
    const byPrice = new Map()

    products.forEach((row) => {
      const basePrice = Number(row.base_price) || 0
      const key = Math.round(basePrice)
      if (!byPrice.has(key)) {
        byPrice.set(key, {
          pricePoint: key,
          productCount: 0,
          totalVolume: 0,
          weightedDiscountNumerator: 0,
          weeklyVolumeByWeek: new Array(weeks.length).fill(0),
          weeklyDiscountNumeratorByWeek: new Array(weeks.length).fill(0),
          products: [],
        })
      }
      const bucket = byPrice.get(key)
      const vol = Number(row.total_volume) || 0
      const avgDiscount = Number(row.avg_discount_pct) || 0
      const weeklyDiscount = Array.isArray(row.weekly_discount_pct) ? row.weekly_discount_pct : []

      bucket.productCount += 1
      bucket.totalVolume += vol
      bucket.weightedDiscountNumerator += avgDiscount * vol
      bucket.products.push({
        productName: row.product_name,
        basePrice: Number(row.base_price) || 0,
        totalVolume: vol,
        avgDiscountPct: avgDiscount,
        weeklyDiscount,
      })

      weeklyDiscount.forEach((discount, idx) => {
        const w = Number(discount) || 0
        bucket.weeklyVolumeByWeek[idx] += vol
        bucket.weeklyDiscountNumeratorByWeek[idx] += w * vol
      })
    })

    const rows = Array.from(byPrice.values()).map((bucket) => {
      const weeklyAvgDiscount = bucket.weeklyDiscountNumeratorByWeek.map((num, idx) => {
        const den = bucket.weeklyVolumeByWeek[idx]
        return den > 0 ? num / den : 0
      })
      return {
        pricePoint: bucket.pricePoint,
        productCount: bucket.productCount,
        avgDiscountPct:
          bucket.totalVolume > 0
            ? bucket.weightedDiscountNumerator / bucket.totalVolume
            : 0,
        weeklyAvgDiscount,
        products: bucket.products,
      }
    })

    rows.sort((a, b) => a.pricePoint - b.pricePoint)
    return rows
  }, [data])

  const selectedWeekNumber = selectedCell ? (data?.weeks?.[selectedCell.weekIndex] ?? null) : null
  const selectedWeekLabel = selectedCell ? `W${(selectedCell.weekIndex ?? 0) + 1}` : ''
  const selectedGroupProducts = useMemo(() => {
    if (!selectedCell || !groupedRows.length) return []
    const group = groupedRows.find((row) => row.pricePoint === selectedCell.pricePoint)
    if (!group) return []
    return (group.products ?? [])
      .map((item) => ({
        ...item,
        weekDiscount: Number(item.weeklyDiscount?.[selectedCell.weekIndex] || 0),
      }))
      .sort((a, b) => b.weekDiscount - a.weekDiscount)
  }, [groupedRows, selectedCell])

  useEffect(() => {
    if (!selectedCell) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedCell(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedCell])

  return (
    <AppLayout {...layoutProps}>
      <div className="space-y-6">
        <div className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-slate-800">Weekly Promo Calendar (Historical)</h3>
              <p className="mt-1 text-xs font-medium text-slate-600">
                Each cell shows weighted average discount % for that price group in that week.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
              <CalendarDays className="h-4 w-4 text-[#2563EB]" />
              Weeks: {(data?.weeks ?? []).length}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600">
            <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-500">No Promo</span>
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">1-10%</span>
            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">11-20%</span>
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">21-30%</span>
            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">&gt;30%</span>
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          {loading && (
            <div className="mt-6 flex items-center justify-center text-sm font-semibold text-slate-600">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading historical promo calendar...
            </div>
          )}

          {!loading && !error && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full table-fixed divide-y divide-slate-200 text-xs">
                <colgroup>
                  <col style={{ width: '14%' }} />
                  {(data?.weeks ?? []).map((week, idx) => (
                    <col key={`w-${week}-${idx}`} style={{ width: `${86 / Math.max(1, (data?.weeks ?? []).length)}%` }} />
                  ))}
                </colgroup>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      Price Group
                    </th>
                    {(data?.weeks ?? []).map((week, idx) => (
                      <th key={`head-${week}-${idx}`} className="px-1 py-1 text-center text-[10px] font-bold text-slate-600">
                        W{idx + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {groupedRows.map((row) => (
                    <tr key={`group-${row.pricePoint}`}>
                      <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-2 py-1.5 align-top">
                        <p className="text-sm font-bold text-slate-800">{formatInr(row.pricePoint)}</p>
                        <p className="text-[11px] font-medium text-slate-500">
                          {formatInt(row.productCount)} products · Avg {formatPct(row.avgDiscountPct)}
                        </p>
                      </td>
                      {row.weeklyAvgDiscount.map((value, idx) => (
                        <td key={`${row.pricePoint}-${idx}`} className="px-1 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedCell({ pricePoint: row.pricePoint, weekIndex: idx })}
                            className={`inline-flex h-6 w-full items-center justify-center rounded border px-1 text-[10px] font-bold ${getDiscountCellClass(value)}`}
                            title="View products for this price group and week"
                          >
                            {value <= 0.01 ? '-' : `${Math.round(value)}%`}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selectedCell && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => setSelectedCell(null)}
        >
          <div
            className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h4 className="text-lg font-bold text-slate-800">
                  {formatInr(selectedCell.pricePoint)} · {selectedWeekLabel}
                </h4>
                <p className="text-xs font-medium text-slate-600">
                  Raw Week: {selectedWeekNumber ?? '-'} · Products: {selectedGroupProducts.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCell(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto p-4">
              <table className="w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600">Product</th>
                    <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Base Price</th>
                    <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Volume</th>
                    <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Avg Discount</th>
                    <th className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Discount ({selectedWeekLabel})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {selectedGroupProducts.map((item) => (
                    <tr key={`${item.productName}-${item.basePrice}`}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{item.productName}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatInr(item.basePrice)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatInt(item.totalVolume)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-bold ${getDiscountCellClass(item.avgDiscountPct)}`}>
                          {formatPct(item.avgDiscountPct)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-bold ${getDiscountCellClass(item.weekDiscount)}`}>
                          {item.weekDiscount <= 0.01 ? '-' : formatPct(item.weekDiscount)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default HistoricalPromoCalendarPage
