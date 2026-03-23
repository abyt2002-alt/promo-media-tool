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

const normalizeDemandPoints = (points) => {
  const valid = (points || [])
    .filter((point) => Number.isFinite(point?.price) && Number.isFinite(point?.predictedDemand))
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

const buildDemandFallback = (currentPoint) => {
  const basePrice = Number.isFinite(currentPoint?.price) ? currentPoint.price : 500
  const baseDemand = Number.isFinite(currentPoint?.predictedDemand) ? currentPoint.predictedDemand : 1000

  return [-2, -1, 0, 1, 2].map((step) => {
    const price = basePrice + step * Math.max(8, basePrice * 0.04)
    const predictedDemand = Math.max(10, baseDemand - step * Math.max(20, baseDemand * 0.08))
    return { price, predictedDemand }
  })
}

const DemandTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-xs text-slate-600">Price: INR {formatCurrency(point.price)}</p>
      <p className="text-xs text-slate-600">Predicted Demand: {formatCurrency(point.predictedDemand)}</p>
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

const DemandCurveChart = ({ points, currentPoint, maxRevenuePrice, visible = true }) => {
  const { hostRef, chartWidth } = useChartWidth()

  if (!visible) {
    return <div className="panel p-4 text-sm text-slate-500">Demand curve hidden by filter.</div>
  }

  const normalized = normalizeDemandPoints(points)
  const data = normalized.length >= 2 ? normalized : buildDemandFallback(currentPoint)
  const maxPriceForRegion = Number.isFinite(maxRevenuePrice) ? maxRevenuePrice : currentPoint?.price

  const currentPlotPoint = data.reduce((best, point) => {
    const currentGap = Math.abs(point.price - (currentPoint?.price ?? point.price))
    const bestGap = Math.abs(best.price - (currentPoint?.price ?? best.price))
    return currentGap < bestGap ? point : best
  }, data[0])

  const maxPoint = data.reduce((best, point) => {
    const currentGap = Math.abs(point.price - (maxPriceForRegion ?? point.price))
    const bestGap = Math.abs(best.price - (maxPriceForRegion ?? best.price))
    return currentGap < bestGap ? point : best
  }, data[0])

  const currentIdx = data.findIndex((point) => point.price === currentPlotPoint.price)
  const maxIdx = data.findIndex((point) => point.price === maxPoint.price)
  const labelsTooClose = Math.abs(currentIdx - maxIdx) <= 1
  const chartData = data.map((point) => ({
    ...point,
    maxRegion: point.price <= maxPoint.price ? point.predictedDemand : null,
    currentRegion: point.price <= currentPlotPoint.price ? point.predictedDemand : null,
  }))

  return (
    <div className="panel flex h-full flex-col p-4">
      <h3 className="text-lg font-bold text-slate-800">Demand Curve</h3>
      <p className="mt-1 text-xs text-slate-500">Price vs predicted volume.</p>
      <div ref={hostRef} className="mt-3 h-[310px] flex-1">
        {chartWidth > 0 ? (
          <ComposedChart
            key={`demand-${data.length}-${data[0]?.price}-${data[data.length - 1]?.price}`}
            width={chartWidth}
            height={CHART_HEIGHT}
            data={chartData}
            margin={{ top: 24, right: 20, left: 8, bottom: 14 }}
          >
            <defs>
              <linearGradient id="demandCurrentGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563EB" stopOpacity={0.30} />
                <stop offset="95%" stopColor="#2563EB" stopOpacity={0.06} />
              </linearGradient>
              <linearGradient id="demandMaxGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.26} />
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.04} />
              </linearGradient>
            </defs>
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
              tickFormatter={(value) => formatCurrency(value)}
              label={{
                value: 'Predicted Volume',
                angle: -90,
                position: 'insideLeft',
                fontSize: 12,
                fontWeight: 700,
                fill: '#0F172A',
              }}
            />
            <Tooltip content={<DemandTooltip />} />
            <Area
              type="linear"
              dataKey="maxRegion"
              stroke="none"
              fill="url(#demandMaxGradient)"
              isAnimationActive
              animationDuration={700}
              animationEasing="ease-out"
            />
            <Area
              type="linear"
              dataKey="currentRegion"
              stroke="none"
              fill="url(#demandCurrentGradient)"
              isAnimationActive
              animationDuration={850}
              animationEasing="ease-out"
            />
            <Line
              type="linear"
              dataKey="predictedDemand"
              stroke="#2563EB"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4, fill: '#ffffff', stroke: '#2563EB', strokeWidth: 2 }}
              isAnimationActive
              animationDuration={950}
              animationEasing="ease-out"
            />
            <ReferenceDot
              x={currentPlotPoint.price}
              y={currentPlotPoint.predictedDemand}
              r={6}
              fill="#2563EB"
              stroke="#2563EB"
              strokeWidth={2}
              isFront
              label={{
                value: 'Current',
                position: labelsTooClose ? 'top' : 'bottom',
                fill: '#0F172A',
                fontSize: 11,
              }}
            />
            <ReferenceDot
              x={maxPoint.price}
              y={maxPoint.predictedDemand}
              r={5}
              fill="#F59E0B"
              stroke="#F59E0B"
              strokeWidth={2}
              isFront
              label={{
                value: 'Max',
                position: labelsTooClose ? 'bottom' : 'top',
                fill: '#0F172A',
                fontSize: 11,
              }}
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

export default DemandCurveChart


