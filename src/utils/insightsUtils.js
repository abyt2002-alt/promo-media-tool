import { ownBrandMonthlyData } from '../data/portfolioMockData'

const CURVE_RANGE_FACTORS = {
  narrow: 0.12,
  standard: 0.3,
  wide: 0.3,
}

const SENSITIVITY_FACTORS = {
  conservative: 0.85,
  base: 1,
  aggressive: 1.18,
}

const ELASTICITY_CEILING = -0.5
const ELASTICITY_FLOOR = -2.5

const FIXED_OWN_ELASTICITY_BY_KEY = {
  '1199|cotton': -0.7376,
  '1199|cottonpolyester': -0.5734,
  '1199|polyester': -0.91,
  '299|notavailable': -1.5004953336891085,
  '349|cotton': -1.31,
  '399|cotton': -0.70,
  '399|viscoserayon': -3.4832414804981617,
  '549|cotton': -2.6152722167154243,
  '599|cotton': -1.33,
  '599|cottonslub': -4.468131189288543,
  '599|polyester': -1.02,
  '599|viscoserayon': -0.808,
  '699|cotton': -1.493,
  '699|polyester': -1.32,
  '799|cotton': -1.618,
  '799|cottonspandex': -1.88,
  '799|polyester': -1.52411,
  '899|cotton': -1.05966,
  '899|cottonblend': -0.83002,
  '899|cottonelastane': -1.537,
  '899|polyester': -8.97,
  '999|cotton': -0.804,
  '999|cottonblend': -0.828,
  '999|polyester': -1.098,
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizePpg = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, '')

const getElasticityKeyFromRow = (row) => {
  const rawPpg = row?.productName?.split('|')?.[1]?.trim() ?? ''
  return `${row.basePrice}|${normalizePpg(rawPpg)}`
}

export const getInsightsMonths = () => {
  return [...new Set(ownBrandMonthlyData.map((row) => row.yearMonth))].sort()
}

export const formatYearMonthLabel = (yearMonth) => {
  if (yearMonth?.includes('-W')) {
    const [year, week] = yearMonth.split('-W')
    return `Week ${week}, ${year}`
  }

  const [year, month] = yearMonth.split('-')
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(
    new Date(Number(year), Number(month) - 1, 1),
  )
}

export const getProductOptions = (yearMonth) => {
  const rows = ownBrandMonthlyData.filter((row) => row.yearMonth === yearMonth)
  return rows.sort((a, b) => a.basePrice - b.basePrice).map((row) => row.productName)
}

export const getMonthData = (yearMonth) => {
  return ownBrandMonthlyData.filter((row) => row.yearMonth === yearMonth)
}

const getProductIndex = (productName, monthRows) => {
  return monthRows
    .slice()
    .sort((a, b) => a.basePrice - b.basePrice)
    .findIndex((row) => row.productName === productName)
}

export const computeOwnElasticity = (productName, monthRows, sensitivity = 'base') => {
  const sortedRows = monthRows.slice().sort((a, b) => a.basePrice - b.basePrice || a.productName.localeCompare(b.productName))
  const anchorRow = sortedRows.find((row) => row.productName === productName) || sortedRows[0]

  const fixedKey = getElasticityKeyFromRow(anchorRow)
  const mappedBase = FIXED_OWN_ELASTICITY_BY_KEY[fixedKey]

  let base = mappedBase
  if (base === undefined) {
    const productIndex = getProductIndex(productName, monthRows)
    const denominator = Math.max(1, sortedRows.length - 1)
    const rank = clamp(productIndex / denominator, 0, 1)
    const medianPrice = sortedRows[Math.floor(sortedRows.length / 2)]?.currentPrice || anchorRow.currentPrice
    const priceDeviation = clamp((anchorRow.currentPrice - medianPrice) / Math.max(1, medianPrice), -0.35, 0.35)
    const priceFactor = 1 + priceDeviation * 0.35
    const distributionFactor = 1 + (70 - anchorRow.distribution) / 220
    const rpiFactor = 1 + Math.abs(anchorRow.rpiEffect) * 0.08
    base = (ELASTICITY_CEILING + (ELASTICITY_FLOOR - ELASTICITY_CEILING) * rank) * priceFactor * distributionFactor * rpiFactor
  }

  const sensitivityFactor = SENSITIVITY_FACTORS[sensitivity] ?? 1
  const scaled = base * sensitivityFactor
  return Number(clamp(scaled, ELASTICITY_FLOOR, ELASTICITY_CEILING).toFixed(3))
}

