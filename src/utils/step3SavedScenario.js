import { formatYearMonthLabel } from './insightsUtils'

export const buildStep3SavedScenarioSnapshot = ({ source, scenarioName }) => {
  const now = new Date()
  const savedAtLabel = now.toLocaleString('en-IN')

  return {
    id: `step3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${scenarioName} - ${formatYearMonthLabel(source.selectedMonth)}`,
    selectedMonth: source.selectedMonth,
    selectedScenarioId: source.selectedScenarioId,
    savedAt: now.toISOString(),
    savedAtLabel,
    baseTotals: source.baseTotals,
    optimizedTotals: source.optimizedTotals,
    rows: source.optimizedProducts.map((row) => ({
      productName: row.productName,
      baseAsp: row.baseAsp,
      optimizedAsp: row.optimizedAsp,
      currentVolume: row.currentVolume,
      optimizedVolume: row.optimizedVolume,
      currentRevenue: row.currentRevenue,
      optimizedRevenue: row.optimizedRevenue,
      currentProfit: row.currentProfit,
      optimizedProfit: row.optimizedProfit,
      ownElasticity: row.ownElasticity,
      ownVolumeDelta: row.ownVolumeDelta,
      crossVolumeDelta: row.crossVolumeDelta,
      baselineDriftPct: row.baselineDriftPct,
      volumeChangePct: row.volumeChangePct,
      revenueChangePct: row.revenueChangePct,
      profitChangePct: row.profitChangePct,
    })),
  }
}

