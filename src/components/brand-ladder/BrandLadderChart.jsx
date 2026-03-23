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

const BrandLadderTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">{point.productName}</p>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <p>Base price: INR {point.basePrice}</p>
        <p>Volume: {point.volume.toLocaleString()}</p>
      </div>
    </div>
  )
}

const BrandLadderChart = ({ data, title, showVolume }) => {
  return (
    <div className="panel self-start p-4">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">Stair-step ladder sorted by base price (ascending).</p>

      <div className="mt-3 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 28, right: 16, left: 4, bottom: 26 }}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
            <XAxis dataKey="productName" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={72} />
            <YAxis yAxisId="price" tick={{ fontSize: 11 }} domain={['dataMin - 20', 'dataMax + 30']} />
            {showVolume && <YAxis yAxisId="volume" orientation="right" tick={{ fontSize: 11 }} />}
            <Tooltip content={<BrandLadderTooltip />} />

            {showVolume && (
              <Bar yAxisId="volume" dataKey="volume" name="Volume" fill="#16A34A" fillOpacity={0.24} radius={[6, 6, 0, 0]} />
            )}

            <Line
              yAxisId="price"
              type="stepAfter"
              dataKey="basePrice"
              name="Base Price Ladder"
              stroke="#2563EB"
              strokeWidth={3}
              dot={{ r: 5, fill: '#2563EB', stroke: '#2563EB', strokeWidth: 1.5 }}
              activeDot={{ r: 7 }}
            >
              <LabelList dataKey="basePrice" position="top" formatter={(value) => `${value}`} className="fill-slate-600 text-[10px]" />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default BrandLadderChart


