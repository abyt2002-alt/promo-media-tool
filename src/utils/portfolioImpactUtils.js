import { computeVolumeResponse } from './priceResponseUtils'

const OBJECTIVE_KEY = {
  revenue: 'totalRevenue',
  profit: 'totalProfit',
  volume: 'totalVolume',
}

export const buildUnitCostVector = (rows) => {
  return rows.map((row, index) => {
    const baseRatio = 0.54 + index * 0.02 + (row.basePrice >= 899 ? 0.03 : 0)
    return row.basePrice * Math.min(baseRatio, 0.78)
  })
}

export const evaluatePortfolioState = ({
  candidatePrices,
  rows,
  ownElasticities,
  crossElasticityMatrix,
  unitCosts,
  minVolumeRetentionPct,
  objective,
}) => {
  const volumeResponse = computeVolumeResponse({
    candidatePrices,
    rows,
    ownElasticities,
    crossElasticityMatrix,
    minVolumeRetentionPct,
  })

  const productRows = rows.map((row, index) => {
    const optimizedAsp = candidatePrices[index]
    const currentVolume = row.volume
    const optimizedVolume = volumeResponse[index].optimizedVolume
    const currentRevenue = row.currentPrice * currentVolume
    const optimizedRevenue = optimizedAsp * optimizedVolume
    const currentProfit = (row.currentPrice - unitCosts[index]) * currentVolume
    const optimizedProfit = (optimizedAsp - unitCosts[index]) * optimizedVolume

    return {
      productName: row.productName,
      currentAsp: row.currentPrice,
      optimizedAsp,
      aspChange: optimizedAsp - row.currentPrice,
      aspChangePct: (optimizedAsp - row.currentPrice) / row.currentPrice,
      currentVolume,
      optimizedVolume,
      volumeChangePct: (optimizedVolume - currentVolume) / currentVolume,
      currentRevenue,
      optimizedRevenue,
      revenueChangePct: (optimizedRevenue - currentRevenue) / currentRevenue,
      currentProfit,
      optimizedProfit,
      profitChangePct: currentProfit === 0 ? 0 : (optimizedProfit - currentProfit) / currentProfit,
    }
  })

  const totals = productRows.reduce(
    (acc, row) => {
      acc.totalVolume += row.optimizedVolume
      acc.totalRevenue += row.optimizedRevenue
      acc.totalProfit += row.optimizedProfit
      return acc
    },
    { totalVolume: 0, totalRevenue: 0, totalProfit: 0 },
  )

  return {
    productRows,
    totals,
    objectiveValue: totals[OBJECTIVE_KEY[objective]],
  }
}

export const computeCurrentTotals = ({ rows, unitCosts }) => {
  return rows.reduce(
    (acc, row, index) => {
      acc.totalVolume += row.volume
      acc.totalRevenue += row.currentPrice * row.volume
      acc.totalProfit += (row.currentPrice - unitCosts[index]) * row.volume
      return acc
    },
    { totalVolume: 0, totalRevenue: 0, totalProfit: 0 },
  )
}
