import AspLadderChartBase from './AspLadderChartBase'

const OptimizedAspLadderChart = ({ rows }) => {
  return (
    <AspLadderChartBase
      title="Optimized ASP Ladder"
      rows={rows}
      aspKey="optimizedAsp"
      volumeKey="optimizedVolume"
      lineColor="#16A34A"
      barColor="#16A34A"
    />
  )
}

export default OptimizedAspLadderChart

