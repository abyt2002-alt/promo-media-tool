import { useEffect, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '../../utils/insightsUtils'

const CHART_HEIGHT = 310

const formatCompactValue = (value) => {
  const abs = Math.abs(value)

  if (abs >= 1_000_000) {
    const scaled = value / 1_000_000
    return `${scaled.toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  }

  if (abs >= 1_000) {
    const scaled = value / 1_000
    return `${scaled.toFixed(abs >= 100_000 ? 0 : 1)}K`
  }

  return formatCurrency(value)
}

const normalizeRevenuePoints = (points) => {
  const valid = (points || [])
    .filter((point) => Number.isFinite(point?.price) && Number.isFinite(point?.revenue))
    .sort((a, b) => a.price - b.price)

  const deduped = []
  const seen = new Set()
  valid.forEach((point) => {
    const key = Number(point.price).toFixed(2)
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(point)
    }
  })

  return deduped
}

const buildRevenueFallback = (currentPoint) => {
  const basePrice = Number.isFinite(currentPoint?.price) ? currentPoint.price : 500
  const baseRevenue = Number.isFinite(currentPoint?.revenue) ? currentPoint.revenue : 500000
  const step = Math.max(8, basePrice * 0.04)

  return [-2, -1, 0, 1, 2].map((idx) => {
    const price = basePrice + idx * step
    const curvature = Math.max(baseRevenue * 0.03, 5000)
    const revenue = Math.max(1000, baseRevenue - idx * idx * curvature + (idx === 0 ? 0 : -curvature * 0.1))
    return { price, revenue }
  })
}

const RevenueTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-xs text-slate-600">Price: INR {formatCurrency(point.price)}</p>
      <p className="text-xs text-slate-600">Revenue: INR {formatCurrency(point.revenue)}</p>
    </div>
  )
}

const useChartWidth = () => {
  const hostRef = useRef(null)
  const [chartWidth, setChartWidth] = useState(0)

  useEffect(() => {
    const node = hostRef.current
    if (!node) return undefined

    let raf = null
    const update = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const width = Math.floor(node.getBoundingClientRect().width || node.clientWidth || 0)
        if (width > 0) {
          setChartWidth(Math.max(320, width - 2))
        }
      })
    }

    update()
    const t1 = setTimeout(update, 50)
    const t2 = setTimeout(update, 250)

    let observer
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update)
      observer.observe(node)
    }
    window.addEventListener('resize', update)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      if (raf) cancelAnimationFrame(raf)
      if (observer) observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  return { hostRef, chartWidth }
}

const RevenueCurveChart = ({ points, currentPoint, maxPoint, visible = true }) => {
  const { hostRef, chartWidth } = useChartWidth()

  if (!visible) {
    return <div className="panel p-4 text-sm text-slate-500">Revenue curve hidden by filter.</div>
  }

  const normalized = normalizeRevenuePoints(points)
  const data = normalized.length >= 2 ? normalized : buildRevenueFallback(currentPoint)

  const currentPlotPoint = data.reduce((best, point) => {
    const currentGap = Math.abs(point.price - (currentPoint?.price ?? point.price))
    const bestGap = Math.abs(best.price - (currentPoint?.price ?? best.price))
    return currentGap < bestGap ? point : best
  }, data[0])

  const maxAnchorPrice = Number.isFinite(maxPoint?.price)
    ? maxPoint.price
    : data.reduce((best, point) => (point.revenue > best.revenue ? point : best), data[0]).price

  const maxPlotPoint = data.reduce((best, point) => {
    const currentGap = Math.abs(point.price - maxAnchorPrice)
    const bestGap = Math.abs(best.price - maxAnchorPrice)
    return currentGap < bestGap ? point : best
  }, data[0])

  const currentIdx = data.findIndex((point) => point.price === currentPlotPoint.price)
  const maxIdx = data.findIndex((point) => point.price === maxPlotPoint.price)
  const labelsTooClose = Math.abs(currentIdx - maxIdx) <= 1

  return (
    <div className="panel flex h-full flex-col p-4">
      <h3 className="text-lg font-bold text-slate-800">Revenue Curve</h3>
      <p className="mt-1 text-xs text-slate-500">Price vs revenue.</p>
      <div ref={hostRef} className="mt-3 h-[310px] flex-1">
        {chartWidth > 0 ? (
          <ComposedChart
            key={`revenue-${data.length}-${data[0]?.price}-${data[data.length - 1]?.price}`}
            width={chartWidth}
            height={CHART_HEIGHT}
            data={data}
            margin={{ top: 24, right: 20, left: 8, bottom: 14 }}
          >
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="price"
              domain={['auto', 'auto']}
              tick={{ fontSize: 11 }}
              tickMargin={8}
              tickFormatter={(value) => formatCurrency(value)}
              label={{
                value: 'Price (INR)',
                position: 'insideBottom',
                offset: -6,
                fontSize: 12,
                fontWeight: 700,
                fill: '#0F172A',
              }}
            />
            <YAxis
              type="number"
              domain={['auto', 'auto']}
              tick={{ fontSize: 11 }}
              tickMargin={8}
              tickFormatter={(value) => formatCompactValue(value)}
              label={{
                value: 'Revenue (INR)',
                angle: -90,
                position: 'insideLeft',
                fontSize: 12,
                fontWeight: 700,
                fill: '#0F172A',
              }}
            />
            <Tooltip content={<RevenueTooltip />} />
            <Area
              type="linear"
              dataKey="revenue"
              stroke="none"
              fill="#16A34A"
              fillOpacity={0.14}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
            />
            <Line
              type="linear"
              dataKey="revenue"
              stroke="#16A34A"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4, fill: '#ffffff', stroke: '#16A34A', strokeWidth: 2 }}
              isAnimationActive
              animationDuration={1000}
              animationEasing="ease-out"
            />
            <ReferenceDot
              x={currentPlotPoint.price}
              y={currentPlotPoint.revenue}
              r={6}
              fill="#2563EB"
              stroke="#2563EB"
              strokeWidth={2}
              isFront
              label={{ value: 'Current', position: labelsTooClose ? 'top' : 'bottom', fill: '#0F172A', fontSize: 11 }}
            />
            <ReferenceDot
              x={maxPlotPoint.price}
              y={maxPlotPoint.revenue}
              r={6}
              fill="#F59E0B"
              stroke="#F59E0B"
              strokeWidth={2}
              isFront
              label={{ value: 'Max', position: labelsTooClose ? 'bottom' : 'top', fill: '#0F172A', fontSize: 11 }}
            />
          </ComposedChart>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">Loading chart...</div>
        )}
      </div>
      <div className="mt-3 h-8" />
    </div>
  )
}

export default RevenueCurveChart


