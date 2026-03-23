const formatNumber = (value) => Math.round(value).toLocaleString('en-IN')
const formatCurrency = (value) => `INR ${formatNumber(value)}`

const formatSignedPct = (value) => {
  const pct = value * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

const TotalImpactSummaryPanel = ({ rows = [] }) => {
  const baseVolume = rows.reduce((sum, row) => sum + (row.currentVolume ?? 0), 0)
  const newVolume = rows.reduce((sum, row) => sum + (row.optimizedVolume ?? 0), 0)
  const baseRevenue = rows.reduce((sum, row) => sum + (row.currentRevenue ?? 0), 0)
  const newRevenue = rows.reduce((sum, row) => sum + (row.optimizedRevenue ?? 0), 0)
  const baseProfit = rows.reduce((sum, row) => sum + (row.currentProfit ?? 0), 0)
  const newProfit = rows.reduce((sum, row) => sum + (row.optimizedProfit ?? 0), 0)
  const volumeDeltaPct = baseVolume === 0 ? 0 : (newVolume - baseVolume) / baseVolume
  const revenueDeltaPct = baseRevenue === 0 ? 0 : (newRevenue - baseRevenue) / baseRevenue
  const profitDeltaPct = baseProfit === 0 ? 0 : (newProfit - baseProfit) / baseProfit

  return (
    <div className="panel p-4">
      <p className="text-sm font-bold uppercase tracking-wide text-slate-700">Total Impact (All Segments)</p>
      <div className="mt-3 grid grid-cols-1 gap-3 text-[12px] md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="font-semibold text-slate-500">Volume</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className={`text-3xl font-extrabold leading-none ${volumeDeltaPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatSignedPct(volumeDeltaPct)}
            </p>
            <div className="min-w-0 text-right">
              <p className="truncate border-b border-slate-200 pb-0.5 text-[11px] font-semibold text-slate-600">Base -&gt; Recommended</p>
              <p className="truncate pt-0.5 text-[12px] font-bold text-slate-800">{formatNumber(baseVolume)} -&gt; {formatNumber(newVolume)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="font-semibold text-slate-500">Revenue</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className={`text-3xl font-extrabold leading-none ${revenueDeltaPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatSignedPct(revenueDeltaPct)}
            </p>
            <div className="min-w-0 text-right">
              <p className="truncate border-b border-slate-200 pb-0.5 text-[11px] font-semibold text-slate-600">Base -&gt; Recommended</p>
              <p className="truncate pt-0.5 text-[12px] font-bold text-slate-800">{formatCurrency(baseRevenue)} -&gt; {formatCurrency(newRevenue)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="font-semibold text-slate-500">Profit</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className={`text-3xl font-extrabold leading-none ${profitDeltaPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatSignedPct(profitDeltaPct)}
            </p>
            <div className="min-w-0 text-right">
              <p className="truncate border-b border-slate-200 pb-0.5 text-[11px] font-semibold text-slate-600">Base -&gt; Recommended</p>
              <p className="truncate pt-0.5 text-[12px] font-bold text-slate-800">{formatCurrency(baseProfit)} -&gt; {formatCurrency(newProfit)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TotalImpactSummaryPanel
