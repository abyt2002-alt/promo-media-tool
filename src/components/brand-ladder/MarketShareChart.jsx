import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = ['#2563EB', '#16A34A', '#F97316', '#F59E0B', '#64748B', '#DC2626', '#2563EB', '#16A34A']

const MarketShareTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) {
    return null
  }

  const data = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">{data.productName}</p>
      <p className="text-xs text-slate-600">Volume: {data.volume.toLocaleString()}</p>
      <p className="text-xs text-slate-600">Share: {data.sharePct}%</p>
    </div>
  )
}

const MarketShareChart = ({ shareRows, totalVolume, monthLabel }) => {
  return (
    <div className="space-y-5">
      <div className="panel p-4">
        <h3 className="text-base font-semibold text-slate-800">Market Share ({monthLabel})</h3>
        <p className="mt-1 text-sm text-slate-500">Volume-based share distribution for the selected month.</p>

        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={shareRows}
                dataKey="sharePct"
                nameKey="productName"
                innerRadius={64}
                outerRadius={100}
                paddingAngle={2}
                label={({ sharePct }) => `${sharePct}%`}
                labelLine={false}
              >
                {shareRows.map((entry, index) => (
                  <Cell key={entry.productName} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<MarketShareTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Total volume: <span className="font-semibold">{totalVolume.toLocaleString()}</span>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-800">Market Detail ({monthLabel})</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Product</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Current Price</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {shareRows.map((row) => (
                <tr key={row.productName}>
                  <td className="px-3 py-2 text-slate-700">{row.productName}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{row.currentPrice}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{row.volume.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default MarketShareChart