const buildPriceGrid = (minPrice, maxPrice) => {
  const safeMin = Math.max(1, minPrice)
  const safeMax = Math.max(safeMin + 1, maxPrice)
  const points = 11
  const step = (safeMax - safeMin) / (points - 1)

  const grid = Array.from({ length: points }, (_, index) =>
    Number((safeMin + step * index).toFixed(3)),
  )

  return grid
}

export const buildDemandCurve = ({
  anchorRow,
  ownElasticity,
  curveRange = 'standard',
}) => {
  const distFactor = 1 - (anchorRow.distribution - 70) / 520
  const rpiFactor = 1 + anchorRow.rpiEffect * 0.08
  const effectiveElasticity = ownElasticity * distFactor * rpiFactor

  // Linear demand anchored at current point:
  // E = (dQ/dP) * (P/Q)  => dQ/dP = E * (Q/P)
  // Q = a - bP with b = -(dQ/dP)
  const slope = (effectiveElasticity * anchorRow.volume) / anchorRow.currentPrice
  const b = -slope
  const a = anchorRow.volume + b * anchorRow.currentPrice
  const factor = CURVE_RANGE_FACTORS[curveRange] ?? CURVE_RANGE_FACTORS.standard

  let minPrice = anchorRow.currentPrice * (1 - factor)
  let maxPrice = anchorRow.currentPrice * (1 + factor)

  // Keep demand positive in plotted range so the line stays linear without floor clipping.
  if (b > 0) {
    const zeroDemandPrice = a / b
    if (Number.isFinite(zeroDemandPrice) && zeroDemandPrice > 0) {
      maxPrice = Math.min(maxPrice, zeroDemandPrice * 0.9)
    }
  }

  if (maxPrice <= minPrice) {
    maxPrice = minPrice + Math.max(5, anchorRow.currentPrice * 0.08)
  }

  const prices = buildPriceGrid(minPrice, maxPrice)

  return prices
    .map((price) => {
      const predictedDemand = a - b * price
      const rawPointElasticity = slope * (price / Math.max(1, predictedDemand))
      const negativePointElasticity = -Math.abs(rawPointElasticity)
      const pointElasticity = Number(
        clamp(negativePointElasticity, ELASTICITY_FLOOR, ELASTICITY_CEILING).toFixed(3),
      )

      return {
        price,
        predictedDemand: Number(predictedDemand.toFixed(3)),
        revenue: price * predictedDemand,
        pointElasticity,
        isCurrent: price === anchorRow.currentPrice,
      }
    })
    .sort((a, b) => a.price - b.price)
}

export const buildRevenueCurve = (demandCurve) => {
  const maxRevenuePoint = demandCurve.reduce((best, point) =>
    point.revenue > best.revenue ? point : best,
  )

  const currentPoint = demandCurve.find((point) => point.isCurrent) || demandCurve[Math.floor(demandCurve.length / 2)]

  return {
    points: demandCurve,
    maxRevenuePoint,
    currentPoint,
  }
}

export const getRevenuePositionInsight = (currentPrice, maxRevenuePrice) => {
  const gapRatio = (currentPrice - maxRevenuePrice) / maxRevenuePrice

  if (Math.abs(gapRatio) <= 0.03) {
    return 'Current price is already near the revenue sweet spot.'
  }

  if (gapRatio < 0) {
    return 'Current price is below the revenue-maximizing point.'
  }

  return 'Current price is above the revenue-maximizing point.'
}

export const buildCrossElasticityMatrix = (monthRows, sensitivity = 'base') => {
  const sorted = monthRows.slice().sort((a, b) => a.basePrice - b.basePrice)
  const sensitivityFactor = SENSITIVITY_FACTORS[sensitivity] ?? 1
  const interactionWindow = 100

  return sorted.map((row, rowIndex) => {
    const cells = sorted.map((colRow, colIndex) => {
      if (rowIndex === colIndex) {
        return { productName: colRow.productName, value: null, isSelf: true }
      }

      const priceGap = Math.abs(row.currentPrice - colRow.currentPrice)

      if (priceGap > interactionWindow) {
        return { productName: colRow.productName, value: 0, isSelf: false }
      }

      // Stronger effect at same price, tapering to weaker effect at ±100.
      const closeness = 1 - priceGap / interactionWindow
      const baseValue = 0.08 + closeness * 0.32
      const crossElasticity = Number(clamp(baseValue * sensitivityFactor, 0.05, 0.45).toFixed(2))

      return { productName: colRow.productName, value: crossElasticity, isSelf: false }
    })

    return {
      productName: row.productName,
      cells,
    }
  })
}

