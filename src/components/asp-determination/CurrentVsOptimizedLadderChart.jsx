import { Save } from 'lucide-react'

const SEGMENTS = [
  { key: 'daily', label: 'Daily Casual' },
  { key: 'core', label: 'Core Plus' },
  { key: 'premium', label: 'Premium' },
]

const getSegmentKey = (price) => {
  if (price <= 599) return 'daily'
  if (price <= 899) return 'core'
  return 'premium'
}

const formatNumber = (value) => Math.round(value).toLocaleString('en-IN')
const formatCurrency = (value) => `INR ${formatNumber(value)}`

const formatMovementLabel = (value) => {
  const rounded = Math.round(value)
  if (rounded > 0) return `\u2191 INR ${Math.abs(rounded).toLocaleString('en-IN')}`
  if (rounded < 0) return `\u2193 INR ${Math.abs(rounded).toLocaleString('en-IN')}`
  return '\u2192 INR 0'
}

const formatSignedPct = (value) => {
  const pct = value * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

const changeTone = (value) => {
  if (value > 0.001) {
    return {
      text: 'text-emerald-700',
      chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      line: 'bg-emerald-500',
    }
  }
  if (value < -0.001) {
    return {
      text: 'text-rose-700',
      chip: 'border-rose-200 bg-rose-50 text-rose-700',
      line: 'bg-rose-500',
    }
  }
  return {
    text: 'text-slate-600',
    chip: 'border-slate-200 bg-slate-50 text-slate-600',
    line: 'bg-slate-400',
  }
}

const volumeTone = (value) => {
  if (value > 0.001) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value < -0.001) return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

const HEADER_GRID_CLASS =
  'grid grid-cols-[minmax(0,1.8fr)_64px_minmax(70px,1fr)_72px_82px] gap-2'

const ROW_GRID_CLASS =
  'grid grid-cols-[minmax(0,1.8fr)_64px_minmax(70px,1fr)_72px_82px] items-center gap-2'

const LadderRowsBlock = ({ rows, inputValues, lockedProducts = {}, onRecommendedInputChange, onRecommendedCommit }) => (
  <div className="divide-y divide-slate-100">
    {rows.map((row) => {
      const baseChange = row.basePriceChange ?? row.aspChange
      const movementTone = changeTone(baseChange)
      const volumeChipClass = volumeTone(row.volumeChangePct)
      const isLocked = Boolean(lockedProducts[row.productName])

      return (
        <div key={row.productName} className={`${ROW_GRID_CLASS} px-2 py-2.5 hover:bg-slate-50/70`}>
          <div className="min-w-0 pr-1">
            <p className="whitespace-normal break-words text-[13px] font-semibold leading-4 text-slate-800">{row.productName}</p>
          </div>

          <div className="relative border-l-2 border-slate-300 pl-1 text-right">
            <span className="text-[13px] font-semibold text-slate-700">{formatCurrency(row.baseAsp ?? row.currentAsp)}</span>
          </div>

          <div className="px-1">
            <div className="flex items-center gap-1.5">
              <div className={`h-[2px] flex-1 rounded-full ${movementTone.line}`} />
              <div className={`h-[2px] flex-1 rounded-full ${movementTone.line}`} />
            </div>
            <div className="mt-1 flex justify-center">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${movementTone.chip}`}>
                {formatMovementLabel(baseChange)}
              </span>
            </div>
          </div>

          <div className="relative border-l-2 border-emerald-300 pl-1 text-right">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={inputValues?.[row.productName] ?? String(Math.round(row.optimizedAsp))}
              disabled={isLocked}
              onChange={(event) => onRecommendedInputChange?.(row.productName, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onRecommendedCommit?.(row.productName)
                }
              }}
              className="w-full rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-right text-[12px] font-bold text-emerald-700 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>

          <div className="text-right">
            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[11px] font-bold ${volumeChipClass}`}>
              Vol: {formatSignedPct(row.volumeChangePct)}
            </span>
          </div>
        </div>
      )
    })}
  </div>
)

const CurrentVsOptimizedLadderChart = ({
  rows = [],
  selectedScenarioName = '',
  inputValues = {},
  lockedProducts = {},
  onRecommendedInputChange,
  onRecommendedCommit,
  onSaveScenario,
  saveLabel = 'Save Scenario',
}) => {
  const sortedRows = [...rows].sort(
    (a, b) => (b.baseAsp ?? b.currentAsp) - (a.baseAsp ?? a.currentAsp) || a.productName.localeCompare(b.productName),
  )

  const segmentBuckets = SEGMENTS.map((segment) => ({
    ...segment,
    rows: sortedRows.filter((row) => getSegmentKey(row.baseAsp ?? row.currentAsp) === segment.key),
  })).filter((segment) => segment.rows.length > 0)

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Adjust Price Ladder</h3>
          {selectedScenarioName ? <p className="mt-1 text-xs font-semibold text-slate-600">Scenario: {selectedScenarioName}</p> : null}
        </div>
        {onSaveScenario ? (
          <button
            type="button"
            onClick={onSaveScenario}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saveLabel}
          </button>
        ) : null}
      </div>

      <div className="space-y-3 p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {segmentBuckets.map((segment) => (
            <div key={segment.key} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{segment.label}</p>
                <p className="text-[11px] font-semibold text-slate-500">{segment.rows.length} products</p>
              </div>
              <div className="overflow-x-auto">
                <div className={`${HEADER_GRID_CLASS} min-w-[520px] px-2 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500`}>
                  <span>Product</span>
                  <span className="text-right text-slate-700">Base</span>
                  <span className="text-center">Movement (vs Base)</span>
                  <span className="text-right text-emerald-700">Recommended</span>
                  <span className="text-right">Volume Impact</span>
                </div>
                <div className="min-w-[520px]">
                  <LadderRowsBlock
                    rows={segment.rows}
                    inputValues={inputValues}
                    lockedProducts={lockedProducts}
                    onRecommendedInputChange={onRecommendedInputChange}
                    onRecommendedCommit={onRecommendedCommit}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default CurrentVsOptimizedLadderChart
