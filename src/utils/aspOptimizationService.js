import { buildCrossElasticityMatrix, computeOwnElasticity } from './insightsUtils'
import {
  buildPriceBounds,
  enforceLadderConstraints,
  isLadderValid,
} from './ladderConstraintUtils'
import {
  buildUnitCostVector,
  computeCurrentTotals,
  evaluatePortfolioState,
} from './portfolioImpactUtils'

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length

const buildCrossMatrix = (rows) => {
  const matrixRows = buildCrossElasticityMatrix(rows, 'base')

  return matrixRows.map((row) =>
    row.cells.map((cell) => (cell.isSelf ? 0 : cell.value)),
  )
}

const isConstraintSatisfied = ({
  state,
  currentTotals,
  enforceRevenueFloor,
  enforceProfitFloor,
  revenueFloorValue,
  profitFloorValue,
}) => {
  const revenueFloorThreshold =
    revenueFloorValue > 0 ? revenueFloorValue : currentTotals.totalRevenue
  const profitFloorThreshold =
    profitFloorValue > 0 ? profitFloorValue : currentTotals.totalProfit

  if (enforceRevenueFloor && state.totals.totalRevenue < revenueFloorThreshold) {
    return false
  }

  if (enforceProfitFloor && state.totals.totalProfit < profitFloorThreshold) {
    return false
  }

  return true
}

const betterObjective = (candidate, incumbent) => {
  return candidate > incumbent + 1e-6
}

export const runAspOptimization = ({
  monthRows,
  objective = 'revenue',
  maxAspChangePct = 12,
  minimumPriceGap = 18,
  minimumVolumeRetentionPct = 75,
  enforceRevenueFloor = false,
  enforceProfitFloor = false,
  revenueFloorValue = 0,
  profitFloorValue = 0,
  iterationCount = 80,
}) => {
  const sortedRows = monthRows
    .slice()
    .sort((a, b) => a.currentPrice - b.currentPrice || a.productName.localeCompare(b.productName))

  const ownElasticities = sortedRows.map((row) => computeOwnElasticity(row.productName, sortedRows, 'base'))
  const crossElasticityMatrix = buildCrossMatrix(sortedRows)
  const unitCosts = buildUnitCostVector(sortedRows)

  const currentPrices = sortedRows.map((row) => row.currentPrice)
  const priceBounds = buildPriceBounds(sortedRows, maxAspChangePct)

  const currentTotals = computeCurrentTotals({ rows: sortedRows, unitCosts })

  const evaluate = (candidatePrices) =>
    evaluatePortfolioState({
      candidatePrices,
      rows: sortedRows,
      ownElasticities,
      crossElasticityMatrix,
      unitCosts,
      minVolumeRetentionPct: minimumVolumeRetentionPct,
      objective,
    })

  let bestPrices = enforceLadderConstraints({
    prices: currentPrices,
    bounds: priceBounds,
    minGap: minimumPriceGap,
  })

  let bestState = evaluate(bestPrices)
  const isBestStateValid = isConstraintSatisfied({
    state: bestState,
    currentTotals,
    enforceRevenueFloor,
    enforceProfitFloor,
    revenueFloorValue,
    profitFloorValue,
  })

  if (!isBestStateValid) {
    bestState = {
      ...bestState,
      objectiveValue: Number.NEGATIVE_INFINITY,
    }
  }

  const baseStep = average(currentPrices) * (maxAspChangePct / 100) * 0.22
  let stepSize = Math.max(minimumPriceGap / 2, baseStep)

  for (let iteration = 0; iteration < iterationCount && stepSize >= 0.5; iteration += 1) {
    let improved = false

    for (let i = 0; i < bestPrices.length; i += 1) {
      for (const direction of [-1, 1]) {
        const candidate = bestPrices.slice()
        candidate[i] += direction * stepSize

        const constrained = enforceLadderConstraints({
          prices: candidate,
          bounds: priceBounds,
          minGap: minimumPriceGap,
        })

        if (!isLadderValid({ prices: constrained, bounds: priceBounds, minGap: minimumPriceGap })) {
          continue
        }

        const candidateState = evaluate(constrained)

        if (
          !isConstraintSatisfied({
            state: candidateState,
            currentTotals,
            enforceRevenueFloor,
            enforceProfitFloor,
            revenueFloorValue,
            profitFloorValue,
          })
        ) {
          continue
        }

        if (betterObjective(candidateState.objectiveValue, bestState.objectiveValue)) {
          bestPrices = constrained
          bestState = candidateState
          improved = true
        }
      }
    }

    if (!improved) {
      stepSize *= 0.62
    }
  }

  const finalState =
    bestState.objectiveValue === Number.NEGATIVE_INFINITY ? evaluate(bestPrices) : bestState

  const optimizedProducts = finalState.productRows
  const changedCount = optimizedProducts.filter((row) => Math.abs(row.aspChange) >= 0.5).length

  return {
    controls: {
      objective,
      maxAspChangePct,
      minimumPriceGap,
      minimumVolumeRetentionPct,
      enforceRevenueFloor,
      enforceProfitFloor,
      revenueFloorValue,
      profitFloorValue,
      iterationCount,
    },
    modelContext: {
      ownElasticities,
      crossElasticityMatrix,
      unitCosts,
    },
    currentTotals,
    optimizedTotals: finalState.totals,
    optimizedProducts,
    changedCount,
    revenueLiftPct: (finalState.totals.totalRevenue - currentTotals.totalRevenue) / currentTotals.totalRevenue,
    profitLiftPct: (finalState.totals.totalProfit - currentTotals.totalProfit) / currentTotals.totalProfit,
    volumeLiftPct: (finalState.totals.totalVolume - currentTotals.totalVolume) / currentTotals.totalVolume,
  }
}
