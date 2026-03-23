import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
} from 'recharts'

const CompetitorTooltip = ({ active, payload, seriesMeta }) => {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">Ladder Slot {point.rank}</p>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        {seriesMeta.map((series) => {
          const price = point[series.key]
          if (price == null) {
            return null
          }

          return (
            <p key={series.key}>
              {series.brandName}: INR {price}
            </p>
          )
        })}
      </div>
    </div>
  )
}

const CompetitorComparisonChart = ({ chartData, seriesMeta, showVolume, monthLabel }) => {
  return (
    <div className="panel p-4">
      <h3 className="text-base font-semibold text-slate-800">Competitor Ladder Comparison ({monthLabel})</h3>
      <p className="mt-1 text-xs text-slate-500">Own ladder remains primary. Competitor ladders are reference overlays.</p>

      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 20, right: 16, left: 0, bottom: 18 }}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
            <XAxis dataKey="rank" tick={{ fontSize: 11 }} label={{ value: 'Ladder Slot', position: 'insideBottom', offset: -8, fontSize: 11 }} />
            <YAxis yAxisId="price" tick={{ fontSize: 11 }} domain={['dataMin - 20', 'dataMax + 30']} />
            {showVolume && <YAxis yAxisId="volume" orientation="right" tick={{ fontSize: 11 }} />}
            <Tooltip content={<CompetitorTooltip seriesMeta={seriesMeta} />} />
            <Legend />

            {showVolume && (
              <Bar yAxisId="volume" dataKey="ownVolume" name="MSG Volume" fill="#16A34A" fillOpacity={0.2} radius={[4, 4, 0, 0]} />
            )}

            {seriesMeta.map((series) => (
              <Line
                key={series.key}
                yAxisId="price"
                type="stepAfter"
                dataKey={series.key}
                name={`${series.brandName} Price`}
                stroke={series.color}
                strokeWidth={series.isOwn ? 3.2 : 2}
                strokeOpacity={series.isOwn ? 1 : 0.62}
                dot={{ r: series.isOwn ? 4.5 : 3.5, fill: series.color }}
                activeDot={{ r: series.isOwn ? 6 : 5 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default CompetitorComparisonChart

