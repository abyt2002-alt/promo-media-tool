import AspLadderChartBase from './AspLadderChartBase'

const CurrentAspLadderChart = ({ rows }) => {
  return (
    <AspLadderChartBase
      title="Current ASP Ladder"
      rows={rows}
      aspKey="currentAsp"
      volumeKey="currentVolume"
      lineColor="#2563EB"
      barColor="#2563EB"
    />
  )
}

export default CurrentAspLadderChart

