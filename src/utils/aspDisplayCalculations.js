const hashToInt = (text) => {
  let hash = 0
  const value = String(text ?? '')
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = (hash * 33 + value.charCodeAt(idx)) >>> 0
  }
  return hash
}

const getSegmentKey = (basePrice) => {
  if (basePrice <= 599) return 'daily'
  if (basePrice <= 899) return 'core'
  return 'premium'
}

const getSegmentLabel = (basePrice) => {
  if (basePrice <= 599) return 'Daily Casual'
  if (basePrice <= 899) return 'Core Plus'
  return 'Premium'
}

export const computeDriftPct = (productName, yearMonth) => {
  const normalized = hashToInt(`${productName}|${yearMonth}`) % 701
  return -0.03 + normalized / 10000
}

export const buildDisplayRows = ({
  rows,
  selectedMonth,
  basePriceEditMap = {},
  recommendedPriceEditMap = {},
  modelContext = {},
}) => {
  const rowList = rows ?? []
  const n = rowList.length
  if (!n) return []

  const refBasePrices =
    Array.isArray(modelContext?.basePrices) && modelContext.basePrices.length === n
      ? modelContext.basePrices.map((value) => Math.max(1, Number(value) || 1))
      : rowList.map((item) => Math.max(1, Number(item.baseAsp ?? item.currentAsp ?? 1)))
  const refBaseVolumes =
    Array.isArray(modelContext?.baseVolumes) && modelContext.baseVolumes.length === n
      ? modelContext.baseVolumes.map((value) => Math.max(1, Number(value) || 1))
      : rowList.map((item) => Math.max(1, Number(item.currentVolume ?? 1)))
  const ownElasticities =
    Array.isArray(modelContext?.ownElasticities) && modelContext.ownElasticities.length === n
      ? modelContext.ownElasticities.map((value) => Number(value))
      : rowList.map(() => -1.1)
  const betaPpu =
    Array.isArray(modelContext?.betaPpu) && modelContext.betaPpu.length === n
      ? modelContext.betaPpu.map((value) => Number(value) || 0)
      : refBaseVolumes.map((baseVolume, idx) => {
          const price = Math.max(1, refBasePrices[idx])
          const ownElasticity = Number.isFinite(ownElasticities[idx]) ? ownElasticities[idx] : -1.1
          return ownElasticity * (baseVolume / price)
        })
  const gammaMatrix =
    Array.isArray(modelContext?.gammaMatrix) &&
    modelContext.gammaMatrix.length === n &&
    modelContext.gammaMatrix.every((rowGamma) => Array.isArray(rowGamma) && rowGamma.length === n)
      ? modelContext.gammaMatrix.map((rowGamma) => rowGamma.map((value) => Number(value) || 0))
      : Array.from({ length: n }, () => Array.from({ length: n }, () => 0))

  const optimizedPrices = rowList.map((row, idx) => {
    const basePrice = Math.max(1, Number(refBasePrices[idx] ?? row.baseAsp ?? row.currentAsp ?? 1))
    const editedBaseAspRaw = basePriceEditMap[row.productName]
    const editedRecommendedRaw = recommendedPriceEditMap[row.productName]
    const scenarioOptimizedAsp = Number(row.optimizedAsp ?? row.currentAsp ?? basePrice)
    return Number.isFinite(Number(editedRecommendedRaw)) && Number(editedRecommendedRaw) > 0
      ? Number(editedRecommendedRaw)
      : Number.isFinite(Number(editedBaseAspRaw)) && Number(editedBaseAspRaw) > 0
        ? Number(editedBaseAspRaw)
        : scenarioOptimizedAsp
  })
  const deltas = optimizedPrices.map((price, idx) => Number(price) - refBasePrices[idx])
  const ownTerms = deltas.map((delta, idx) => (betaPpu[idx] ?? 0) * delta)
  const crossTerms = deltas.map((_, idx) => {
    let cross = 0
    for (let j = 0; j < n; j += 1) {
      if (j === idx) continue
      const gap = Math.abs(optimizedPrices[idx] - optimizedPrices[j])
      let dynamicGamma = 0
      if (gap <= 100) {
        const closeness = 1 - gap / 100
        const crossElasticity = -(0.05 + closeness * 0.32)
        dynamicGamma = crossElasticity * (refBaseVolumes[idx] / Math.max(1, refBasePrices[j]))
      }
      const staticGamma = gammaMatrix[idx]?.[j] ?? 0
      const effectiveGamma = Math.abs(dynamicGamma) > 1e-12 ? dynamicGamma : staticGamma
      cross -= effectiveGamma * deltas[j]
    }
    return cross
  })

  return rowList.map((row, idx) => {
    const driftPct = computeDriftPct(row.productName, selectedMonth)
    const driftFactor = 1 + driftPct
    const originalBaseAsp = Math.max(1, Number(refBasePrices[idx] ?? row.baseAsp ?? row.currentAsp ?? 1))
    const originalBaseVolume = Math.max(1, Number(refBaseVolumes[idx] ?? row.currentVolume ?? 1))
    const ownElasticity = Number.isFinite(ownElasticities[idx]) ? ownElasticities[idx] : -1.1
    const optimizedAsp = optimizedPrices[idx]
    const currentAsp = originalBaseAsp
    const currentVolume = Math.max(1, originalBaseVolume)
    const ownDeltaVolumeBase = ownTerms[idx] ?? 0
    const crossDeltaVolumeBase = crossTerms[idx] ?? 0
    const optimizedVolumeBase = Math.max(1, originalBaseVolume + ownDeltaVolumeBase + crossDeltaVolumeBase)
    const optimizedVolume = Math.max(1, optimizedVolumeBase * driftFactor)
    const unitCost = originalBaseAsp * 0.4
    const currentRevenue = currentAsp * currentVolume
    const optimizedRevenue = optimizedAsp * optimizedVolume
    const currentProfit = (currentAsp - unitCost) * currentVolume
    const optimizedProfit = (optimizedAsp - unitCost) * optimizedVolume
    const basePriceChange = optimizedAsp - currentAsp

    return {
      ...row,
      segmentKey: row.segmentKey ?? getSegmentKey(originalBaseAsp),
      segmentLabel: row.segmentLabel ?? getSegmentLabel(originalBaseAsp),
      baseAsp: originalBaseAsp,
      currentAsp,
      optimizedAsp,
      currentVolume,
      optimizedVolume,
      currentRevenue,
      optimizedRevenue,
      currentProfit,
      optimizedProfit,
      aspChange: basePriceChange,
      aspChangePct: currentAsp === 0 ? 0 : basePriceChange / currentAsp,
      basePriceChange,
      basePriceChangePct: currentAsp === 0 ? 0 : basePriceChange / currentAsp,
      volumeChangePct: currentVolume === 0 ? 0 : (optimizedVolume - currentVolume) / currentVolume,
      revenueChangePct: currentRevenue === 0 ? 0 : (optimizedRevenue - currentRevenue) / currentRevenue,
      profitChangePct: currentProfit === 0 ? 0 : (optimizedProfit - currentProfit) / currentProfit,
      ownElasticity,
      ownVolumeDelta: ownDeltaVolumeBase * driftFactor,
      crossVolumeDelta: crossDeltaVolumeBase * driftFactor,
      baselineDriftPct: driftPct,
    }
  })
}
