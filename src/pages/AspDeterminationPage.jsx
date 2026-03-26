import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, Loader2, Play, RotateCcw, Trash2 } from 'lucide-react'
import AppLayout from '../components/layout/AppLayout'
import AspInputGuardrailsPanel from '../components/asp-determination/AspInputGuardrailsPanel'
import AspScenarioFiltersPanel from '../components/asp-determination/AspScenarioFiltersPanel'
import ImpactAndLadderPanel from '../components/asp-determination/ImpactAndLadderPanel'
import SegmentWorkspacePanel from '../components/asp-determination/SegmentWorkspacePanel'
import LadderComparisonChart from '../components/asp-determination/LadderComparisonChart'
import OptimizationSummaryCards, {
  formatShortPct,
  getScenarioSelectionSummary,
} from '../components/asp-determination/OptimizationSummaryCards'
import { runAspOptimizationJob } from '../services/aspOptimizationApi'
import { getInsightsMonths, getMonthData } from '../utils/insightsUtils'
import { buildDisplayRows } from '../utils/aspDisplayCalculations'
import { buildStep3SavedScenarioSnapshot } from '../utils/step3SavedScenario'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const formatInr = (value) =>
  `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))}`
const SEGMENT_ORDER = ['daily', 'core', 'premium']
const snapToNearest49Or99 = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 49
  return Math.max(49, Math.round((numeric - 49) / 50) * 50 + 49)
}
const clampRecommendedToBaseBand = (value, baseAsp) => {
  const base = Math.max(1, Number(baseAsp) || 1)
  const raw = Number(value)
  if (!Number.isFinite(raw)) return snapToNearest49Or99(base)

  const minRaw = Math.max(1, base - 150)
  const maxRaw = Math.max(minRaw, base + 150)
  const clampedRaw = clamp(raw, minRaw, maxRaw)
  const snapped = snapToNearest49Or99(clampedRaw)

  const minSnapped = snapToNearest49Or99(minRaw)
  const maxSnapped = snapToNearest49Or99(maxRaw)
  return clamp(Math.max(49, snapped), Math.max(49, minSnapped), Math.max(49, maxSnapped))
}

const parseNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const parseOptionalFilterParam = (value, min = -100, max = 500) => {
  if (value === null || value === undefined || value === '') return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ''
  return clamp(parsed, min, max)
}
const parseBool = (value, fallback = false) => {
  if (value === null || value === undefined) return fallback
  return value === '1' || value === 'true'
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
const getSegmentLabelFromKey = (segmentKey) => {
  if (segmentKey === 'daily') return 'Daily Casual'
  if (segmentKey === 'core') return 'Core Plus'
  return 'Premium'
}
const normalizeProductLabel = (value) =>
  String(value ?? '')
    .replace(/\|/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim()
const groupScenarioRowsBySegment = (rows = []) =>
  SEGMENT_ORDER.map((segmentKey) => ({
    segmentKey,
    segmentLabel: getSegmentLabelFromKey(segmentKey),
    rows: rows
      .filter((row) => row.segmentKey === segmentKey)
      .slice()
      .sort((a, b) => Number(a.basePrice ?? 0) - Number(b.basePrice ?? 0)),
  }))
const getSegmentRanges = (controls, segmentKey) => {
  if (segmentKey === 'daily') {
    if (controls.dailyNoChange) {
      return { maxDecrease: 0, maxIncrease: 0, noChange: true }
    }
    return {
      maxDecrease: clamp(Number(controls.dailyMaxDecrease) || 0, 0, 150),
      maxIncrease: clamp(Number(controls.dailyMaxIncrease) || 0, 0, 150),
      noChange: false,
    }
  }
  if (segmentKey === 'core') {
    if (controls.coreNoChange) {
      return { maxDecrease: 0, maxIncrease: 0, noChange: true }
    }
    return {
      maxDecrease: clamp(Number(controls.coreMaxDecrease) || 0, 0, 150),
      maxIncrease: clamp(Number(controls.coreMaxIncrease) || 0, 0, 150),
      noChange: false,
    }
  }
  if (controls.premiumNoChange) {
    return { maxDecrease: 0, maxIncrease: 0, noChange: true }
  }
  return {
    maxDecrease: clamp(Number(controls.premiumMaxDecrease) || 0, 0, 150),
    maxIncrease: clamp(Number(controls.premiumMaxIncrease) || 0, 0, 150),
    noChange: false,
  }
}
const clampToProductBand = (value, basePrice) => {
  const base = Math.max(1, Number(basePrice) || 1)
  const minAllowed = Math.max(1, base - 150)
  const maxAllowed = base + 150
  const parsed = Number(value)
  const safeValue = Number.isFinite(parsed) ? parsed : base
  return clamp(safeValue, minAllowed, maxAllowed)
}
const inferObjectiveFromPrompt = (promptText) => {
  const text = String(promptText ?? '').toLowerCase()
  const profitSignals = ['profit', 'margin', 'gm', 'gross margin']
  return profitSignals.some((token) => text.includes(token)) ? 'profit' : 'revenue'
}

const lerp = (start, end, progress) => start + (end - start) * progress
const ASP_CACHE_KEY = 'asp_determination_cached_result_v4'
const ASP_VIEW_STATE_KEY = 'asp_determination_view_state_v1'
const STEP3_SAVED_KEY = 'base_ladder_saved_scenarios_v2'
let aspInMemoryCache = {}

const xmlEscape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const safeSheetName = (value, index) => {
  const trimmed = String(value || `Scenario ${index + 1}`)
    .replace(/[\\/:*?[\]]/g, ' ')
    .trim()
  const fallback = trimmed || `Scenario ${index + 1}`
  return fallback.slice(0, 31)
}

const readStep3SavedScenarios = () => {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STEP3_SAVED_KEY)
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeStep3SavedScenarios = (items) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(STEP3_SAVED_KEY, JSON.stringify(items.slice(0, 200)))
}

const downloadSavedScenariosWorkbook = (savedScenarios) => {
  if (!savedScenarios?.length) return

  const cell = (value, type = 'String') => `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`
  const sheetsXml = savedScenarios
    .map((scenario, index) => {
      const sheetName = safeSheetName(scenario.name, index)
      const baseRevenue = Number(scenario.baseTotals?.totalRevenue ?? 0)
      const recommendedRevenue = Number(scenario.optimizedTotals?.totalRevenue ?? 0)
      const baseVolume = Number(scenario.baseTotals?.totalVolume ?? 0)
      const recommendedVolume = Number(scenario.optimizedTotals?.totalVolume ?? 0)
      const baseProfit = Number(scenario.baseTotals?.totalProfit ?? 0)
      const recommendedProfit = Number(scenario.optimizedTotals?.totalProfit ?? 0)
      const volumeUpliftPct = baseVolume === 0 ? 0 : ((recommendedVolume - baseVolume) / baseVolume) * 100
      const revenueUpliftPct = baseRevenue === 0 ? 0 : ((recommendedRevenue - baseRevenue) / baseRevenue) * 100
      const profitUpliftPct = baseProfit === 0 ? 0 : ((recommendedProfit - baseProfit) / baseProfit) * 100
      const summaryRows = [
        ['Scenario', scenario.name],
        ['Month', scenario.selectedMonth],
        ['Saved At', scenario.savedAtLabel],
        ['Base Revenue', Math.round(baseRevenue)],
        ['Recommended Revenue', Math.round(recommendedRevenue)],
        ['Revenue Increase %', Number(revenueUpliftPct.toFixed(2))],
        ['Base Volume', Math.round(baseVolume)],
        ['Recommended Volume', Math.round(recommendedVolume)],
        ['Volume Increase %', Number(volumeUpliftPct.toFixed(2))],
        ['Base Gross Margin', Math.round(baseProfit)],
        ['Recommended Gross Margin', Math.round(recommendedProfit)],
        ['Gross Margin Increase %', Number(profitUpliftPct.toFixed(2))],
      ]
      const header = ['Product', 'Base Price', 'Recommended Price', 'Base Volume', 'Recommended Volume', 'Volume %', 'Revenue %', 'Gross Margin %']
      const dataRows = (scenario.rows ?? []).map((row) => [
        row.productName,
        Math.round(row.baseAsp ?? 0),
        Math.round(row.optimizedAsp ?? 0),
        Math.round(row.currentVolume ?? 0),
        Math.round(row.optimizedVolume ?? 0),
        ((row.volumeChangePct ?? 0) * 100).toFixed(2),
        ((row.revenueChangePct ?? 0) * 100).toFixed(2),
        ((row.profitChangePct ?? 0) * 100).toFixed(2),
      ])

      const tableRows = [
        ...summaryRows.map((row) => `<Row>${cell(row[0])}${cell(row[1], typeof row[1] === 'number' ? 'Number' : 'String')}</Row>`),
        '<Row/>',
        `<Row>${header.map((value) => cell(value)).join('')}</Row>`,
        ...dataRows.map(
          (row) =>
            `<Row>${cell(row[0])}${cell(row[1], 'Number')}${cell(row[2], 'Number')}${cell(row[3], 'Number')}${cell(row[4], 'Number')}${cell(row[5], 'Number')}${cell(row[6], 'Number')}${cell(row[7], 'Number')}</Row>`,
        ),
      ].join('')

      return `<Worksheet ss:Name="${xmlEscape(sheetName)}"><Table>${tableRows}</Table></Worksheet>`
    })
    .join('')

  const workbookXml =
    `<?xml version="1.0"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    sheetsXml +
    `</Workbook>`

  const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `base_ladder_saved_scenarios_${new Date().toISOString().slice(0, 10)}.xls`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

const hashText = (value) => {
  const text = String(value ?? '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

const buildCacheFingerprint = (selectedMonth, controls, productConstraints = {}) =>
  `${selectedMonth}|${hashText(
    JSON.stringify({
      objective: inferObjectiveFromPrompt(controls.prompt),
      grossMarginPct: Number(controls.grossMarginPct).toFixed(2),
      prompt: String(controls.prompt ?? '').trim(),
      dailyMaxDecrease: Number(controls.dailyMaxDecrease),
      dailyMaxIncrease: Number(controls.dailyMaxIncrease),
      dailyNoChange: Boolean(controls.dailyNoChange),
      coreMaxDecrease: Number(controls.coreMaxDecrease),
      coreMaxIncrease: Number(controls.coreMaxIncrease),
      coreNoChange: Boolean(controls.coreNoChange),
      premiumMaxDecrease: Number(controls.premiumMaxDecrease),
      premiumMaxIncrease: Number(controls.premiumMaxIncrease),
      premiumNoChange: Boolean(controls.premiumNoChange),
      minVolumeUpliftPct:
        controls.minVolumeUpliftPct === '' ? null : Number(controls.minVolumeUpliftPct),
      minRevenueUpliftPct:
        controls.minRevenueUpliftPct === '' ? null : Number(controls.minRevenueUpliftPct),
      minProfitUpliftPct:
        controls.minProfitUpliftPct === '' ? null : Number(controls.minProfitUpliftPct),
      productConstraints,
    }),
  )}`

const readCachedResult = ({ selectedMonth, controls, productConstraints }) => {
  const expectedFingerprint = buildCacheFingerprint(selectedMonth, controls, productConstraints)

  if (aspInMemoryCache?.[expectedFingerprint]?.result) {
    return aspInMemoryCache[expectedFingerprint].result
  }

  try {
    const raw = sessionStorage.getItem(`${ASP_CACHE_KEY}:${encodeURIComponent(expectedFingerprint)}`)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    const cachedResult = parsed?.result
    const productCount = cachedResult?.optimizedProducts?.length ?? 0
    const gammaRows = cachedResult?.modelContext?.gammaMatrix?.length ?? 0
    if (!cachedResult || productCount < 2 || gammaRows !== productCount) {
      return null
    }

    aspInMemoryCache[expectedFingerprint] = parsed
    return cachedResult
  } catch (error) {
    return null
  }
}

const writeCachedResult = ({ selectedMonth, controls, productConstraints, result }) => {
  const payload = {
    fingerprint: buildCacheFingerprint(selectedMonth, controls, productConstraints),
    savedAt: Date.now(),
    result,
  }
  aspInMemoryCache[payload.fingerprint] = payload

  try {
    sessionStorage.setItem(`${ASP_CACHE_KEY}:${encodeURIComponent(payload.fingerprint)}`, JSON.stringify(payload))
  } catch (error) {
    // ignore cache write failures
  }
}

const readAspViewState = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(ASP_VIEW_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

const writeAspViewState = (payload) => {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(ASP_VIEW_STATE_KEY, JSON.stringify(payload))
  } catch {
    // ignore snapshot write failures
  }
}

const mapProductRow = (row) => ({
  productName: row.product_name,
  baseAsp: row.base_price,
  segmentKey: getSegmentKey(row.base_price),
  segmentLabel: getSegmentLabel(row.base_price),
  currentAsp: row.current_price,
  optimizedAsp: row.optimized_price,
  aspChange: row.price_change,
  aspChangePct: row.price_change_pct,
  basePriceChange: row.base_price_change,
  basePriceChangePct: row.base_price_change_pct,
  currentVolume: row.current_volume,
  optimizedVolume: row.new_volume,
  volumeChangePct: row.volume_change_pct,
  currentRevenue: row.current_revenue,
  optimizedRevenue: row.new_revenue,
  revenueChangePct: row.revenue_change_pct,
  currentProfit: row.current_profit,
  optimizedProfit: row.new_profit,
  profitChangePct: row.profit_change_pct,
})

const applyScenarioToResult = (baseResult, scenarioId) => {
  const selectedScenario =
    baseResult.scenarioDetails[scenarioId] ??
    baseResult.scenarioDetails[baseResult.scenarioSummaries[0]?.scenarioId]

  if (!selectedScenario) {
    return {
      ...baseResult,
      selectedScenarioId: scenarioId,
      optimizedTotals: { totalVolume: 0, totalRevenue: 0, totalProfit: 0 },
      optimizedProducts: [],
      changedCount: 0,
      revenueLiftPct: 0,
      profitLiftPct: 0,
      volumeLiftPct: 0,
    }
  }

  return {
    ...baseResult,
    selectedScenarioId: selectedScenario.scenarioId,
    optimizedTotals: selectedScenario.optimizedTotals,
    optimizedProducts: selectedScenario.optimizedProducts,
    changedCount: selectedScenario.changedCount,
    revenueLiftPct: selectedScenario.revenueLiftPct,
    profitLiftPct: selectedScenario.profitLiftPct,
    volumeLiftPct: selectedScenario.volumeLiftPct,
  }
}

const buildInterpolatedResult = (fromResult, toResult, progress) => {
  const rows = toResult.optimizedProducts.map((toRow, index) => {
    const fromRow = fromResult.optimizedProducts[index] ?? toRow

    const optimizedAsp = lerp(fromRow.optimizedAsp, toRow.optimizedAsp, progress)
    const optimizedVolume = lerp(fromRow.optimizedVolume, toRow.optimizedVolume, progress)
    const optimizedRevenue = lerp(fromRow.optimizedRevenue, toRow.optimizedRevenue, progress)
    const optimizedProfit = lerp(fromRow.optimizedProfit, toRow.optimizedProfit, progress)

    return {
      ...toRow,
      optimizedAsp,
      optimizedVolume,
      optimizedRevenue,
      optimizedProfit,
      aspChange: optimizedAsp - toRow.currentAsp,
      aspChangePct: (optimizedAsp - toRow.currentAsp) / toRow.currentAsp,
      volumeChangePct: (optimizedVolume - toRow.currentVolume) / toRow.currentVolume,
      revenueChangePct: (optimizedRevenue - toRow.currentRevenue) / toRow.currentRevenue,
      profitChangePct:
        toRow.currentProfit === 0 ? 0 : (optimizedProfit - toRow.currentProfit) / toRow.currentProfit,
    }
  })

  const optimizedTotals = {
    totalVolume: lerp(fromResult.optimizedTotals.totalVolume, toResult.optimizedTotals.totalVolume, progress),
    totalRevenue: lerp(fromResult.optimizedTotals.totalRevenue, toResult.optimizedTotals.totalRevenue, progress),
    totalProfit: lerp(fromResult.optimizedTotals.totalProfit, toResult.optimizedTotals.totalProfit, progress),
  }

  const changedCount = rows.filter((row) => Math.abs(row.aspChange) >= 0.5).length
  const revenueLiftPct =
    (optimizedTotals.totalRevenue - toResult.currentTotals.totalRevenue) / toResult.currentTotals.totalRevenue
  const profitLiftPct =
    (optimizedTotals.totalProfit - toResult.currentTotals.totalProfit) / toResult.currentTotals.totalProfit
  const volumeLiftPct =
    (optimizedTotals.totalVolume - toResult.currentTotals.totalVolume) / toResult.currentTotals.totalVolume

  return {
    ...toResult,
    optimizedProducts: rows,
    optimizedTotals,
    changedCount,
    revenueLiftPct,
    profitLiftPct,
    volumeLiftPct,
  }
}

const adaptApiResult = (apiResult) => {
  const scenarioNameById = apiResult.ai_metadata?.scenario_name_by_id ?? {}
  const scenarioFamilyById = apiResult.ai_metadata?.scenario_family_by_id ?? {}
  const scenarioSummaries = (apiResult.scenario_summaries ?? []).map((item) => ({
    scenarioId: item.scenario_id,
    scenarioName:
      item.scenario_name ??
      scenarioNameById[item.scenario_id] ??
      `Scenario ${item.scenario_id}`,
    scenarioFamily:
      item.scenario_family ??
      scenarioFamilyById[item.scenario_id] ??
      'Balanced Ladder',
    rank: item.rank,
    objectiveValue: item.objective_value,
    totalVolume: item.total_volume,
    totalRevenue: item.total_revenue,
    totalProfit: item.total_profit,
    revenueLiftPct: item.revenue_uplift_pct,
    profitLiftPct: item.profit_uplift_pct,
    volumeLiftPct: item.volume_uplift_pct,
  }))

  const scenarioDetails = Object.fromEntries(
    Object.entries(apiResult.scenario_details ?? {}).map(([scenarioId, detail]) => {
      const summary = detail.summary ?? {}
      return [
        scenarioId,
        {
          scenarioId,
          optimizedTotals: {
            totalVolume: detail.totals?.total_volume ?? 0,
            totalRevenue: detail.totals?.total_revenue ?? 0,
            totalProfit: detail.totals?.total_profit ?? 0,
          },
          optimizedProducts: (detail.product_results ?? []).map(mapProductRow),
          changedCount: summary.changed_count ?? 0,
          revenueLiftPct: summary.revenue_uplift_pct ?? 0,
          profitLiftPct: summary.profit_uplift_pct ?? 0,
          volumeLiftPct: summary.volume_uplift_pct ?? 0,
        },
      ]
    }),
  )

  const baseResult = {
    controls: apiResult.controls,
    modelContext: {
      ownElasticities: apiResult.model_context?.own_elasticities ?? [],
      betaPpu: apiResult.model_context?.beta_ppu ?? [],
      crossMatrix: apiResult.model_context?.cross_matrix ?? [],
      gammaMatrix: apiResult.model_context?.gamma_matrix ?? [],
      basePrices: apiResult.model_context?.base_prices ?? [],
      baseVolumes: apiResult.model_context?.base_volumes ?? [],
    },
    baseTotals: {
      totalVolume: apiResult.base_totals?.total_volume ?? 0,
      totalRevenue: apiResult.base_totals?.total_revenue ?? 0,
      totalProfit: apiResult.base_totals?.total_profit ?? 0,
    },
    currentTotals: {
      totalVolume: apiResult.current_totals?.total_volume ?? 0,
      totalRevenue: apiResult.current_totals?.total_revenue ?? 0,
      totalProfit: apiResult.current_totals?.total_profit ?? 0,
    },
    scenarioSummaries,
    scenarioDetails,
    selectedMonth: apiResult.selected_month,
    aiMetadata: apiResult.ai_metadata ?? {},
  }

  const selectedScenarioId =
    apiResult.selected_scenario_id || scenarioSummaries[0]?.scenarioId || Object.keys(scenarioDetails)[0]

  return applyScenarioToResult(baseResult, selectedScenarioId)
}

const hasUsableOptimizationResult = (result) => {
  const scenarioCount = Array.isArray(result?.scenarioSummaries) ? result.scenarioSummaries.length : 0
  const productCount = Array.isArray(result?.optimizedProducts) ? result.optimizedProducts.length : 0
  return scenarioCount > 0 && productCount > 0
}

const computeTotalsFromRows = (rows) =>
  rows.reduce(
    (acc, row) => {
      acc.baseVolume += row.currentVolume ?? 0
      acc.baseRevenue += row.currentRevenue ?? 0
      acc.baseProfit += row.currentProfit ?? 0
      acc.optimizedVolume += row.optimizedVolume ?? 0
      acc.optimizedRevenue += row.optimizedRevenue ?? 0
      acc.optimizedProfit += row.optimizedProfit ?? 0
      return acc
    },
    {
      baseVolume: 0,
      baseRevenue: 0,
      baseProfit: 0,
      optimizedVolume: 0,
      optimizedRevenue: 0,
      optimizedProfit: 0,
    },
  )

const buildFallbackModelContext = (rows = []) => {
  const n = rows.length
  if (!n) {
    return {
      ownElasticities: [],
      betaPpu: [],
      gammaMatrix: [],
      basePrices: [],
      baseVolumes: [],
    }
  }

  const basePrices = rows.map((row) => Math.max(1, Number(row.baseAsp ?? 1)))
  const baseVolumes = rows.map((row) => Math.max(1, Number(row.currentVolume ?? 1)))
  const ownElasticities = rows.map((_, idx) => {
    const rank = n <= 1 ? 0 : idx / (n - 1)
    // Stable fallback range: [-0.7, -2.1]
    return Number((-0.7 - rank * 1.4).toFixed(4))
  })
  const betaPpu = ownElasticities.map((ownE, idx) => ownE * (baseVolumes[idx] / Math.max(1, basePrices[idx])))
  const gammaMatrix = rows.map((rowI, i) => {
    const pI = Math.max(1, Number(rowI.baseAsp ?? 1))
    return rows.map((rowJ, j) => {
      if (i === j) return 0
      const pJ = Math.max(1, Number(rowJ.baseAsp ?? 1))
      const gap = Math.abs(pI - pJ)
      if (gap > 100) return 0
      const closeness = 1 - gap / 100
      const crossElasticity = -(0.05 + closeness * 0.30)
      return Number((crossElasticity * (baseVolumes[i] / pJ)).toFixed(6))
    })
  })

  return {
    ownElasticities,
    betaPpu,
    gammaMatrix,
    basePrices,
    baseVolumes,
  }
}

const buildBaselineResult = (selectedMonth, monthRows = []) => {
  const rows = monthRows
    .slice()
    .sort((a, b) => a.basePrice - b.basePrice || a.productName.localeCompare(b.productName))
    .map((row) => {
      const baseAsp = row.basePrice
      const volume = Math.max(1, Number(row.volume ?? 1))
      const unitCost = baseAsp * 0.4
      const revenue = baseAsp * volume
      const profit = (baseAsp - unitCost) * volume

      return {
        productName: row.productName,
        baseAsp,
        segmentKey: getSegmentKey(baseAsp),
        segmentLabel: getSegmentLabel(baseAsp),
        currentAsp: baseAsp,
        optimizedAsp: baseAsp,
        aspChange: 0,
        aspChangePct: 0,
        basePriceChange: 0,
        basePriceChangePct: 0,
        currentVolume: volume,
        optimizedVolume: volume,
        volumeChangePct: 0,
        currentRevenue: revenue,
        optimizedRevenue: revenue,
        revenueChangePct: 0,
        currentProfit: profit,
        optimizedProfit: profit,
        profitChangePct: 0,
      }
    })
  const fallbackContext = buildFallbackModelContext(rows)

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalVolume += row.currentVolume
      acc.totalRevenue += row.currentRevenue
      acc.totalProfit += row.currentProfit
      return acc
    },
    { totalVolume: 0, totalRevenue: 0, totalProfit: 0 },
  )

  const baselineScenario = {
    scenarioId: 'base',
    scenarioName: 'Base Plan',
    scenarioFamily: 'Baseline',
    rank: 1,
    objectiveValue: totals.totalRevenue,
    totalVolume: totals.totalVolume,
    totalRevenue: totals.totalRevenue,
    totalProfit: totals.totalProfit,
    revenueLiftPct: 0,
    profitLiftPct: 0,
    volumeLiftPct: 0,
  }

  return {
    controls: {},
    modelContext: {
      ownElasticities: fallbackContext.ownElasticities,
      betaPpu: fallbackContext.betaPpu,
      crossMatrix: [],
      gammaMatrix: fallbackContext.gammaMatrix,
      basePrices: fallbackContext.basePrices,
      baseVolumes: fallbackContext.baseVolumes,
    },
    baseTotals: totals,
    currentTotals: totals,
    optimizedTotals: totals,
    optimizedProducts: rows,
    changedCount: 0,
    revenueLiftPct: 0,
    profitLiftPct: 0,
    volumeLiftPct: 0,
    scenarioSummaries: [baselineScenario],
    scenarioDetails: {
      base: {
        scenarioId: 'base',
        optimizedTotals: totals,
        optimizedProducts: rows,
        changedCount: 0,
        revenueLiftPct: 0,
        profitLiftPct: 0,
        volumeLiftPct: 0,
      },
    },
    selectedScenarioId: 'base',
    selectedMonth,
    aiMetadata: {
      ai_source: 'baseline',
      generation_counts: {
        final_candidates: 1,
      },
    },
  }
}

const AspDeterminationPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [optimizationResult, setOptimizationResult] = useState(null)
  const [displayResult, setDisplayResult] = useState(null)
  const [isRunningOptimization, setIsRunningOptimization] = useState(false)
  const [isParamsReady, setIsParamsReady] = useState(false)
  const [optimizationError, setOptimizationError] = useState('')
  const [runNotice, setRunNotice] = useState('')
  const [jobProgress, setJobProgress] = useState({ progressPct: 0, stage: '' })
  const [saveNotice, setSaveNotice] = useState('')
  const [saveError, setSaveError] = useState('')
  const [productConstraints, setProductConstraints] = useState({})
  const [basePriceEditMap, setBasePriceEditMap] = useState({})
  const [basePriceDraftMap, setBasePriceDraftMap] = useState({})
  const [recommendedPriceEditMap, setRecommendedPriceEditMap] = useState({})
  const [recommendedPriceDraftMap, setRecommendedPriceDraftMap] = useState({})
  const [uiStage, setUiStage] = useState('setup')
  const [generationCollapsed, setGenerationCollapsed] = useState(false)
  const [selectionCollapsed, setSelectionCollapsed] = useState(false)
  const [selectedSegment, setSelectedSegment] = useState(null)
  const [savedScenarios, setSavedScenarios] = useState(() => readStep3SavedScenarios())
  const [savedDockOpen, setSavedDockOpen] = useState(false)
  const [isLadderModalOpen, setIsLadderModalOpen] = useState(false)
  const [scenarioConfirm, setScenarioConfirm] = useState(null)
  const animationFrameRef = useRef(null)
  const savedDockRef = useRef(null)

  const monthOptions = useMemo(() => getInsightsMonths(), [])
  const latestMonth = monthOptions[monthOptions.length - 1]
  const selectedMonth = latestMonth
  const monthProducts = useMemo(() => {
    return getMonthData(selectedMonth)
      .slice()
      .sort((a, b) => a.basePrice - b.basePrice || a.productName.localeCompare(b.productName))
      .map((row) => ({
        productName: row.productName,
        basePrice: row.basePrice,
        segmentKey: getSegmentKey(row.basePrice),
        segmentLabel: getSegmentLabel(row.basePrice),
      }))
  }, [selectedMonth])
  const baselineResult = useMemo(
    () => buildBaselineResult(selectedMonth, getMonthData(selectedMonth)),
    [selectedMonth],
  )

  const controls = useMemo(
    () => ({
      objective: 'revenue',
      grossMarginPct: clamp(parseNumber(searchParams.get('aGm'), 40), 20, 60),
      prompt: searchParams.get('aPrompt') ?? '',
      dailyMaxDecrease: clamp(parseNumber(searchParams.get('aDDec'), 100), 0, 150),
      dailyMaxIncrease: clamp(parseNumber(searchParams.get('aDInc'), 100), 0, 150),
      dailyNoChange: parseBool(searchParams.get('aDNo'), false),
      coreMaxDecrease: clamp(parseNumber(searchParams.get('aCDec'), 100), 0, 150),
      coreMaxIncrease: clamp(parseNumber(searchParams.get('aCInc'), 100), 0, 150),
      coreNoChange: parseBool(searchParams.get('aCNo'), false),
      premiumMaxDecrease: clamp(parseNumber(searchParams.get('aPDec'), 100), 0, 150),
      premiumMaxIncrease: clamp(parseNumber(searchParams.get('aPInc'), 100), 0, 150),
      premiumNoChange: parseBool(searchParams.get('aPNo'), false),
      minVolumeUpliftPct: parseOptionalFilterParam(searchParams.get('aMinVol'), -100, 500),
      minRevenueUpliftPct: parseOptionalFilterParam(searchParams.get('aMinRev'), -100, 500),
      minProfitUpliftPct: parseOptionalFilterParam(searchParams.get('aMinProf'), -100, 500),
    }),
    [searchParams],
  )

  const buildDefaultProductConstraints = useCallback(
    () =>
      Object.fromEntries(
        monthProducts.map((item) => {
          const segmentRange = getSegmentRanges(controls, item.segmentKey)
          if (segmentRange.noChange) {
            return [
              item.productName,
              {
                noChange: true,
                minPrice: item.basePrice,
                maxPrice: item.basePrice,
              },
            ]
          }
          return [
            item.productName,
            {
              noChange: false,
              minPrice: Math.max(1, item.basePrice - segmentRange.maxDecrease),
              maxPrice: item.basePrice + segmentRange.maxIncrease,
            },
          ]
        }),
      ),
    [monthProducts, controls],
  )

  useEffect(() => {
    if (!monthProducts.length) {
      setProductConstraints({})
      return
    }
    setProductConstraints((prev) => {
      const defaults = buildDefaultProductConstraints()
      const next = {}
      for (const product of monthProducts) {
        const key = product.productName
        const existing = prev[key]
        const noChange = Boolean(existing?.noChange)
        const minPrice = Number(existing?.minPrice)
        const maxPrice = Number(existing?.maxPrice)
        if (noChange) {
          next[key] = {
            noChange: true,
            minPrice: product.basePrice,
            maxPrice: product.basePrice,
          }
          continue
        }
        next[key] =
          Number.isFinite(minPrice) && Number.isFinite(maxPrice)
            ? { noChange: false, minPrice, maxPrice }
            : defaults[key]
      }
      return next
    })
  }, [monthProducts, buildDefaultProductConstraints])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let dirty = false

    if (next.get('step') !== '3') {
      next.set('step', '3')
      dirty = true
    }

    if (next.has('aMonth')) {
      next.delete('aMonth')
      dirty = true
    }

    if (!next.get('aObj') || !['revenue', 'profit'].includes(next.get('aObj'))) {
      next.set('aObj', 'revenue')
      dirty = true
    }

    if (!next.get('aGm')) {
      next.set('aGm', '40')
      dirty = true
    }
    if (!next.get('aDDec')) {
      next.set('aDDec', '100')
      dirty = true
    }
    if (!next.get('aDInc')) {
      next.set('aDInc', '100')
      dirty = true
    }
    if (!next.get('aDNo')) {
      next.set('aDNo', '0')
      dirty = true
    }
    if (!next.get('aCDec')) {
      next.set('aCDec', '100')
      dirty = true
    }
    if (!next.get('aCInc')) {
      next.set('aCInc', '100')
      dirty = true
    }
    if (!next.get('aCNo')) {
      next.set('aCNo', '0')
      dirty = true
    }
    if (!next.get('aPDec')) {
      next.set('aPDec', '100')
      dirty = true
    }
    if (!next.get('aPInc')) {
      next.set('aPInc', '100')
      dirty = true
    }
    if (!next.get('aPNo')) {
      next.set('aPNo', '0')
      dirty = true
    }
    ;['aMinVol', 'aMinRev', 'aMinProf'].forEach((filterKey) => {
      if (next.get(filterKey) === '-100') {
        next.delete(filterKey)
        dirty = true
      }
    })
    ;[
      'aMaxChg',
      'aMinRet',
      'aRevDropPct',
      'aProfDropPct',
      'aGap',
      'aRevFloor',
      'aProfFloor',
      'aIter',
      'aRevFloorVal',
      'aProfFloorVal',
    ].forEach((legacyKey) => {
      if (next.has(legacyKey)) {
        next.delete(legacyKey)
        dirty = true
      }
    })

    if (dirty) {
      setIsParamsReady(false)
      setSearchParams(next, { replace: true })
      return
    }

    setIsParamsReady(true)
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!isParamsReady) return
    if (!displayResult) {
      setOptimizationResult(baselineResult)
      setDisplayResult(baselineResult)
    }
  }, [isParamsReady, displayResult, baselineResult])

  useEffect(() => {
    if (!isParamsReady || displayResult) return
    const snapshot = readAspViewState()
    if (!snapshot) return
    if (snapshot.selectedMonth !== selectedMonth) return

    const restoredOptimization = snapshot.optimizationResult
    const restoredDisplay = snapshot.displayResult
    const hasRows =
      Array.isArray(restoredDisplay?.optimizedProducts) && restoredDisplay.optimizedProducts.length > 0
    const hasScenarios =
      Array.isArray(restoredDisplay?.scenarioSummaries) && restoredDisplay.scenarioSummaries.length > 0
    if (!hasRows || !hasScenarios) return

    setOptimizationResult(restoredOptimization ?? restoredDisplay)
    setDisplayResult(restoredDisplay)
    setUiStage(snapshot.uiStage ?? 'workspace')
    setGenerationCollapsed(Boolean(snapshot.generationCollapsed))
    setSelectionCollapsed(Boolean(snapshot.selectionCollapsed))
    setSelectedSegment(snapshot.selectedSegment ?? null)
    setProductConstraints(snapshot.productConstraints ?? {})
    setBasePriceEditMap(snapshot.basePriceEditMap ?? {})
    setBasePriceDraftMap({})
    setRecommendedPriceEditMap(snapshot.recommendedPriceEditMap ?? {})
    setRecommendedPriceDraftMap({})
    setIsRunningOptimization(false)
    setOptimizationError('')
    setRunNotice('')
    setJobProgress({ progressPct: 0, stage: '' })
  }, [isParamsReady, displayResult, selectedMonth])

  const setParams = (patch) => {
    const next = new URLSearchParams(searchParams)
    next.delete('aMonth')

    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
    })

    next.set('step', '3')
    setSearchParams(next)
  }

  const applyControlPatch = (patch) => {
    const mapped = {}
    if (patch.grossMarginPct !== undefined) mapped.aGm = patch.grossMarginPct
    if (patch.prompt !== undefined) mapped.aPrompt = patch.prompt
    if (patch.dailyMaxDecrease !== undefined) mapped.aDDec = clamp(Number(patch.dailyMaxDecrease) || 0, 0, 150)
    if (patch.dailyMaxIncrease !== undefined) mapped.aDInc = clamp(Number(patch.dailyMaxIncrease) || 0, 0, 150)
    if (patch.dailyNoChange !== undefined) mapped.aDNo = patch.dailyNoChange ? '1' : '0'
    if (patch.coreMaxDecrease !== undefined) mapped.aCDec = clamp(Number(patch.coreMaxDecrease) || 0, 0, 150)
    if (patch.coreMaxIncrease !== undefined) mapped.aCInc = clamp(Number(patch.coreMaxIncrease) || 0, 0, 150)
    if (patch.coreNoChange !== undefined) mapped.aCNo = patch.coreNoChange ? '1' : '0'
    if (patch.premiumMaxDecrease !== undefined) mapped.aPDec = clamp(Number(patch.premiumMaxDecrease) || 0, 0, 150)
    if (patch.premiumMaxIncrease !== undefined) mapped.aPInc = clamp(Number(patch.premiumMaxIncrease) || 0, 0, 150)
    if (patch.premiumNoChange !== undefined) mapped.aPNo = patch.premiumNoChange ? '1' : '0'
    if (patch.minVolumeUpliftPct !== undefined) {
      mapped.aMinVol =
        patch.minVolumeUpliftPct === '' ? null : clamp(Number(patch.minVolumeUpliftPct) || 0, -100, 500)
    }
    if (patch.minRevenueUpliftPct !== undefined) {
      mapped.aMinRev =
        patch.minRevenueUpliftPct === '' ? null : clamp(Number(patch.minRevenueUpliftPct) || 0, -100, 500)
    }
    if (patch.minProfitUpliftPct !== undefined) {
      mapped.aMinProf =
        patch.minProfitUpliftPct === '' ? null : clamp(Number(patch.minProfitUpliftPct) || 0, -100, 500)
    }
    setParams(mapped)
  }

  const runOptimization = useCallback(
    async (animate = true) => {
      if (isRunningOptimization) {
        return
      }

      if (!selectedMonth) {
        return
      }

      setOptimizationError('')
      setRunNotice('')
      setIsRunningOptimization(true)

      try {
        setJobProgress({ progressPct: 1, stage: 'Queued' })
        const inferredObjective = inferObjectiveFromPrompt(controls.prompt)
        const apiResult = await runAspOptimizationJob(
          {
            selected_month: selectedMonth,
            optimization_objective: inferredObjective,
            gross_margin_pct: controls.grossMarginPct,
            prompt: controls.prompt ?? '',
            scenario_count: 1000,
            segment_constraints: {
              daily_casual: {
                no_change: Boolean(controls.dailyNoChange),
                max_decrease: clamp(Number(controls.dailyMaxDecrease) || 0, 0, 150),
                max_increase: clamp(Number(controls.dailyMaxIncrease) || 0, 0, 150),
              },
              core_plus: {
                no_change: Boolean(controls.coreNoChange),
                max_decrease: clamp(Number(controls.coreMaxDecrease) || 0, 0, 150),
                max_increase: clamp(Number(controls.coreMaxIncrease) || 0, 0, 150),
              },
              premium: {
                no_change: Boolean(controls.premiumNoChange),
                max_decrease: clamp(Number(controls.premiumMaxDecrease) || 0, 0, 150),
                max_increase: clamp(Number(controls.premiumMaxIncrease) || 0, 0, 150),
              },
            },
            product_constraints: Object.fromEntries(
              Object.entries(productConstraints).map(([productName, item]) => {
                const product = monthProducts.find((entry) => entry.productName === productName)
                const basePrice = product?.basePrice ?? 1
                const segmentKey = product?.segmentKey ?? getSegmentKey(basePrice)
                const segmentNoChange =
                  (segmentKey === 'daily' && Boolean(controls.dailyNoChange)) ||
                  (segmentKey === 'core' && Boolean(controls.coreNoChange)) ||
                  (segmentKey === 'premium' && Boolean(controls.premiumNoChange))
                const noChange = segmentNoChange || Boolean(item?.noChange)
                let minPrice = clampToProductBand(item?.minPrice ?? basePrice - 150, basePrice)
                let maxPrice = clampToProductBand(item?.maxPrice ?? basePrice + 150, basePrice)
                if (!noChange && Math.abs(maxPrice - minPrice) < 0.5) {
                  const segmentRange = getSegmentRanges(controls, segmentKey)
                  minPrice = clampToProductBand(basePrice - segmentRange.maxDecrease, basePrice)
                  maxPrice = clampToProductBand(basePrice + segmentRange.maxIncrease, basePrice)
                }
                return [
                  productName,
                  {
                    no_change: noChange,
                    min_price: noChange ? basePrice : Math.min(minPrice, maxPrice),
                    max_price: noChange ? basePrice : Math.max(minPrice, maxPrice),
                  },
                ]
              }),
            ),
          },
          {
            pollMs: 1000,
            timeoutMs: 240000,
            onProgress: (status) => {
              setJobProgress({
                progressPct: Number.isFinite(status?.progress_pct) ? status.progress_pct : 0,
                stage: status?.stage || 'Running',
              })
            },
          },
        )
        const result = adaptApiResult(apiResult)
        if (!hasUsableOptimizationResult(result)) {
          throw new Error('Optimization finished but no scenarios were returned. Relax constraints and run again.')
        }
        const scenarioCount = result.scenarioSummaries?.length ?? 0
        setRunNotice(`Optimization completed. ${scenarioCount} scenarios generated.`)
        setTimeout(() => setRunNotice(''), 3000)

        if (!animate || !displayResult) {
          setOptimizationResult(result)
          setDisplayResult(result)
          setBasePriceEditMap({})
          setBasePriceDraftMap({})
          setRecommendedPriceEditMap({})
          setRecommendedPriceDraftMap({})
          setSelectedSegment(null)
          setUiStage('selection')
          setGenerationCollapsed(true)
          setSelectionCollapsed(false)
          writeCachedResult({ selectedMonth, controls, productConstraints, result })
          setJobProgress({ progressPct: 100, stage: 'Completed' })
          return
        }

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
        }

        const fromResult = displayResult
        const start = performance.now()
        const durationMs = 850

        const animateFrame = (now) => {
          const rawProgress = Math.min((now - start) / durationMs, 1)
          const easedProgress = 1 - (1 - rawProgress) ** 3
          setDisplayResult(buildInterpolatedResult(fromResult, result, easedProgress))

          if (rawProgress < 1) {
            animationFrameRef.current = requestAnimationFrame(animateFrame)
            return
          }

          setOptimizationResult(result)
          setDisplayResult(result)
          setBasePriceEditMap({})
          setBasePriceDraftMap({})
          setRecommendedPriceEditMap({})
          setRecommendedPriceDraftMap({})
          setSelectedSegment(null)
          setUiStage('selection')
          setGenerationCollapsed(true)
          setSelectionCollapsed(false)
          writeCachedResult({ selectedMonth, controls, productConstraints, result })
          setJobProgress({ progressPct: 100, stage: 'Completed' })
          animationFrameRef.current = null
        }

        animationFrameRef.current = requestAnimationFrame(animateFrame)
      } catch (error) {
        setOptimizationError(error?.message || 'Optimization request failed.')
        setRunNotice('')
        setJobProgress((prev) => ({ progressPct: prev.progressPct || 100, stage: 'Failed' }))
      } finally {
        setIsRunningOptimization(false)
      }
    },
    [controls, displayResult, selectedMonth, isRunningOptimization, productConstraints, monthProducts],
  )

  const selectScenario = useCallback(
    (scenarioId, animate = true, stage = 'selection') => {
      if (!optimizationResult || !optimizationResult.scenarioDetails?.[scenarioId]) {
        return
      }
      setUiStage(stage)

      const targetResult = applyScenarioToResult(optimizationResult, scenarioId)
      if (!animate || !displayResult) {
        setDisplayResult(targetResult)
        setBasePriceEditMap({})
        setBasePriceDraftMap({})
        setRecommendedPriceEditMap({})
        setRecommendedPriceDraftMap({})
        setSelectedSegment(null)
        writeCachedResult({ selectedMonth, controls, productConstraints, result: targetResult })
        return
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      const fromResult = displayResult
      const start = performance.now()
      const durationMs = 700

      const animateFrame = (now) => {
        const rawProgress = Math.min((now - start) / durationMs, 1)
        const easedProgress = 1 - (1 - rawProgress) ** 3
        setDisplayResult(buildInterpolatedResult(fromResult, targetResult, easedProgress))

        if (rawProgress < 1) {
          animationFrameRef.current = requestAnimationFrame(animateFrame)
          return
        }

        setDisplayResult(targetResult)
        setBasePriceEditMap({})
        setBasePriceDraftMap({})
        setRecommendedPriceEditMap({})
        setRecommendedPriceDraftMap({})
        setSelectedSegment(null)
        writeCachedResult({ selectedMonth, controls, productConstraints, result: targetResult })
        animationFrameRef.current = null
      }

      animationFrameRef.current = requestAnimationFrame(animateFrame)
    },
    [displayResult, optimizationResult, productConstraints],
  )

  useEffect(() => {
    if (isParamsReady && selectedMonth && !displayResult) {
      const cached = readCachedResult({ selectedMonth, controls, productConstraints })
      if (cached) {
        setOptimizationResult(cached)
        setDisplayResult(cached)
        setBasePriceEditMap({})
        setBasePriceDraftMap({})
        setRecommendedPriceEditMap({})
        setRecommendedPriceDraftMap({})
        setIsRunningOptimization(false)
        return
      }
    }
  }, [isParamsReady, selectedMonth, displayResult, controls, productConstraints, runOptimization])

  useEffect(() => {
    if (!isParamsReady || !displayResult) return
    writeAspViewState({
      selectedMonth,
      optimizationResult,
      displayResult,
      uiStage,
      generationCollapsed,
      selectionCollapsed,
      selectedSegment,
      productConstraints,
      basePriceEditMap,
      recommendedPriceEditMap,
      savedAt: Date.now(),
    })
  }, [
    isParamsReady,
    selectedMonth,
    optimizationResult,
    displayResult,
    uiStage,
    generationCollapsed,
    selectionCollapsed,
    selectedSegment,
    productConstraints,
    basePriceEditMap,
    recommendedPriceEditMap,
  ])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  const handleProductConstraintChange = (productName, patch) => {
    setProductConstraints((prev) => {
      const current = prev[productName] ?? {}
      const product = monthProducts.find((item) => item.productName === productName)
      const basePrice = product?.basePrice ?? 1
      const noChange = patch?.noChange !== undefined ? Boolean(patch.noChange) : Boolean(current.noChange)
      if (noChange) {
        return {
          ...prev,
          [productName]: {
            noChange: true,
            minPrice: basePrice,
            maxPrice: basePrice,
          },
        }
      }
      const nextMin = clampToProductBand(patch?.minPrice ?? current.minPrice ?? basePrice - 150, basePrice)
      const nextMax = clampToProductBand(patch?.maxPrice ?? current.maxPrice ?? basePrice + 150, basePrice)
      return {
        ...prev,
        [productName]: {
          noChange: false,
          minPrice: Math.min(nextMin, nextMax),
          maxPrice: Math.max(nextMin, nextMax),
        },
      }
    })
  }

  const handleResetProductConstraints = () => {
    setProductConstraints(buildDefaultProductConstraints())
  }

  const activeResult = displayResult ?? optimizationResult ?? baselineResult

  const selectionResult = useMemo(() => {
    if (!activeResult) return null
    const firstScenarioId = activeResult.scenarioSummaries?.[0]?.scenarioId
    const seedRows =
      activeResult.scenarioDetails?.[firstScenarioId]?.optimizedProducts ??
      activeResult.optimizedProducts
    const baseScenarioRows = (seedRows ?? []).map((row) => ({
      ...row,
      optimizedAsp: row.baseAsp ?? row.currentAsp,
      optimizedVolume: row.currentVolume,
      optimizedRevenue: row.currentRevenue,
      optimizedProfit: row.currentProfit,
      basePriceChange: 0,
      basePriceChangePct: 0,
      volumeChangePct: 0,
      revenueChangePct: 0,
      profitChangePct: 0,
    }))
    const driftedBaseRows = buildDisplayRows({
      rows: baseScenarioRows,
      selectedMonth,
      basePriceEditMap: {},
      modelContext: activeResult.modelContext,
    })
    const baseTotalsComputed = computeTotalsFromRows(driftedBaseRows)
    const baselineRevenue = Math.max(1, baseTotalsComputed.baseRevenue)
    const baselineProfit = Math.max(1, Math.abs(baseTotalsComputed.baseProfit))
    const baselineVolume = Math.max(1, baseTotalsComputed.baseVolume)

    const scenarioSummaries = (activeResult.scenarioSummaries ?? []).map((scenario) => {
      const detailRows =
        activeResult.scenarioDetails?.[scenario.scenarioId]?.optimizedProducts ?? activeResult.optimizedProducts
      const driftedRows = buildDisplayRows({
        rows: detailRows,
        selectedMonth,
        basePriceEditMap: {},
        modelContext: activeResult.modelContext,
      })
      const totals = computeTotalsFromRows(driftedRows)
      return {
        ...scenario,
        totalVolume: totals.optimizedVolume,
        totalRevenue: totals.optimizedRevenue,
        totalProfit: totals.optimizedProfit,
        volumeLiftPct: (totals.optimizedVolume - baselineVolume) / baselineVolume,
        revenueLiftPct: (totals.optimizedRevenue - baselineRevenue) / baselineRevenue,
        profitLiftPct: (totals.optimizedProfit - baselineProfit) / baselineProfit,
      }
    })

    return {
      ...activeResult,
      baseTotals: {
        totalVolume: baseTotalsComputed.baseVolume,
        totalRevenue: baseTotalsComputed.baseRevenue,
        totalProfit: baseTotalsComputed.baseProfit,
      },
      scenarioSummaries,
    }
  }, [activeResult, selectedMonth])

  const scenarioPanelHeaderSummary = useMemo(
    () =>
      selectionResult
        ? getScenarioSelectionSummary(selectionResult, {
            minVolumeUpliftPct: controls.minVolumeUpliftPct,
            minRevenueUpliftPct: controls.minRevenueUpliftPct,
            minProfitUpliftPct: controls.minProfitUpliftPct,
          })
        : null,
    [
      selectionResult,
      controls.minVolumeUpliftPct,
      controls.minRevenueUpliftPct,
      controls.minProfitUpliftPct,
    ],
  )

  /** Baseline-only has a single summary; a completed Run adds many scenarios. */
  const hasOptimizationScenariosGenerated = useMemo(() => {
    const n = optimizationResult?.scenarioSummaries?.length ?? 0
    return n > 1
  }, [optimizationResult])

  const handleScenarioPickRequest = useCallback(
    (scenarioId) => {
      if (!selectionResult?.scenarioSummaries?.length) return
      const picked = selectionResult.scenarioSummaries.find((item) => item.scenarioId === scenarioId)
      if (!picked) return
      const detailRows =
        optimizationResult?.scenarioDetails?.[scenarioId]?.optimizedProducts
          ?.slice()
          .sort((a, b) => Number(b.baseAsp ?? b.currentAsp ?? 0) - Number(a.baseAsp ?? a.currentAsp ?? 0))
          .map((row) => {
            const basePrice = Number(row.baseAsp ?? row.currentAsp ?? 0)
            const recommendedPrice = Number(row.optimizedAsp ?? basePrice)
            const segmentKey = row.segmentKey ?? getSegmentKey(basePrice)
            return {
              productName: row.productName,
              basePrice,
              recommendedPrice,
              segmentKey,
              segmentLabel: getSegmentLabelFromKey(segmentKey),
            }
          }) ?? []
      setScenarioConfirm({
        scenarioId,
        scenarioName: picked.scenarioName ?? `Scenario ${picked.scenarioId}`,
        volumeLiftPct: Number(picked.volumeLiftPct ?? 0),
        revenueLiftPct: Number(picked.revenueLiftPct ?? 0),
        profitLiftPct: Number(picked.profitLiftPct ?? 0),
        priceRows: detailRows,
      })
    },
    [selectionResult, optimizationResult],
  )

  const handleScenarioConfirmContinue = useCallback(() => {
    if (!scenarioConfirm?.scenarioId) {
      setScenarioConfirm(null)
      return
    }
    selectScenario(scenarioConfirm.scenarioId, true, 'workspace')
    setSelectionCollapsed(true)
    setScenarioConfirm(null)
  }, [scenarioConfirm, selectScenario])

  const liveBasePriceMap = useMemo(() => {
    const rows = activeResult?.optimizedProducts ?? []
    const next = { ...basePriceEditMap }
    rows.forEach((row) => {
      const rawDraft = basePriceDraftMap[row.productName]
      if (rawDraft === undefined || rawDraft === null || rawDraft === '') return
      const parsed = Number(String(rawDraft).replace(/[^\d]/g, ''))
      if (!Number.isFinite(parsed) || parsed <= 0) return
      const baseAnchor = row.baseAsp ?? parsed
      next[row.productName] = clampRecommendedToBaseBand(parsed, baseAnchor)
    })
    return next
  }, [activeResult, basePriceEditMap, basePriceDraftMap])

  const liveRecommendedPriceMap = useMemo(() => {
    const rows = activeResult?.optimizedProducts ?? []
    const next = { ...recommendedPriceEditMap }
    rows.forEach((row) => {
      const rawDraft = recommendedPriceDraftMap[row.productName]
      if (rawDraft === undefined || rawDraft === null || rawDraft === '') return
      const parsed = Number(String(rawDraft).replace(/[^\d]/g, ''))
      if (!Number.isFinite(parsed) || parsed <= 0) return
      const baseAnchor = row.baseAsp ?? parsed
      next[row.productName] = clampRecommendedToBaseBand(parsed, baseAnchor)
    })
    return next
  }, [activeResult, recommendedPriceEditMap, recommendedPriceDraftMap])

  const displayRows = useMemo(
    () =>
      buildDisplayRows({
        rows: activeResult?.optimizedProducts ?? [],
        selectedMonth,
        basePriceEditMap: liveBasePriceMap,
        recommendedPriceEditMap: liveRecommendedPriceMap,
        modelContext: activeResult?.modelContext,
      }),
    [activeResult, selectedMonth, liveBasePriceMap, liveRecommendedPriceMap],
  )

  const displayViewResult = useMemo(() => {
    if (!activeResult) return null
    const totals = computeTotalsFromRows(displayRows)
    const baseTotals = {
      totalVolume: totals.baseVolume,
      totalRevenue: totals.baseRevenue,
      totalProfit: totals.baseProfit,
    }
    const optimizedTotals = {
      totalVolume: totals.optimizedVolume,
      totalRevenue: totals.optimizedRevenue,
      totalProfit: totals.optimizedProfit,
    }
    const changedCount = displayRows.filter((row) => Math.abs(row.basePriceChange ?? 0) >= 0.5).length
    const revenueLiftPct =
      (optimizedTotals.totalRevenue - baseTotals.totalRevenue) / Math.max(1, baseTotals.totalRevenue)
    const profitLiftPct =
      (optimizedTotals.totalProfit - baseTotals.totalProfit) / Math.max(1, Math.abs(baseTotals.totalProfit))
    const volumeLiftPct =
      (optimizedTotals.totalVolume - baseTotals.totalVolume) / Math.max(1, baseTotals.totalVolume)

    return {
      ...activeResult,
      baseTotals,
      currentTotals: baseTotals,
      optimizedTotals,
      optimizedProducts: displayRows,
      changedCount,
      revenueLiftPct,
      profitLiftPct,
      volumeLiftPct,
    }
  }, [activeResult, displayRows])

  const baseInputValues = useMemo(() => {
    const rows = displayViewResult?.optimizedProducts ?? []
    return Object.fromEntries(
      rows.map((row) => {
        const draft = basePriceDraftMap[row.productName]
        const committed = basePriceEditMap[row.productName]
        return [row.productName, draft ?? (Number.isFinite(Number(committed)) ? String(Math.round(Number(committed))) : String(Math.round(row.baseAsp)))]
      }),
    )
  }, [displayViewResult, basePriceDraftMap, basePriceEditMap])

  const recommendedInputValues = useMemo(() => {
    const rows = displayViewResult?.optimizedProducts ?? []
    return Object.fromEntries(
      rows.map((row) => {
        const draft = recommendedPriceDraftMap[row.productName]
        return [row.productName, draft ?? String(Math.round(row.optimizedAsp))]
      }),
    )
  }, [displayViewResult, recommendedPriceDraftMap])

  const handleBaseDraftChange = (productName, nextValue) => {
    const digitsOnly = String(nextValue ?? '').replace(/[^\d]/g, '')
    setBasePriceDraftMap((prev) => ({
      ...prev,
      [productName]: digitsOnly,
    }))
  }

  const handleBaseCommit = (productName, rawValue) => {
    const draft = rawValue !== undefined ? String(rawValue ?? '').replace(/[^\d]/g, '') : basePriceDraftMap[productName]
    if (draft === undefined) {
      return
    }
    if (!draft) {
      setBasePriceDraftMap((prev) => {
        const next = { ...prev }
        delete next[productName]
        return next
      })
      return
    }

    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) return
    const sourceRows = activeResult?.optimizedProducts ?? []
    const row = sourceRows.find((item) => item.productName === productName)
    const originalBase = row?.baseAsp ?? parsed
    const bounded = clampRecommendedToBaseBand(parsed, originalBase)

    setBasePriceEditMap((prev) => ({
      ...prev,
      [productName]: bounded,
    }))
    setBasePriceDraftMap((prev) => {
      const next = { ...prev }
      delete next[productName]
      return next
    })
  }

  const handleRecommendedDraftChange = (productName, nextValue) => {
    const digitsOnly = String(nextValue ?? '').replace(/[^\d]/g, '')
    setRecommendedPriceDraftMap((prev) => ({
      ...prev,
      [productName]: digitsOnly,
    }))
  }

  const handleRecommendedCommit = (productName, rawValue) => {
    const draft =
      rawValue !== undefined ? String(rawValue ?? '').replace(/[^\d]/g, '') : recommendedPriceDraftMap[productName]
    if (draft === undefined) return
    if (!draft) {
      setRecommendedPriceDraftMap((prev) => {
        const next = { ...prev }
        delete next[productName]
        return next
      })
      return
    }

    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) return
    const sourceRows = activeResult?.optimizedProducts ?? []
    const row = sourceRows.find((item) => item.productName === productName)
    const baseAnchor = row?.baseAsp ?? parsed
    const bounded = clampRecommendedToBaseBand(parsed, baseAnchor)

    setRecommendedPriceEditMap((prev) => ({
      ...prev,
      [productName]: bounded,
    }))
    setRecommendedPriceDraftMap((prev) => {
      const next = { ...prev }
      delete next[productName]
      return next
    })
  }

  const handleSaveScenario = () => {
    const source = displayViewResult ?? activeResult
    if (!source?.optimizedProducts?.length) return

    const scenarioName =
      source.scenarioSummaries?.find((item) => item.scenarioId === source.selectedScenarioId)?.scenarioName ??
      `Scenario ${source.selectedScenarioId}`
    const snapshot = buildStep3SavedScenarioSnapshot({
      source,
      scenarioName,
    })

    const next = [snapshot, ...savedScenarios].slice(0, 200)
    setSavedScenarios(next)
    setSavedDockOpen(false)
    writeStep3SavedScenarios(next)
    setUiStage('workspace')
    setGenerationCollapsed(true)
    setSelectionCollapsed(true)
    setSaveError('')
    setSaveNotice(`Saved scenario (${next.length})`)
    setTimeout(() => setSaveNotice(''), 2500)
  }

  const handleResetBasePrices = useCallback(() => {
    setBasePriceEditMap({})
    setBasePriceDraftMap({})
    setSelectedSegment(null)
    setRunNotice('Prices reset to base.')
    setTimeout(() => setRunNotice(''), 2200)
  }, [])

  const handleResetToBaseScenario = useCallback(() => {
    const sourceRows = activeResult?.optimizedProducts ?? []
    if (!sourceRows.length) return

    const resetRecommendedMap = Object.fromEntries(
      sourceRows.map((row) => [
        row.productName,
        Math.max(1, Number(row.baseAsp ?? row.currentAsp ?? 1)),
      ]),
    )

    setBasePriceEditMap({})
    setBasePriceDraftMap({})
    setRecommendedPriceEditMap(resetRecommendedMap)
    setRecommendedPriceDraftMap({})
    setSelectedSegment(null)
    setRunNotice('Reset to Base Scenario applied.')
    setTimeout(() => setRunNotice(''), 2200)
  }, [activeResult])

  const handleDeleteSavedScenario = (id) => {
    const next = savedScenarios.filter((item) => item.id !== id)
    setSavedScenarios(next)
    writeStep3SavedScenarios(next)
  }

  const handleDownloadSavedScenarios = () => {
    if (!savedScenarios.length) {
      setSaveError('No saved scenarios to download.')
      setTimeout(() => setSaveError(''), 2500)
      return
    }
    downloadSavedScenariosWorkbook(savedScenarios)
  }

  const handleResetControls = () => {
    setParams({
      aGm: '40',
      aPrompt: null,
      aDDec: '100',
      aDInc: '100',
      aDNo: '0',
      aCDec: '100',
      aCInc: '100',
      aCNo: '0',
      aPDec: '100',
      aPInc: '100',
      aPNo: '0',
      aMinVol: null,
      aMinRev: null,
      aMinProf: null,
    })
    setBasePriceEditMap({})
    setBasePriceDraftMap({})
    setRecommendedPriceEditMap({})
    setRecommendedPriceDraftMap({})
  }

  const normalizedSavedScenarios = savedScenarios.map((item) => ({
    ...item,
    savedAtLabel: item.savedAtLabel || (item.savedAt ? new Date(item.savedAt).toLocaleString('en-IN') : ''),
  }))

  useEffect(() => {
    if (!savedScenarios.length) {
      setSavedDockOpen(false)
    }
  }, [savedScenarios.length])

  useEffect(() => {
    if (!savedDockOpen) return undefined
    const handleOutsideClick = (event) => {
      if (!savedDockRef.current) return
      if (!savedDockRef.current.contains(event.target)) {
        setSavedDockOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [savedDockOpen])

  const selectedScenarioName =
    displayViewResult?.scenarioSummaries?.find((item) => item.scenarioId === displayViewResult?.selectedScenarioId)
      ?.scenarioName ?? 'Base Plan'
  const isBaseOnlyMode =
    (displayViewResult?.selectedScenarioId ?? activeResult?.selectedScenarioId) === 'base' &&
    (displayViewResult?.scenarioSummaries?.length ?? activeResult?.scenarioSummaries?.length ?? 0) <= 1

  useEffect(() => {
    const rows = displayViewResult?.optimizedProducts ?? []
    if (!rows.length) return
    if (selectedSegment == null) return
    const available = new Set(rows.map((row) => row.segmentKey ?? getSegmentKey(row.baseAsp ?? row.currentAsp)))
    if (!available.has(selectedSegment)) {
      const nextSegment = ['daily', 'core', 'premium'].find((key) => available.has(key)) ?? null
      setSelectedSegment(nextSegment)
    }
  }, [displayViewResult, selectedSegment])

  return (
    <AppLayout>
      <div className="space-y-5">
        {normalizedSavedScenarios.length > 0 && (
          <div ref={savedDockRef} className="fixed right-5 top-20 z-40 flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-2 py-1 shadow backdrop-blur">
              <button
                type="button"
                onClick={() => setSavedDockOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Saved {normalizedSavedScenarios.length}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${savedDockOpen ? 'rotate-180' : ''}`} />
              </button>
              <button
                type="button"
                onClick={handleDownloadSavedScenarios}
                className="inline-flex items-center gap-1 rounded-full bg-[#2563EB] px-3 py-1 text-xs font-semibold text-white hover:brightness-95"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>

            {savedDockOpen && (
              <div className="w-[360px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Saved Scenarios</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {normalizedSavedScenarios.length}
                  </span>
                </div>
                <div className="max-h-[320px] space-y-1 overflow-auto p-2">
                  {normalizedSavedScenarios.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate text-[11px] font-semibold text-slate-700">{item.name}</p>
                        <p className="text-[10px] text-slate-500">{item.savedAtLabel}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedScenario(item.id)}
                        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
                        title="Delete saved scenario"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="panel overflow-hidden">
          <button
            type="button"
            onClick={() => setGenerationCollapsed((prev) => !prev)}
            className="flex w-full items-center justify-between border-b border-slate-200 px-4 py-3 text-left"
          >
            <div>
              <h3 className="text-lg font-bold text-slate-800">Simulate pricing scenarios with TrinityAI</h3>
            </div>
            {generationCollapsed ? <ChevronRight className="h-4 w-4 text-slate-600" /> : <ChevronDown className="h-4 w-4 text-slate-600" />}
          </button>

          {!generationCollapsed ? (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    What is the business outcome you want to achieve?
                  </label>
                  <textarea
                    value={controls.prompt}
                    onChange={(event) => applyControlPatch({ prompt: event.target.value })}
                    rows={4}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="I want to maximize my revenue..."
                  />
                </div>
              </div>

              <AspInputGuardrailsPanel
                controls={controls}
                onControlsChange={applyControlPatch}
                products={monthProducts}
                productConstraints={productConstraints}
                onProductConstraintChange={handleProductConstraintChange}
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => runOptimization(true)}
                  disabled={isRunningOptimization}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunningOptimization ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {isRunningOptimization ? 'Running...' : 'Run'}
                </button>
                <button
                  type="button"
                  onClick={handleResetControls}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              </div>

              {isRunningOptimization && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                    {jobProgress?.stage || 'Running optimization'}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-[#2563EB] transition-all duration-300"
                      style={{ width: `${Math.max(5, Math.min(100, Number(jobProgress?.progressPct) || 0))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {hasOptimizationScenariosGenerated && (
          <div className="panel overflow-hidden">
            <div className="border-b border-slate-200">
              <button
                type="button"
                onClick={() => setSelectionCollapsed((prev) => !prev)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Select scenarios for further analysis</h3>
                </div>
                {selectionCollapsed ? <ChevronRight className="h-4 w-4 text-slate-600" /> : <ChevronDown className="h-4 w-4 text-slate-600" />}
              </button>
              {!selectionCollapsed && scenarioPanelHeaderSummary ? (
                <div className="space-y-1.5 px-4 pb-4">
                  <p className="text-sm font-semibold text-slate-800">
                    {scenarioPanelHeaderSummary.generatedCount} scenarios generated!
                  </p>
                  {scenarioPanelHeaderSummary.bestByMetric ? (
                    <p className="text-xs font-medium text-slate-600">
                      Highest Volume: {formatShortPct(scenarioPanelHeaderSummary.bestByMetric.bestVolume.volumePct)} ·
                      Highest Revenue: {formatShortPct(scenarioPanelHeaderSummary.bestByMetric.bestRevenue.revenuePct)} ·
                      Highest Gross Margin:{' '}
                      {formatShortPct(scenarioPanelHeaderSummary.bestByMetric.bestGrossMargin.grossMarginPct)}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-rose-700">No scenarios match current filters.</p>
                  )}
                </div>
              ) : null}
            </div>

            {!selectionCollapsed ? (
              <div className="space-y-4 p-4">
                {selectionResult ? (
                  <OptimizationSummaryCards
                    result={selectionResult}
                    onSelectScenario={handleScenarioPickRequest}
                    scenarioFilters={{
                      minVolumeUpliftPct: controls.minVolumeUpliftPct,
                      minRevenueUpliftPct: controls.minRevenueUpliftPct,
                      minProfitUpliftPct: controls.minProfitUpliftPct,
                    }}
                  />
                ) : null}
                <AspScenarioFiltersPanel
                  controls={controls}
                  onControlsChange={applyControlPatch}
                  products={monthProducts}
                  productConstraints={productConstraints}
                  onProductConstraintChange={handleProductConstraintChange}
                  onResetProductConstraints={handleResetProductConstraints}
                />
              </div>
            ) : null}
          </div>
        )}

        {optimizationError && (
          <div className="panel border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm font-medium text-rose-800">{optimizationError}</p>
          </div>
        )}

        {displayViewResult && (
          <>
            <ImpactAndLadderPanel
              rows={displayViewResult.optimizedProducts}
              onOpenLadderModal={() => setIsLadderModalOpen(true)}
              sticky
            />
            <SegmentWorkspacePanel
              rows={displayViewResult.optimizedProducts}
              selectedSegment={selectedSegment}
              onSelectSegment={setSelectedSegment}
              mode={isBaseOnlyMode ? 'base' : 'comparison'}
              baseInputValues={baseInputValues}
              onBaseInputChange={handleBaseDraftChange}
              onBaseCommit={handleBaseCommit}
              recommendedInputValues={recommendedInputValues}
              onRecommendedInputChange={handleRecommendedDraftChange}
              onRecommendedCommit={handleRecommendedCommit}
              onSaveScenario={handleSaveScenario}
              onResetToBaseScenario={handleResetToBaseScenario}
              onResetBasePrices={handleResetBasePrices}
              selectedScenarioName={selectedScenarioName}
            />
          </>
        )}
        {isLadderModalOpen && displayViewResult && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4"
            onClick={() => setIsLadderModalOpen(false)}
          >
            <div
              className="w-full max-w-[1400px] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-lg font-bold text-slate-800">Full Brand Ladder</h4>
                <button
                  type="button"
                  onClick={() => setIsLadderModalOpen(false)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
              <LadderComparisonChart rows={displayViewResult.optimizedProducts} />
            </div>
          </div>
        )}
        {saveNotice && (
          <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 shadow">
            <p className="text-xs font-semibold text-emerald-700">{saveNotice}</p>
          </div>
        )}
        {runNotice && (
          <div className="fixed bottom-16 right-5 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 shadow">
            <p className="text-xs font-semibold text-emerald-700">{runNotice}</p>
          </div>
        )}
        {saveError && (
          <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 shadow">
            <p className="text-xs font-semibold text-rose-700">{saveError}</p>
          </div>
        )}
        {optimizationError && (
          <div className="fixed bottom-28 right-5 z-50 max-w-[440px] rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 shadow">
            <p className="text-xs font-semibold text-rose-700">{optimizationError}</p>
          </div>
        )}
        {scenarioConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4">
            <div className="flex max-h-[92vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
              <h4 className="text-lg font-bold text-slate-800">Apply Scenario</h4>
              <p className="mt-1 text-sm font-medium text-slate-600">{scenarioConfirm.scenarioName}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Volume</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">
                    {(scenarioConfirm.volumeLiftPct * 100 >= 0 ? '+' : '') + (scenarioConfirm.volumeLiftPct * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">
                    {(scenarioConfirm.revenueLiftPct * 100 >= 0 ? '+' : '') + (scenarioConfirm.revenueLiftPct * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gross Margin</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">
                    {(scenarioConfirm.profitLiftPct * 100 >= 0 ? '+' : '') + (scenarioConfirm.profitLiftPct * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
              <div className="mt-4 min-h-0 flex-1 overflow-auto">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Segment Ladder Dynamics</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    {groupScenarioRowsBySegment(scenarioConfirm.priceRows ?? []).map((segment) => (
                      <div key={segment.segmentKey} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-bold text-slate-800">{segment.segmentLabel}</p>
                          <span className="rounded bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {segment.rows.length} products
                          </span>
                        </div>
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="grid grid-cols-[minmax(140px,1fr)_78px_20px_86px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            <p>Product</p>
                            <p className="text-right">Base</p>
                            <p className="text-center">&nbsp;</p>
                            <p className="text-right">Rec.</p>
                          </div>
                          <div className="max-h-[360px] overflow-auto">
                            {segment.rows.length ? (
                              segment.rows.map((row) => {
                                const base = Number(row.basePrice ?? 0)
                                const rec = Number(row.recommendedPrice ?? 0)
                                const delta = rec - base
                                const isChanged = Math.abs(delta) > 0.0001
                                const isIncrease = isChanged && delta > 0
                                const isDecrease = isChanged && delta < 0

                                const highlightBg = isIncrease
                                  ? 'bg-emerald-100 border-l-4 border-emerald-500'
                                  : isDecrease
                                    ? 'bg-rose-100 border-l-4 border-rose-500'
                                    : ''
                                const baseText = isIncrease
                                  ? 'text-emerald-800 font-extrabold'
                                  : isDecrease
                                    ? 'text-rose-800 font-extrabold'
                                    : 'text-slate-700'
                                const recText = isIncrease
                                  ? 'text-emerald-950 font-extrabold'
                                  : isDecrease
                                    ? 'text-rose-950 font-extrabold'
                                    : 'text-slate-900'
                                const arrowText = isIncrease ? 'text-emerald-700 font-extrabold' : isDecrease ? 'text-rose-700 font-extrabold' : ''

                                return (
                                  <div
                                    key={`${scenarioConfirm.scenarioId}_${segment.segmentKey}_${row.productName}`}
                                    className={`grid grid-cols-[minmax(140px,1fr)_78px_20px_86px] items-start gap-2 border-b border-slate-100 px-2 py-1.5 last:border-b-0 ${highlightBg}`}
                                  >
                                    <p
                                      className="whitespace-normal break-words text-[11px] font-semibold leading-4 text-slate-800"
                                      title={normalizeProductLabel(row.productName)}
                                    >
                                      {normalizeProductLabel(row.productName)}
                                    </p>
                                    <p className={`text-right text-[11px] font-semibold ${baseText}`}>{formatInr(base)}</p>
                                    <p className={`text-center text-[11px] font-bold text-slate-500 ${arrowText}`}>-&gt;</p>
                                    <p className={`text-right text-[11px] font-semibold ${recText}`}>{formatInr(rec)}</p>
                                  </div>
                                )
                              })
                            ) : (
                              <div className="px-2 py-3 text-center text-[11px] text-slate-500">
                                No products in this segment.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setScenarioConfirm(null)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleScenarioConfirmContinue}
                  className="rounded-md bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:brightness-95"
                >
                  Select and Analyze
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default AspDeterminationPage
