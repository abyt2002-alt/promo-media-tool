import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const SEGMENT_COLORS = {
  daily: '#2563EB',
  core: '#F97316',
  premium: '#16A34A',
}

const formatInt = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
const formatCurrency = (value) => `INR ${formatInt(value)}`

const ComparisonTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const point = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">{point.productName}</p>
      <p className="text-xs text-slate-600">Segment: {point.segmentLabel}</p>
      <p className="text-xs text-slate-600">Base: {formatCurrency(point.baseAsp)}</p>
      <p className="text-xs text-slate-600">Adjusted: {formatCurrency(point.optimizedAsp)}</p>
      <p className="text-xs text-slate-600">Base Volume: {formatInt(point.currentVolume)}</p>
      <p className="text-xs text-slate-600">Adjusted Volume: {formatInt(point.optimizedVolume)}</p>
    </div>
  )
}

const renderSegmentDot = (props) => {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload) return null
  const color = SEGMENT_COLORS[payload.segmentKey] ?? '#64748B'
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke="#ffffff" strokeWidth={1.5} />
}

const LadderComparisonChart = ({ rows = [] }) => {
  const ladderRows = rows
    .slice()
    .sort(
      (a, b) =>
        (a.baseAsp ?? a.currentAsp) - (b.baseAsp ?? b.currentAsp) || a.productName.localeCompare(b.productName),
    )
    .map((row) => {
      const segmentKey = row.segmentKey ?? 'core'
      return {
        ...row,
        segmentKey,
        segmentLabel: row.segmentLabel ?? (segmentKey === 'daily' ? 'Daily Casual' : segmentKey === 'core' ? 'Core Plus' : 'Premium'),
      }
    })

  return (
    <div className="panel p-4">
      <h3 className="text-lg font-bold text-slate-800">Full Brand Ladder (Segment Colors)</h3>
      <p className="mt-1 text-xs text-slate-500">
        Unified base vs adjusted stair-step ladder across all products.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#2563EB]" />
          Daily Casual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#F97316]" />
          Core Plus
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#16A34A]" />
          Premium
        </span>
      </div>

      <div className="mt-3 h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={ladderRows} margin={{ top: 14, right: 16, left: 2, bottom: 18 }}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
            <XAxis dataKey="productName" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={72} />
            <YAxis tick={{ fontSize: 11, fontWeight: 600 }} />
            <Tooltip content={<ComparisonTooltip showComparison={showComparison} />} />
            <Line
              type="stepAfter"
              dataKey="baseAsp"
              stroke="#64748B"
              strokeWidth={2.2}
              strokeDasharray="5 4"
              dot={renderSegmentDot}
              name={showComparison ? 'Current Ladder' : 'Base Ladder'}
            />
            <Line
              type="stepAfter"
              dataKey="optimizedAsp"
              stroke="#16A34A"
              strokeWidth={2.5}
              dot={renderSegmentDot}
              name={showComparison ? 'Optimized Ladder' : 'Adjusted Ladder'}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-5 border-t border-slate-200 pt-2 text-[11px] font-semibold text-slate-700">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-0 w-6 border-t-[2.5px] border-[#64748B]"
            style={{ borderTopStyle: 'dashed' }}
          />
          Base Ladder
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0 w-6 border-t-[2.5px] border-[#16A34A]" />
          Adjusted Ladder
        </span>
      </div>
    </div>
  )
}

export default LadderComparisonChart
