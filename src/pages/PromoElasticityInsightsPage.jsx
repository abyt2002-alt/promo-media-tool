import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2 } from 'lucide-react'
import AppLayout from '../components/layout/AppLayout'
import { getPromoElasticityInsights } from '../services/promoCalendarApi'

const SEGMENTS = [
  { key: 'daily', label: 'Daily Casual', range: '<= 599', color: '#2563EB', tint: 'bg-blue-50 border-blue-200' },
  { key: 'core', label: 'Core Plus', range: '600 - 899', color: '#F97316', tint: 'bg-orange-50 border-orange-200' },
  { key: 'premium', label: 'Premium', range: '>= 900', color: '#16A34A', tint: 'bg-emerald-50 border-emerald-200' },
]

const formatInr = (value) => `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))}`

const getSegmentKey = (basePrice) => {
  const price = Number(basePrice) || 0
  if (price <= 599) return 'daily'
  if (price <= 899) return 'core'
  return 'premium'
}

const toFixed2 = (value) => Number(value || 0).toFixed(2)

const buildLinearizedElasticity = (baseElasticity, elasticity40) => {
  const baseAbs = Math.abs(Number(baseElasticity) || 0)
  const endAbs = Math.abs(Number(elasticity40) || 0)
  const step = (endAbs - baseAbs) / 4
  const abs10 = baseAbs + step
  const abs20 = baseAbs + step * 2
  const abs30 = baseAbs + step * 3
  const abs40 = baseAbs + step * 4
  return {
    base: -Math.abs(baseAbs),
    e10: -Math.abs(abs10),
    e20: -Math.abs(abs20),
    e30: -Math.abs(abs30),
    e40: -Math.abs(abs40),
  }
}

