import { RotateCcw } from 'lucide-react'
import { formatYearMonthLabel } from '../../utils/brandLadderUtils'

const Toggle = ({ checked, onChange, label }) => {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-brand.blue' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  )
}

const MonthSelect = ({ label, value, options, onChange }) => {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatYearMonthLabel(option)}
          </option>
        ))}
      </select>
    </div>
  )
}

const BrandLadderSidebar = ({
  monthOptions,
  month1,
  month2,
  compareMonth,
  showVolume,
  summary,
  onMonth1Change,
  onMonth2Change,
  onCompareMonthChange,
  onShowVolumeChange,
  onReset,
}) => {
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="text-sm font-semibold text-slate-800">Brand Ladder Controls</h3>

        <div className="mt-4 space-y-3">
          <MonthSelect label="Week 1" value={month1} options={monthOptions} onChange={onMonth1Change} />

          <Toggle checked={compareMonth} onChange={onCompareMonthChange} label="Compare Week" />

          {compareMonth && (
            <MonthSelect label="Week 2" value={month2} options={monthOptions} onChange={onMonth2Change} />
          )}

          <Toggle checked={showVolume} onChange={onShowVolumeChange} label="Show Volume" />

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

      <div className="panel p-4">
        <h4 className="text-sm font-semibold text-slate-800">Week 1 Snapshot</h4>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs text-slate-500">Price Floor</p>
            <p className="font-semibold text-slate-800">INR {summary.minPrice}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs text-slate-500">Price Ceiling</p>
            <p className="font-semibold text-slate-800">INR {summary.maxPrice}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs text-slate-500">Average Price</p>
            <p className="font-semibold text-slate-800">INR {summary.avgPrice}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs text-slate-500">Total Volume</p>
            <p className="font-semibold text-slate-800">{summary.totalVolume.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrandLadderSidebar
