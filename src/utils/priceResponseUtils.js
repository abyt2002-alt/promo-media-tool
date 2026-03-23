import { clamp } from './ladderConstraintUtils'

export const computeVolumeResponse = ({
  candidatePrices,
  rows,
  ownElasticities,
  crossElasticityMatrix,
  minVolumeRetentionPct,
}) => {
  const minRetention = minVolumeRetentionPct / 100

  return rows.map((row, i) => {
    const ownChangePct = (candidatePrices[i] - row.currentPrice) / row.currentPrice

    let crossContribution = 0
    for (let j = 0; j < rows.length; j += 1) {
      if (i === j) {
        continue
      }

      const otherChangePct = (candidatePrices[j] - rows[j].currentPrice) / rows[j].currentPrice
      crossContribution += crossElasticityMatrix[i][j] * otherChangePct
    }

    const totalChangePct = ownElasticities[i] * ownChangePct + crossContribution
    const volumeFactor = clamp(1 + totalChangePct, minRetention, 2.2)

    return {
      totalChangePct,
      volumeFactor,
      optimizedVolume: Math.max(1, row.volume * volumeFactor),
    }
  })
}
