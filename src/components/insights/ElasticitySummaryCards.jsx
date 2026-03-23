import {
  Activity,
  BadgeIndianRupee,
  Gauge,
  Package,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { formatCurrency } from '../../utils/insightsUtils'

const formatPct = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`

const formatPriceDelta = (deltaValue, deltaPct) => {
  const arrow = deltaValue >= 0 ? '↑' : '↓'
  return `${arrow} ₹${formatCurrency(Math.abs(deltaValue))} (${formatPct(deltaPct)})`
}

const MetricCard = ({ label, value, delta, tone = 'default', icon: Icon }) => {
  const toneClass =
    tone === 'accent'
      ? 'border-amber-200 bg-gradient-to-b from-amber-50 to-white'
      : tone === 'success'
        ? 'border-emerald-200 bg-gradient-to-b from-emerald-50 to-white'
        : tone === 'danger'
          ? 'border-rose-200 bg-gradient-to-b from-rose-50 to-white'
        : 'border-slate-200 bg-gradient-to-b from-slate-50 to-white'

  const iconClass =
    tone === 'accent'
      ? 'bg-amber-100 text-amber-700'
      : tone === 'success'
        ? 'bg-emerald-100 text-emerald-700'
        : tone === 'danger'
          ? 'bg-rose-100 text-rose-700'
        : 'bg-blue-100 text-blue-700'

  return (
    <div className={`h-[110px] rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-800">{value}</p>
      {delta && <p className="mt-1 text-xs font-medium text-slate-500">{delta}</p>}
    </div>
  )
}

const ElasticitySummaryCards = ({
  anchorRow,
  ownElasticity,
  currentPointElasticity,
  revenueCurrent,
  revenueMax,
  revenueMaxPrice,
  volumeAtRevenueMax,
}) => {
  const shortProductName = String(anchorRow?.productName || '')
    .replace(/^Brand\s+/i, '')
    .replace(/^MSG\s+/i, '')
    .replace(/\s*Tee$/i, '')

  const priceDelta = revenueMaxPrice - anchorRow.currentPrice
  const priceDeltaPct = (priceDelta / anchorRow.currentPrice) * 100
  const volumeDeltaPct = ((volumeAtRevenueMax - anchorRow.volume) / anchorRow.volume) * 100
  const revenueUpliftPct = ((revenueMax - revenueCurrent) / revenueCurrent) * 100
  const effectiveElasticity = currentPointElasticity ?? ownElasticity
  const absElasticity = Math.abs(effectiveElasticity)

  let recommendation = 'Hold Price'
  let recommendationClass = 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (absElasticity > 1.1) {
    recommendation = 'Price Reduction Recommended'
    recommendationClass = 'border-rose-200 bg-rose-50 text-rose-800'
  } else if (absElasticity < 0.9) {
    recommendation = 'Price Increase Opportunity'
    recommendationClass = 'border-blue-200 bg-blue-50 text-blue-800'
  }

  return (
    <div className="panel p-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pricing Recommendation</p>
          <span className={`mt-1 inline-flex rounded-md border px-2.5 py-1 text-xs font-bold ${recommendationClass}`}>
            {recommendation}
          </span>
        </div>
        <div className="pt-1 text-center">
          <h3 className="text-xl font-bold text-slate-800">Product Summary</h3>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{shortProductName}</p>
        </div>
        <div className="justify-self-end rounded-lg border border-slate-200 bg-white px-3 py-2 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Own Price Elasticity</p>
          <p className="text-2xl font-extrabold text-slate-900">{effectiveElasticity.toFixed(3)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Current Price"
          value={`INR ${formatCurrency(anchorRow.currentPrice)}`}
          icon={BadgeIndianRupee}
        />
        <MetricCard label="Current Volume" value={formatCurrency(anchorRow.volume)} icon={Package} />
        <MetricCard
          label="Revenue @ Current Price"
          value={`INR ${formatCurrency(revenueCurrent)}`}
          icon={TrendingDown}
        />
        <MetricCard
          label="Revenue-Maximizing Price"
          value={`INR ${formatCurrency(revenueMaxPrice)}`}
          delta={formatPriceDelta(priceDelta, priceDeltaPct)}
          tone={priceDelta >= 0 ? 'success' : 'danger'}
          icon={Gauge}
        />
        <MetricCard
          label="Volume @ Revenue-Max Price"
          value={formatCurrency(volumeAtRevenueMax)}
          delta={`${formatPct(volumeDeltaPct)} vs current`}
          icon={TrendingUp}
        />
        <MetricCard
          label="Potential Max Revenue"
          value={`INR ${formatCurrency(revenueMax)}`}
          delta={`${formatPct(revenueUpliftPct)} vs current`}
          tone={revenueUpliftPct >= 0 ? 'success' : 'danger'}
          icon={Activity}
        />
      </div>
    </div>
  )
}

export default ElasticitySummaryCards
