import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const LadderTooltip = ({ active, payload, aspKey, volumeKey }) => {
  if (!active || !payload?.length) {
    return null
  }

  const row = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">{row.productName}</p>
      <p className="text-xs text-slate-600">ASP: {row[aspKey].toFixed(1)}</p>
      <p className="text-xs text-slate-600">Volume: {Math.round(row[volumeKey]).toLocaleString()}</p>
    </div>
  )
}

const AspLadderChartBase = ({ title, rows, aspKey, volumeKey, lineColor, barColor }) => {
  return (
    <div className="panel p-4">
      <h3 className="text-lg font-bold text-slate-800">{title}</h3>
      <div className="mt-3 h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 20, right: 16, left: 4, bottom: 12 }}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
            <XAxis dataKey="productName" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={66} />
            <YAxis yAxisId="price" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="volume" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip content={<LadderTooltip aspKey={aspKey} volumeKey={volumeKey} />} />
            <Bar yAxisId="volume" dataKey={volumeKey} fill={barColor} fillOpacity={0.22} radius={[6, 6, 0, 0]} />
            <Line yAxisId="price" type="stepAfter" dataKey={aspKey} stroke={lineColor} strokeWidth={3} dot={{ r: 5 }}>
              <LabelList dataKey={aspKey} position="top" formatter={(value) => value.toFixed(1)} className="fill-slate-600 text-[10px]" />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default AspLadderChartBase
