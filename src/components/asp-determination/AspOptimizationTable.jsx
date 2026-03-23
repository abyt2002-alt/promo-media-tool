const formatNum = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
const formatPct = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`

const deltaClass = (value) => {
  if (value > 0) {
    return 'text-emerald-700'
  }

  if (value < 0) {
    return 'text-rose-700'
  }

  return 'text-slate-700'
}

const AspOptimizationTable = ({ rows }) => {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-base font-semibold text-slate-800">Product-Level Optimization Impact</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1600px] divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Product</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Current ASP</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Optimized ASP</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">ASP Change</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">ASP Change %</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Current Volume</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Optimized Volume</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Volume Change %</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Current Revenue</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Optimized Revenue</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Revenue Change %</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Current Profit</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Optimized Profit</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Profit Change %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={row.productName}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{row.productName}</td>
                <td className="px-3 py-2 text-right text-slate-700">{row.currentAsp.toFixed(1)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{row.optimizedAsp.toFixed(1)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${deltaClass(row.aspChange)}`}>{row.aspChange >= 0 ? '+' : ''}{row.aspChange.toFixed(1)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${deltaClass(row.aspChangePct)}`}>{formatPct(row.aspChangePct)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatNum(row.currentVolume)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatNum(row.optimizedVolume)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${deltaClass(row.volumeChangePct)}`}>{formatPct(row.volumeChangePct)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatNum(row.currentRevenue)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatNum(row.optimizedRevenue)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${deltaClass(row.revenueChangePct)}`}>{formatPct(row.revenueChangePct)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatNum(row.currentProfit)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{formatNum(row.optimizedProfit)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${deltaClass(row.profitChangePct)}`}>{formatPct(row.profitChangePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default AspOptimizationTable