export const getCrossElasticityRow = (matrix, productName) => {
  const row = matrix.find((entry) => entry.productName === productName)
  if (!row) {
    return []
  }

  return row.cells
    .filter((cell) => !cell.isSelf)
    .map((cell) => ({
      impactedBy: cell.productName,
      crossElasticity: cell.value,
    }))
    .sort((a, b) => Math.abs(b.crossElasticity) - Math.abs(a.crossElasticity))
}

export const formatCurrency = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)

export const buildInsightsPayload = ({
  yearMonth,
  productName,
  curveRange = 'standard',
  sensitivity = 'base',
}) => {
  const monthRows = getMonthData(yearMonth)
  const anchorRow = monthRows.find((row) => row.productName === productName) || monthRows[0]

  const ownElasticity = computeOwnElasticity(anchorRow.productName, monthRows, sensitivity)
  const demandCurve = buildDemandCurve({
    anchorRow,
    ownElasticity,
    curveRange,
  })

  const revenueCurve = buildRevenueCurve(demandCurve)
  const currentPointElasticity = revenueCurve.currentPoint?.pointElasticity ?? ownElasticity
  const matrix = buildCrossElasticityMatrix(monthRows, sensitivity)
  const selectedCrossRow = getCrossElasticityRow(matrix, anchorRow.productName)
  const insightLine = getRevenuePositionInsight(anchorRow.currentPrice, revenueCurve.maxRevenuePoint.price)

  return {
    anchorRow,
    monthRows,
    ownElasticity,
    currentPointElasticity,
    demandCurve,
    revenueCurve,
    matrix,
    selectedCrossRow,
    insightLine,
  }
}

const getElasticityBand = (elasticity) => {
  const absElasticity = Math.abs(elasticity)

  if (absElasticity > 1.1) {
    return 'reduce'
  }

  if (absElasticity < 0.9) {
    return 'increase'
  }

  return 'hold'
}

const buildProductAverageStats = (sensitivity = 'base') => {
  const byProduct = new Map()

  ownBrandMonthlyData.forEach((row) => {
    const entry = byProduct.get(row.productName) || {
      aspSum: 0,
      aspCount: 0,
      elasticitySum: 0,
      elasticityCount: 0,
    }
    entry.aspSum += row.currentPrice
    entry.aspCount += 1
    byProduct.set(row.productName, entry)
  })

  const weeks = [...new Set(ownBrandMonthlyData.map((row) => row.yearMonth))]
  weeks.forEach((weekKey) => {
    const weekRows = ownBrandMonthlyData.filter((row) => row.yearMonth === weekKey)
    weekRows.forEach((row) => {
      const entry = byProduct.get(row.productName)
      if (!entry) return
      const elasticity = computeOwnElasticity(row.productName, weekRows, sensitivity)
      entry.elasticitySum += elasticity
      entry.elasticityCount += 1
    })
  })

  const stats = new Map()
  byProduct.forEach((entry, productName) => {
    stats.set(productName, {
      avgAsp: entry.aspCount ? entry.aspSum / entry.aspCount : 0,
      avgElasticity: entry.elasticityCount ? entry.elasticitySum / entry.elasticityCount : 0,
    })
  })

  return stats
}

export const buildPortfolioElasticityBands = (monthRows, sensitivity = 'base') => {
  const sorted = monthRows
    .slice()
    .sort((a, b) => a.basePrice - b.basePrice || a.productName.localeCompare(b.productName))
  const avgStats = buildProductAverageStats(sensitivity)

  const products = sorted.map((row) => {
    const currentElasticity = computeOwnElasticity(row.productName, monthRows, sensitivity)
    const band = getElasticityBand(currentElasticity)
    const stats = avgStats.get(row.productName)

    const suggestedAction =
      band === 'reduce'
        ? 'Reduce Price'
        : band === 'hold'
          ? 'Hold Price'
          : 'Increase Price'

    return {
      productName: row.productName,
      currentElasticity,
      absElasticity: Math.abs(currentElasticity),
      avgElasticity: stats?.avgElasticity ?? currentElasticity,
      avgAsp: stats?.avgAsp ?? row.currentPrice,
      currentAsp: row.currentPrice,
      basePrice: row.basePrice,
      suggestedAction,
      band,
    }
  })

  return {
    reduce: products.filter((item) => item.band === 'reduce'),
    hold: products.filter((item) => item.band === 'hold'),
    increase: products.filter((item) => item.band === 'increase'),
  }
}