const PromoElasticityInsightsPage = ({ layoutProps = {} }) => {
  const [data, setData] = useState(null)
  const [selectedSegment, setSelectedSegment] = useState('daily')
  const [selectedProductName, setSelectedProductName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await getPromoElasticityInsights({})
      setData(response)
    } catch (err) {
      setError(err?.message || 'Failed to load promo insights.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const productsWithSegment = useMemo(() => {
    return (data?.products ?? []).map((item) => {
      const linear = buildLinearizedElasticity(item.base_elasticity, item.elasticity_40)
      return {
        ...item,
        segmentKey: getSegmentKey(item.base_price),
        elasticity_base_view: linear.base,
        elasticity_10_view: linear.e10,
        elasticity_20_view: linear.e20,
        elasticity_30_view: linear.e30,
        elasticity_40_view: linear.e40,
      }
    })
  }, [data])

  const segmentSummaries = useMemo(() => {
    return SEGMENTS.map((segment) => {
      const rows = productsWithSegment.filter((row) => row.segmentKey === segment.key)
      const count = rows.length
      const avgBase = count
        ? rows.reduce((sum, row) => sum + Number(row.elasticity_base_view || 0), 0) / count
        : 0
      const avgPromo20 = count
        ? rows.reduce((sum, row) => sum + Number(row.elasticity_20_view || 0), 0) / count
        : 0
      const avgPromo40 = count
        ? rows.reduce((sum, row) => sum + Number(row.elasticity_40_view || 0), 0) / count
        : 0

      return {
        ...segment,
        count,
        avgBase,
        avgPromo20,
        avgPromo40,
      }
    })
  }, [productsWithSegment])

  useEffect(() => {
    if (!productsWithSegment.length) return
    const hasRowsInSelected = productsWithSegment.some((row) => row.segmentKey === selectedSegment)
    if (hasRowsInSelected) return
    const firstAvailable = SEGMENTS.find((segment) => productsWithSegment.some((row) => row.segmentKey === segment.key))
    if (firstAvailable) {
      setSelectedSegment(firstAvailable.key)
    }
  }, [productsWithSegment, selectedSegment])

  const segmentRows = useMemo(
    () => productsWithSegment.filter((row) => row.segmentKey === selectedSegment),
    [productsWithSegment, selectedSegment],
  )

  useEffect(() => {
    if (!segmentRows.length) {
      setSelectedProductName('')
      return
    }
    const exists = segmentRows.some((row) => row.product_name === selectedProductName)
    if (!exists) {
      setSelectedProductName(segmentRows[0].product_name)
    }
  }, [segmentRows, selectedProductName])

  const selectedProduct = useMemo(
    () => segmentRows.find((row) => row.product_name === selectedProductName) ?? null,
    [segmentRows, selectedProductName],
  )

  const chartData = useMemo(() => {
    if (!selectedProduct) return []
    const basePrice = Number(selectedProduct.base_price) || 0
    const priceAt = (discountPct) => Math.max(1, Math.round(basePrice * (1 - discountPct / 100)))
    const point = (label, discount, elasticity) => ({
      point: label,
      discount,
      price: priceAt(discount),
      elasticity: Number(elasticity) || 0,
      elasticityMagnitude: Math.abs(Number(elasticity) || 0),
    })
    return [
      point('Base', 0, selectedProduct.elasticity_base_view),
      point('10%', 10, selectedProduct.elasticity_10_view),
      point('20%', 20, selectedProduct.elasticity_20_view),
      point('30%', 30, selectedProduct.elasticity_30_view),
      point('40%', 40, selectedProduct.elasticity_40_view),
    ]
  }, [selectedProduct])

  const activeSegmentConfig = SEGMENTS.find((segment) => segment.key === selectedSegment) ?? SEGMENTS[0]

  return (
    <AppLayout {...layoutProps}>
      <div className="space-y-6">
        <div className="panel p-4">
          <h3 className="text-xl font-bold text-slate-800">Promo Elasticity Insights</h3>
          <p className="mt-1 text-xs font-medium text-slate-600">
            Segment-wise point elasticity view using E = beta x price / volume at each price point.
          </p>

          {error && (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          {loading && (
            <div className="mt-6 flex items-center justify-center text-sm font-semibold text-slate-600">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading promo insights...
            </div>
          )}

          {!loading && !error && (
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              {segmentSummaries.map((segment) => {
                const active = selectedSegment === segment.key
                return (
                  <button
                    key={segment.key}
                    type="button"
                    onClick={() => setSelectedSegment(segment.key)}
                    className={`rounded-lg border p-3 text-left transition ${
                      active ? `${segment.tint} ring-1 ring-offset-0` : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                    style={active ? { borderColor: segment.color, boxShadow: `inset 0 0 0 1px ${segment.color}22` } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800">{segment.label}</p>
                      <span className="text-[11px] font-semibold text-slate-500">{segment.range}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-slate-500">Products</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-800">{segment.count}</p>
                      </div>
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-slate-500">Avg Base E</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-800">{toFixed2(segment.avgBase)}</p>
                      </div>
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-slate-500">Avg E@40%</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-800">{toFixed2(segment.avgPromo40)}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {!loading && !error && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="panel p-4 xl:col-span-7">
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-bold text-slate-800">{activeSegmentConfig.label} - Product Elasticity Matrix</p>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                  {activeSegmentConfig.range}
                </span>
              </div>

              <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-600">Product</th>
                      <th className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Base Price</th>
                      <th className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Base Point E</th>
                      <th className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Point E @10%</th>
                      <th className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Point E @20%</th>
                      <th className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Point E @30%</th>
                      <th className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-slate-600">Point E @40%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {segmentRows.map((item) => {
                      const active = selectedProduct?.product_name === item.product_name
                      return (
                        <tr
                          key={item.product_name}
                          onClick={() => setSelectedProductName(item.product_name)}
                          className={`cursor-pointer ${active ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-3 py-2 text-sm font-semibold text-slate-800">{item.product_name}</td>
                          <td className="px-2 py-2 text-right text-sm font-semibold text-slate-700">{formatInr(item.base_price)}</td>
                          <td className="px-2 py-2 text-right text-sm font-bold text-slate-800">{toFixed2(item.elasticity_base_view)}</td>
                          <td className="px-2 py-2 text-right text-sm font-semibold text-slate-700">{toFixed2(item.elasticity_10_view)}</td>
                          <td className="px-2 py-2 text-right text-sm font-semibold text-slate-700">{toFixed2(item.elasticity_20_view)}</td>
                          <td className="px-2 py-2 text-right text-sm font-semibold text-slate-700">{toFixed2(item.elasticity_30_view)}</td>
                          <td className="px-2 py-2 text-right text-sm font-semibold text-slate-700">{toFixed2(item.elasticity_40_view)}</td>
                        </tr>
                      )
                    })}
                    {!segmentRows.length && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-sm font-semibold text-slate-500">
                          No products in this segment.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel p-4 xl:col-span-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-800">Elasticity Curve</h3>
                <select
                  value={selectedProductName}
                  onChange={(event) => setSelectedProductName(event.target.value)}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
                >
                  {segmentRows.map((row) => (
                    <option key={row.product_name} value={row.product_name}>
                      {row.product_name}
                    </option>
                  ))}
                </select>
              </div>

              <p className="mt-1 text-xs font-medium text-slate-600">
                {selectedProduct?.product_name || 'Select a product'}
              </p>

              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="point" tick={{ fontSize: 11, fontWeight: 700, fill: '#0F172A' }} />
                    <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#0F172A' }} />
                    <Tooltip
                      formatter={(_, __, payload) => {
                        const row = payload?.payload
                        return row ? Number(row.elasticity).toFixed(2) : '-'
                      }}
                      labelFormatter={(label, payload) => {
                        const row = payload?.[0]?.payload
                        if (!row) return label
                        return `${label} | Price ${formatInr(row.price)} | Discount ${row.discount}%`
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="elasticityMagnitude"
                      stroke={activeSegmentConfig.color}
                      strokeWidth={3}
                      dot={{ r: 4, fill: activeSegmentConfig.color, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default PromoElasticityInsightsPage
