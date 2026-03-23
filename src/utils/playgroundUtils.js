const COGS_RATIO = 0.4
const safe = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback)

export const evaluatePlaygroundScenario = ({ savedScenario, prices }) => {
  const rows = savedScenario?.rows ?? []
  const model = savedScenario?.modelContext ?? {}
  const basePrices = model.basePrices?.length ? model.basePrices : rows.map((row) => row.baseAsp)
  const baseVolumes = model.baseVolumes?.length ? model.baseVolumes : rows.map((row) => row.scenarioVolume)
  const beta = model.betaPpu ?? []
  const gamma =
    model.gammaMatrix?.length === rows.length
      ? model.gammaMatrix
      : (model.crossMatrix ?? []).map((row, i) =>
          row.map((value, j) => (i === j ? 0 : value * ((baseVolumes[i] ?? 1) / Math.max(1, basePrices[j] ?? 1)))),
        )
  const n = rows.length

  const safePrices = prices.map((value, idx) => Math.max(1, Number.isFinite(value) ? value : basePrices[idx]))
  const deltas = safePrices.map((value, idx) => value - basePrices[idx])
  const unitCosts = basePrices.map((value) => value * COGS_RATIO)

  const evaluatedRows = rows.map((row, i) => {
    const baseAsp = safe(row.baseAsp, safe(basePrices[i], 1))
    const baseVolume = safe(row.baseVolume, safe(baseVolumes[i], safe(row.scenarioVolume, 1)))
    const scenarioAsp = safe(row.scenarioAsp, baseAsp)
    const scenarioVolume = safe(row.scenarioVolume, baseVolume)
    let cross = 0
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue
      cross += (gamma[i]?.[j] ?? 0) * deltas[j]
    }

    const own = (beta[i] ?? 0) * deltas[i]
    const optimizedVolume = Math.max(1, (baseVolumes[i] ?? 1) + own + cross)
    const optimizedAsp = safePrices[i]
    const currentAsp = baseAsp
    const currentVolume = baseVolume
    const currentRevenue = currentAsp * currentVolume
    const optimizedRevenue = optimizedAsp * optimizedVolume
    const currentProfit = (currentAsp - unitCosts[i]) * currentVolume
    const optimizedProfit = (optimizedAsp - unitCosts[i]) * optimizedVolume

    return {
      productName: row.productName,
      baseAsp,
      baseVolume,
      scenarioAsp,
      scenarioVolume,
      currentAsp,
      optimizedAsp,
      aspChange: optimizedAsp - currentAsp,
      aspChangePct: currentAsp === 0 ? 0 : (optimizedAsp - currentAsp) / currentAsp,
      basePriceChange: optimizedAsp - row.baseAsp,
      basePriceChangePct: row.baseAsp === 0 ? 0 : (optimizedAsp - row.baseAsp) / row.baseAsp,
      currentVolume,
      optimizedVolume,
      volumeChangePct: currentVolume === 0 ? 0 : (optimizedVolume - currentVolume) / currentVolume,
      currentRevenue,
      optimizedRevenue,
      revenueChangePct: currentRevenue === 0 ? 0 : (optimizedRevenue - currentRevenue) / currentRevenue,
      currentProfit,
      optimizedProfit,
      profitChangePct: currentProfit === 0 ? 0 : (optimizedProfit - currentProfit) / currentProfit,
    }
  })

  const optimizedTotals = evaluatedRows.reduce(
    (acc, row) => {
      acc.totalVolume += row.optimizedVolume
      acc.totalRevenue += row.optimizedRevenue
      acc.totalProfit += row.optimizedProfit
      return acc
    },
    { totalVolume: 0, totalRevenue: 0, totalProfit: 0 },
  )

  return { optimizedRows: evaluatedRows, optimizedTotals }
}
