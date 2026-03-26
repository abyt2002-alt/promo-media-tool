import { useMemo, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { formatYearMonthLabel } from '../../utils/insightsUtils'

const SelectControl = ({ label, value, options, onChange }) => {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const ACTION_CONFIG = {
  reduce: {
    label: 'Reduce Price',
    subtitle: 'High price sensitivity',
    rule: '|ELS| > 1.1',
    recommendation:
      'Products in this bucket are highly price sensitive. Consider reducing ASP selectively.',
    card: 'border-rose-200 bg-rose-50',
    badge: 'bg-rose-100 text-rose-700',
  },
  hold: {
    label: 'Hold Price',
    subtitle: 'Healthy pricing zone',
    rule: '0.9 <= |ELS| <= 1.1',
    recommendation:
      'Products in this bucket are near the target elasticity zone. Maintain current ASP.',
    card: 'border-emerald-200 bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  increase: {
    label: 'Increase Price',
    subtitle: 'Price headroom available',
    rule: '|ELS| < 0.9',
    recommendation:
      'Products in this bucket show price headroom. Consider testing ASP increases.',
    card: 'border-blue-200 bg-blue-50',
    badge: 'bg-blue-100 text-blue-700',
  },
}

const ActionCard = ({ actionKey, items, onClick }) => {
  const cfg = ACTION_CONFIG[actionKey]
  const avgElasticity = items.length
    ? items.reduce((sum, item) => sum + item.avgElasticity, 0) / items.length
    : 0
  const avgAsp = items.length
    ? items.reduce((sum, item) => sum + item.avgAsp, 0) / items.length
    : 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-2 text-left transition hover:brightness-[0.98] ${cfg.card}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-800">{cfg.label}</p>
          <p className="text-[10px] font-medium text-slate-600">{cfg.subtitle}</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${cfg.badge}`}>{items.length}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-white/70 p-1.5">
        <div>
          <p className="text-[10px] font-medium text-slate-500">Avg Elasticity</p>
          <p className="text-xs font-bold text-slate-700">{items.length ? avgElasticity.toFixed(3) : '-'}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-slate-500">Avg ASP</p>
          <p className="text-xs font-bold text-slate-700">{items.length ? `INR ${Math.round(avgAsp)}` : '-'}</p>
        </div>
      </div>
    </button>
  )
}

const InsightsSidebar = ({
  month,
  monthOptions,
  product,
  productOptions,
  onMonthChange,
  onProductChange,
  portfolioElasticityBands,
  onReset,
}) => {
  const [activeAction, setActiveAction] = useState(null)

  const actionItems = useMemo(
    () => ({
      reduce: portfolioElasticityBands?.reduce ?? [],
      hold: portfolioElasticityBands?.hold ?? [],
      increase: portfolioElasticityBands?.increase ?? [],
    }),
    [portfolioElasticityBands],
  )

  return (
    <div className="space-y-3">
      <div className="panel p-4">
        <h3 className="text-base font-bold text-slate-800">Insights Controls</h3>

        <div className="mt-3 space-y-2.5">
          <SelectControl
            label="Week"
            value={month}
            options={monthOptions.map((option) => ({ value: option, label: formatYearMonthLabel(option) }))}
            onChange={onMonthChange}
          />

          <SelectControl
            label="Curve Product"
            value={product}
            options={productOptions.map((option) => ({ value: option, label: option }))}
            onChange={onProductChange}
          />

          <button
            type="button"
            onClick={onReset}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset Filters
          </button>
        </div>
      </div>

      {portfolioElasticityBands && (
        <div className="panel p-4">
          <h3 className="text-sm font-bold text-slate-800">Portfolio Pricing Actions</h3>
          <p className="mt-1 text-[11px] text-slate-500">Based on absolute own-price elasticity (|ELS|)</p>

          <div className="mt-2.5 space-y-1.5">
            <ActionCard
              actionKey="reduce"
              items={actionItems.reduce}
              onClick={() => setActiveAction('reduce')}
            />
            <ActionCard
              actionKey="hold"
              items={actionItems.hold}
              onClick={() => setActiveAction('hold')}
            />
            <ActionCard
              actionKey="increase"
              items={actionItems.increase}
              onClick={() => setActiveAction('increase')}
            />
          </div>
        </div>
      )}

      {activeAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close details"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setActiveAction(null)}
          />

          <div className="relative z-10 max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  {ACTION_CONFIG[activeAction].label} - Product Summary
                </h4>
                <p className="text-xs text-slate-500">
                  These are the average elasticity values at average ASP levels.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAction(null)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Product</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Avg Elasticity</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Avg ASP</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Current ASP</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Suggested Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(actionItems[activeAction] ?? [])
                    .slice()
                    .sort((a, b) => a.productName.localeCompare(b.productName))
                    .map((item) => (
                      <tr key={item.productName} className="bg-white">
                        <td className="px-3 py-2 text-slate-700">{item.productName}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{item.avgElasticity.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right text-slate-700">INR {Math.round(item.avgAsp)}</td>
                        <td className="px-3 py-2 text-right text-slate-700">INR {Math.round(item.currentAsp)}</td>
                        <td className="px-3 py-2 text-slate-700">{item.suggestedAction}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default InsightsSidebar
