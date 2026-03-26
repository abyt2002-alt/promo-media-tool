import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Loader2, Play, RotateCcw, Save, ChevronDown, Trash2, Sparkles } from 'lucide-react'
import * as XLSX from 'xlsx'
import AppLayout from '../components/layout/AppLayout'
import { recalculatePromoCalendar, runPromoCalendarJob } from '../services/promoCalendarApi'

const PAGE_SIZE = 5
const PROMO_LEVEL_OPTIONS = [0, 10, 20, 30, 40]
const PROMO_PAGE_CACHE_KEY = 'promo_calendar_page_state_v2'
const PROMO_SAVED_CALENDARS_KEY = 'promo_saved_calendars_v1'
const PROMO_SAVED_CALENDARS_MAX = 80
let PROMO_PAGE_MEMORY_CACHE = null

const formatPct = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
const formatInr = (value) => `INR ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))}`
const formatInt = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))
const renderBarLabel = (props) => {
  const { x, y, width, height, value } = props
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null
  const labelX = Number(x) + Number(width) / 2
  const isNegative = numericValue < 0
  const labelY = isNegative ? Number(y) + Number(height) + 14 : Number(y) - 8
  return (
    <text
      x={labelX}
      y={labelY}
      fill="#0F172A"
      fontSize={11}
      fontWeight={800}
      textAnchor="middle"
    >
      {formatPct(numericValue)}
    </text>
  )
}
const resolveErrorMessage = (errorValue) => {
  if (!errorValue) return 'Failed to run promo optimization.'
  if (typeof errorValue === 'string') return errorValue
  if (typeof errorValue?.message === 'string') return errorValue.message
  try {
    return JSON.stringify(errorValue)
  } catch {
    return 'Failed to run promo optimization.'
  }
}

const downloadFile = (content, fileName, mimeType = 'text/csv;charset=utf-8;') => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

const buildCalendarRows = (entry) => {
  const rows = []
  rows.push(['Saved At', String(entry.savedAt ?? '')])
  rows.push(['Scenario', String(entry.scenarioName ?? '')])
  rows.push(['Scenario ID', String(entry.scenarioId ?? '')])
  rows.push(['Selected Month', String(entry.selectedMonth ?? '')])
  rows.push(['Edited', entry.edited ? 'Yes' : 'No'])
  rows.push([])
  rows.push(['Totals'])
  rows.push(['Metric', 'Base', 'Selected', 'Change %'])
  const safePct = (next, base) => {
    const b = Number(base) || 0
    if (Math.abs(b) <= 1e-9) return 0
    return ((Number(next) - b) / b) * 100
  }
  rows.push([
    'Volume',
    Number(entry.baseTotals?.total_volume ?? 0).toFixed(3),
    Number(entry.selectedTotals?.total_volume ?? 0).toFixed(3),
    safePct(entry.selectedTotals?.total_volume ?? 0, entry.baseTotals?.total_volume ?? 0).toFixed(3),
  ])
  rows.push([
    'Revenue',
    Number(entry.baseTotals?.total_revenue ?? 0).toFixed(3),
    Number(entry.selectedTotals?.total_revenue ?? 0).toFixed(3),
    safePct(entry.selectedTotals?.total_revenue ?? 0, entry.baseTotals?.total_revenue ?? 0).toFixed(3),
  ])
  rows.push([
    'Gross Margin',
    Number(entry.baseTotals?.total_profit ?? 0).toFixed(3),
    Number(entry.selectedTotals?.total_profit ?? 0).toFixed(3),
    safePct(entry.selectedTotals?.total_profit ?? 0, entry.baseTotals?.total_profit ?? 0).toFixed(3),
  ])
  rows.push([])
  rows.push(['Weekly Discount Calendar'])
  const weeks = Array.from({ length: 27 }).map((_, idx) => `W${idx + 1}`)
  rows.push(['Price Point Group', ...weeks])
  ;(entry.groupCalendars ?? []).forEach((group) => {
    const discounts = Array.from({ length: 27 }).map((_, idx) => Number(group?.weekly_discounts?.[idx] ?? 0))
    rows.push([String(group.group_name ?? ''), ...discounts.map((d) => d.toFixed(0))])
  })
  rows.push([])
  rows.push(['Product Impact'])
  rows.push(['Product', 'Base Price', 'Current Volume', 'New Volume', 'Volume Change %', 'Current Revenue', 'New Revenue', 'Revenue Change %', 'Current Gross Margin', 'New Gross Margin', 'Gross Margin Change %'])
  ;(entry.productImpacts ?? []).forEach((row) => {
    rows.push([
      String(row.product_name ?? ''),
      Number(row.base_price ?? 0).toFixed(3),
      Number(row.current_volume ?? 0).toFixed(3),
      Number(row.new_volume ?? 0).toFixed(3),
      (Number(row.volume_change_pct ?? 0) * 100).toFixed(3),
      Number(row.current_revenue ?? 0).toFixed(3),
      Number(row.new_revenue ?? 0).toFixed(3),
      (Number(row.revenue_change_pct ?? 0) * 100).toFixed(3),
      Number(row.current_profit ?? 0).toFixed(3),
      Number(row.new_profit ?? 0).toFixed(3),
      (Number(row.profit_change_pct ?? 0) * 100).toFixed(3),
    ])
  })
  return rows
}

const buildCalendarCsv = (entry) => {
  const rows = buildCalendarRows(entry)
  return rows.map((row) => row.map((cell) => escapeCsv(cell)).join(',')).join('\n')
}

const toSheetName = (value, fallback) => {
  const raw = String(value || fallback || 'Scenario')
  const cleaned = raw.replace(/[:\\/?*\[\]]/g, ' ').trim() || fallback
  return cleaned.slice(0, 31)
}

const downloadCsv = (rows) => {
  const header = [
    'Scenario ID',
    'Scenario Name',
    'Scenario Family',
    'Rank',
    'Volume Uplift %',
    'Revenue Uplift %',
    'Gross Margin Uplift %',
    'Total Volume',
    'Total Revenue',
    'Total Gross Margin',
  ]
  const lines = [header.join(',')]
  rows.forEach((row) => {
    lines.push(
      [
        row.scenario_id,
        `"${String(row.scenario_name ?? '').replaceAll('"', '""')}"`,
        `"${String(row.scenario_family ?? '').replaceAll('"', '""')}"`,
        row.rank,
        (Number(row.volume_uplift_pct) * 100).toFixed(4),
        (Number(row.revenue_uplift_pct) * 100).toFixed(4),
        (Number(row.profit_uplift_pct) * 100).toFixed(4),
        Number(row.total_volume).toFixed(3),
        Number(row.total_revenue).toFixed(3),
        Number(row.total_profit).toFixed(3),
      ].join(','),
    )
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `promo_calendar_scenarios_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

const getPromoLevelPillClass = (level, weekIndex) => {
  const value = Number(level) || 0
  if (value === 0) {
    return 'border-slate-200 bg-slate-100 text-slate-500'
  }
  if (value === 10) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 20) return 'border-sky-200 bg-sky-50 text-sky-700'
  if (value === 30) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

const nextPromoLevel = (currentLevel, reverse = false) => {
  const idx = PROMO_LEVEL_OPTIONS.findIndex((value) => value === Number(currentLevel))
  const safeIdx = idx >= 0 ? idx : 0
  const nextIdx = reverse
    ? (safeIdx - 1 + PROMO_LEVEL_OPTIONS.length) % PROMO_LEVEL_OPTIONS.length
    : (safeIdx + 1) % PROMO_LEVEL_OPTIONS.length
  return PROMO_LEVEL_OPTIONS[nextIdx]
}

const cloneGroupCalendars = (groups = []) =>
  groups.map((group) => ({ ...group, weekly_discounts: [...(group.weekly_discounts ?? [])] }))

const zeroTotals = {
  total_volume: 0,
  total_revenue: 0,
  total_profit: 0,
}

const getSegmentMetaByBasePrice = (basePriceValue) => {
  const basePrice = Number(basePriceValue) || 0
  if (basePrice <= 599) {
    return {
      label: 'Daily Casual',
      badgeClass: 'border-blue-200 bg-blue-50 text-blue-700',
    }
  }
  if (basePrice <= 899) {
    return {
      label: 'Core Plus',
      badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
    }
  }
  return {
    label: 'Premium',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
}

const PromoCalendarPage = ({ layoutProps = {} }) => {
  const basePriceOverrides = []
  const hasHydratedCacheRef = useRef(false)
  const skipResetFromCacheRef = useRef(false)
  const cachedScenarioIdRef = useRef(null)
  const [isCacheHydrated, setIsCacheHydrated] = useState(false)

  const [controls, setControls] = useState({
    selectedMonth: null,
    prompt: '',
    minGrossMarginPct: 40,
    minPromoWeeks: 4,
    maxPromoWeeks: 12,
    scenarioCount: 1500,
    minVolumeUpliftPct: '',
    minRevenueUpliftPct: '',
    maxProfitDecreasePct: '',
  })
  const [result, setResult] = useState(null)
  const [selectedScenarioId, setSelectedScenarioId] = useState(null)
  const [sortBy, setSortBy] = useState('revenue')
  const [page, setPage] = useState(0)
  const [showAllScenarios, setShowAllScenarios] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState({ progress_pct: 0, stage: '' })
  const [error, setError] = useState('')
  const [simulateCollapsed, setSimulateCollapsed] = useState(true)
  const [selectionCollapsed, setSelectionCollapsed] = useState(false)
  const [editedGroupCalendars, setEditedGroupCalendars] = useState([])
  const [manualRecalc, setManualRecalc] = useState(null)
  const [defaultBaseGroupCalendars, setDefaultBaseGroupCalendars] = useState([])
  const [defaultGroupCalendars, setDefaultGroupCalendars] = useState([])
  const [defaultBaseTotals, setDefaultBaseTotals] = useState(null)
  const [defaultBaseProductImpacts, setDefaultBaseProductImpacts] = useState([])
  const [defaultRecalc, setDefaultRecalc] = useState(null)
  const [defaultHasEdits, setDefaultHasEdits] = useState(false)
  const [defaultInitError, setDefaultInitError] = useState('')
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [manualEditError, setManualEditError] = useState('')
  const [promoApplyTarget, setPromoApplyTarget] = useState('ALL')
  const [promoApplyWeekFrom, setPromoApplyWeekFrom] = useState(16)
  const [promoApplyWeekTo, setPromoApplyWeekTo] = useState(27)
  const [promoApplyLevel, setPromoApplyLevel] = useState(10)
  const [savedCalendars, setSavedCalendars] = useState([])
  const [showSavedMenu, setShowSavedMenu] = useState(false)
  const [saveToast, setSaveToast] = useState('')
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [saveDialogName, setSaveDialogName] = useState('')
  const [scenarioPreviewId, setScenarioPreviewId] = useState(null)
  const savedMenuRef = useRef(null)
  const recalcDebounceRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      let parsed = null
      if (PROMO_PAGE_MEMORY_CACHE && typeof PROMO_PAGE_MEMORY_CACHE === 'object') {
        parsed = PROMO_PAGE_MEMORY_CACHE
      } else {
        const raw = localStorage.getItem(PROMO_PAGE_CACHE_KEY) ?? sessionStorage.getItem(PROMO_PAGE_CACHE_KEY)
        if (raw) {
          parsed = JSON.parse(raw)
        }
      }
      if (!parsed) {
        hasHydratedCacheRef.current = true
        setIsCacheHydrated(true)
        return
      }
      if (!parsed || typeof parsed !== 'object') {
        hasHydratedCacheRef.current = true
        setIsCacheHydrated(true)
        return
      }
      if (parsed.controls && typeof parsed.controls === 'object') {
        setControls((prev) => ({ ...prev, ...parsed.controls }))
      }
      if (parsed.result && typeof parsed.result === 'object') {
        setResult(parsed.result)
      }
      if (typeof parsed.selectedScenarioId === 'string') {
        setSelectedScenarioId(parsed.selectedScenarioId)
        cachedScenarioIdRef.current = parsed.selectedScenarioId
      }
      if (parsed.sortBy === 'revenue' || parsed.sortBy === 'profit' || parsed.sortBy === 'volume') {
        setSortBy(parsed.sortBy)
      }
      if (Number.isFinite(parsed.page) && parsed.page >= 0) {
        setPage(parsed.page)
      }
      if (typeof parsed.showAllScenarios === 'boolean') {
        setShowAllScenarios(parsed.showAllScenarios)
      }
      if (typeof parsed.promoApplyTarget === 'string') {
        setPromoApplyTarget(parsed.promoApplyTarget)
      }
      if (Number.isFinite(parsed.promoApplyWeekFrom)) {
        setPromoApplyWeekFrom(parsed.promoApplyWeekFrom)
      }
      if (Number.isFinite(parsed.promoApplyWeekTo)) {
        setPromoApplyWeekTo(parsed.promoApplyWeekTo)
      }
      if (Number.isFinite(parsed.promoApplyLevel)) {
        setPromoApplyLevel(parsed.promoApplyLevel)
      }
      if (Array.isArray(parsed.editedGroupCalendars)) {
        setEditedGroupCalendars(parsed.editedGroupCalendars)
      }
      if (parsed.manualRecalc && typeof parsed.manualRecalc === 'object') {
        setManualRecalc(parsed.manualRecalc)
      }
      if ((Array.isArray(parsed.editedGroupCalendars) && parsed.editedGroupCalendars.length > 0) || parsed.manualRecalc) {
        skipResetFromCacheRef.current = true
      }
    } catch {
      // ignore invalid cache
    } finally {
      hasHydratedCacheRef.current = true
      setIsCacheHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(PROMO_SAVED_CALENDARS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setSavedCalendars(parsed)
      }
    } catch {
      // ignore bad saved calendar cache
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(PROMO_SAVED_CALENDARS_KEY, JSON.stringify(savedCalendars))
    } catch {
      // ignore quota
    }
  }, [savedCalendars])

  useEffect(() => {
    if (!saveToast) return
    const timer = setTimeout(() => setSaveToast(''), 2200)
    return () => clearTimeout(timer)
  }, [saveToast])

  useEffect(() => {
    if (result) return
    if (defaultBaseGroupCalendars.length > 0) return
    let cancelled = false

    const initializeDefaultCalendar = async () => {
      setDefaultInitError('')
      try {
        const response = await recalculatePromoCalendar({
          selected_month: controls.selectedMonth,
          base_price_overrides: basePriceOverrides,
          min_promo_weeks: Number(controls.minPromoWeeks),
          max_promo_weeks: Number(controls.maxPromoWeeks),
          group_calendars: [],
        })
        if (cancelled) return
        const baseGroups = cloneGroupCalendars(response?.group_calendars ?? [])
        setDefaultBaseGroupCalendars(baseGroups)
        setDefaultGroupCalendars(cloneGroupCalendars(baseGroups))
        setDefaultBaseTotals(response?.totals ?? zeroTotals)
        setDefaultBaseProductImpacts(response?.product_impacts ?? [])
        setDefaultRecalc(null)
        setDefaultHasEdits(false)
      } catch (initError) {
        if (cancelled) return
        setDefaultInitError(resolveErrorMessage(initError))
      }
    }

    initializeDefaultCalendar()
    return () => {
      cancelled = true
    }
  }, [controls.maxPromoWeeks, controls.minPromoWeeks, controls.selectedMonth, defaultBaseGroupCalendars.length, result])

  useEffect(() => {
    const onClick = (event) => {
      if (!savedMenuRef.current) return
      if (!savedMenuRef.current.contains(event.target)) {
        setShowSavedMenu(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!hasHydratedCacheRef.current || !isCacheHydrated) return
    try {
      const payload = {
        controls,
        result,
        selectedScenarioId,
        sortBy,
        page,
        showAllScenarios,
        promoApplyTarget,
        promoApplyWeekFrom,
        promoApplyWeekTo,
        promoApplyLevel,
        editedGroupCalendars,
        manualRecalc,
      }
      PROMO_PAGE_MEMORY_CACHE = payload
      try {
        localStorage.setItem(PROMO_PAGE_CACHE_KEY, JSON.stringify(payload))
        sessionStorage.setItem(PROMO_PAGE_CACHE_KEY, JSON.stringify(payload))
      } catch {
        const litePayload = {
          ...payload,
          result: null,
          editedGroupCalendars: [],
          manualRecalc: null,
        }
        localStorage.setItem(PROMO_PAGE_CACHE_KEY, JSON.stringify(litePayload))
        sessionStorage.setItem(PROMO_PAGE_CACHE_KEY, JSON.stringify(litePayload))
      }
    } catch {
      // ignore quota or serialization failures
    }
  }, [
    controls,
    isCacheHydrated,
    page,
    promoApplyLevel,
    promoApplyTarget,
    promoApplyWeekFrom,
    promoApplyWeekTo,
    result,
    selectedScenarioId,
    showAllScenarios,
    sortBy,
    editedGroupCalendars,
    manualRecalc,
  ])

  const runOptimization = async () => {
    setIsRunning(true)
    setError('')
    try {
      const payload = {
        selected_month: controls.selectedMonth,
        base_price_overrides: basePriceOverrides,
        prompt: String(controls.prompt ?? '').trim() || null,
        min_gross_margin_pct: Number(controls.minGrossMarginPct),
        min_promo_weeks: Number(controls.minPromoWeeks),
        max_promo_weeks: Number(controls.maxPromoWeeks),
        scenario_count: Number(controls.scenarioCount),
        scenario_filters: {
          ...(controls.minVolumeUpliftPct === '' ? {} : { min_volume_uplift_pct: Number(controls.minVolumeUpliftPct) }),
          ...(controls.minRevenueUpliftPct === '' ? {} : { min_revenue_uplift_pct: Number(controls.minRevenueUpliftPct) }),
          ...(controls.maxProfitDecreasePct === '' ? {} : { min_profit_uplift_pct: -Math.abs(Number(controls.maxProfitDecreasePct)) }),
        },
      }
      const nextResult = await runPromoCalendarJob(payload, {
        onProgress: (nextProgress) => setProgress(nextProgress),
      })
      setResult(nextResult)
      setSelectedScenarioId(null)
      setShowAllScenarios(false)
      setPage(0)
    } catch (runError) {
      setError(resolveErrorMessage(runError))
    } finally {
      setIsRunning(false)
    }
  }

  const summaries = result?.scenario_summaries ?? []
  const filtersApplied =
    controls.minVolumeUpliftPct !== '' || controls.minRevenueUpliftPct !== '' || controls.maxProfitDecreasePct !== ''

  const filteredSummaries = useMemo(() => {
    const minV = controls.minVolumeUpliftPct === '' ? null : Number(controls.minVolumeUpliftPct)
    const minR = controls.minRevenueUpliftPct === '' ? null : Number(controls.minRevenueUpliftPct)
    const maxProfitDecrease = controls.maxProfitDecreasePct === '' ? null : Math.abs(Number(controls.maxProfitDecreasePct))
    const rows = summaries.filter((row) => {
      const v = Number(row.volume_uplift_pct) * 100
      const r = Number(row.revenue_uplift_pct) * 100
      const p = Number(row.profit_uplift_pct) * 100
      return (minV == null || v >= minV) && (minR == null || r >= minR) && (maxProfitDecrease == null || p >= -maxProfitDecrease)
    })
    rows.sort((a, b) => {
      if (sortBy === 'volume') return Number(b.volume_uplift_pct) - Number(a.volume_uplift_pct)
      if (sortBy === 'profit') return Number(b.profit_uplift_pct) - Number(a.profit_uplift_pct)
      return Number(b.revenue_uplift_pct) - Number(a.revenue_uplift_pct)
    })
    return rows
  }, [controls.maxProfitDecreasePct, controls.minRevenueUpliftPct, controls.minVolumeUpliftPct, sortBy, summaries])

  const anchorIds = useMemo(() => {
    if (!result?.best_markers) return []
    return [
      result.best_markers.best_volume_scenario_id,
      result.best_markers.best_revenue_scenario_id,
      result.best_markers.best_profit_scenario_id,
    ].filter(Boolean)
  }, [result])

  const bestVolumeScenario = result?.best_markers?.best_volume_scenario_id
    ? summaries.find((row) => row.scenario_id === result.best_markers.best_volume_scenario_id) ?? null
    : null
  const bestRevenueScenario = result?.best_markers?.best_revenue_scenario_id
    ? summaries.find((row) => row.scenario_id === result.best_markers.best_revenue_scenario_id) ?? null
    : null
  const bestProfitScenario = result?.best_markers?.best_profit_scenario_id
    ? summaries.find((row) => row.scenario_id === result.best_markers.best_profit_scenario_id) ?? null
    : null

  const displaySummaries = useMemo(() => {
    if (!result) return []
    if (filtersApplied || showAllScenarios) return filteredSummaries
    const orderedAnchors = []
    const seen = new Set()
    anchorIds.forEach((id) => {
      const row = summaries.find((item) => item.scenario_id === id)
      if (!row || seen.has(row.scenario_id)) return
      seen.add(row.scenario_id)
      orderedAnchors.push(row)
    })
    if (orderedAnchors.length >= 3) return orderedAnchors.slice(0, 3)
    for (const row of summaries) {
      if (seen.has(row.scenario_id)) continue
      seen.add(row.scenario_id)
      orderedAnchors.push(row)
      if (orderedAnchors.length >= 3) break
    }
    return orderedAnchors.length ? orderedAnchors : summaries.slice(0, 3)
  }, [anchorIds, filteredSummaries, filtersApplied, result, showAllScenarios, summaries])

  const pagedSummaries = useMemo(() => {
    const start = page * PAGE_SIZE
    return displaySummaries.slice(start, start + PAGE_SIZE)
  }, [displaySummaries, page])

  const pageCount = Math.max(1, Math.ceil(displaySummaries.length / PAGE_SIZE))
  const selectedId = selectedScenarioId ?? null
  const selectedSummary = selectedId
    ? (summaries.find((row) => row.scenario_id === selectedId) ?? null)
    : null
  const selectedDetail = selectedSummary ? result?.scenario_details?.[selectedSummary.scenario_id] : null
  const previewSummary = scenarioPreviewId
    ? (summaries.find((row) => row.scenario_id === scenarioPreviewId) ?? null)
    : null
  const previewDetail = previewSummary ? result?.scenario_details?.[previewSummary.scenario_id] : null
  const inScenarioMode = Boolean(result && selectedSummary)
  const hasUnsavedEdits = Boolean(defaultHasEdits || manualRecalc)

  const activeGroupCalendars = inScenarioMode
    ? (editedGroupCalendars.length ? editedGroupCalendars : (selectedDetail?.group_calendars ?? []))
    : defaultGroupCalendars
  const activeProductImpacts = inScenarioMode
    ? (manualRecalc?.product_impacts ?? selectedDetail?.product_impacts ?? [])
    : (defaultRecalc?.product_impacts ?? defaultBaseProductImpacts ?? [])
  const selectedTotals = inScenarioMode
    ? (manualRecalc?.totals ?? selectedDetail?.totals ?? result?.selected_totals ?? zeroTotals)
    : (defaultHasEdits ? (defaultRecalc?.totals ?? zeroTotals) : zeroTotals)
  const baseTotals = inScenarioMode
    ? (manualRecalc?.base_totals ?? result?.base_totals ?? zeroTotals)
    : (defaultHasEdits ? (defaultBaseTotals ?? zeroTotals) : zeroTotals)

  useEffect(() => {
    if (page >= pageCount) {
      setPage(0)
    }
  }, [page, pageCount])

  useEffect(() => {
    if (
      skipResetFromCacheRef.current &&
      cachedScenarioIdRef.current &&
      selectedSummary?.scenario_id === cachedScenarioIdRef.current
    ) {
      skipResetFromCacheRef.current = false
      return
    }
    const baseCalendars = selectedDetail?.group_calendars ?? []
    setEditedGroupCalendars(baseCalendars.map((group) => ({ ...group, weekly_discounts: [...(group.weekly_discounts ?? [])] })))
    setManualRecalc(null)
    setManualEditError('')
    setPromoApplyTarget('ALL')
    setPromoApplyWeekFrom(16)
    setPromoApplyWeekTo(27)
    setPromoApplyLevel(10)
  }, [selectedSummary?.scenario_id, result])

  useEffect(() => () => {
    if (recalcDebounceRef.current) {
      clearTimeout(recalcDebounceRef.current)
      recalcDebounceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!scenarioPreviewId) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setScenarioPreviewId(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [scenarioPreviewId])

  useEffect(() => {
    if (!inScenarioMode) return
    if (!defaultHasEdits) return
    setDefaultGroupCalendars(cloneGroupCalendars(defaultBaseGroupCalendars))
    setDefaultRecalc(null)
    setDefaultHasEdits(false)
    setDefaultInitError('')
  }, [defaultBaseGroupCalendars, defaultHasEdits, inScenarioMode])

  const recomputeManualCalendar = async (nextCalendars) => {
    setIsRecalculating(true)
    setManualEditError('')
    setDefaultInitError('')
    try {
      const payload = {
        selected_month: inScenarioMode ? (result?.selected_month ?? controls.selectedMonth) : controls.selectedMonth,
        base_price_overrides: basePriceOverrides,
        min_promo_weeks: Number(controls.minPromoWeeks),
        max_promo_weeks: Number(controls.maxPromoWeeks),
        group_calendars: nextCalendars.map((group) => ({
          group_id: group.group_id,
          weekly_discounts: group.weekly_discounts,
        })),
      }
      const recalculated = await recalculatePromoCalendar(payload)
      if (inScenarioMode) {
        setManualRecalc(recalculated)
      } else {
        setDefaultRecalc(recalculated)
        setDefaultHasEdits(true)
      }
    } catch (recalcError) {
      setManualEditError(resolveErrorMessage(recalcError))
    } finally {
      setIsRecalculating(false)
    }
  }

  const queueRecomputeManualCalendar = (nextCalendars) => {
    if (recalcDebounceRef.current) {
      clearTimeout(recalcDebounceRef.current)
      recalcDebounceRef.current = null
    }
    recalcDebounceRef.current = setTimeout(() => {
      recomputeManualCalendar(nextCalendars)
      recalcDebounceRef.current = null
    }, 220)
  }

  const handlePromoWeekChange = (groupId, weekIndex, nextLevel) => {
    const level = Number(nextLevel)
    if (!Number.isFinite(level)) return

    const source = activeGroupCalendars.length
      ? activeGroupCalendars
      : (selectedDetail?.group_calendars ?? [])
    const nextCalendars = source.map((group) => {
      if (group.group_id !== groupId) return group
      const nextWeekly = [...(group.weekly_discounts ?? [])]
      nextWeekly[weekIndex] = level
      return { ...group, weekly_discounts: nextWeekly }
    })
    if (inScenarioMode) {
      setEditedGroupCalendars(nextCalendars)
    } else {
      setDefaultGroupCalendars(nextCalendars)
    }
    queueRecomputeManualCalendar(nextCalendars)
  }

  const handlePromoCellClick = (groupId, weekIndex, currentLevel, event) => {
    if (isRecalculating) return
    let nextLevel = 0
    if (event?.altKey || event?.metaKey) {
      nextLevel = 0
    } else if (event?.shiftKey) {
      nextLevel = nextPromoLevel(currentLevel, true)
    } else {
      nextLevel = nextPromoLevel(currentLevel, false)
    }
    handlePromoWeekChange(groupId, weekIndex, nextLevel)
  }

  const resetCalendarEdits = () => {
    if (inScenarioMode) {
      const baseCalendars = selectedDetail?.group_calendars ?? []
      const copied = cloneGroupCalendars(baseCalendars)
      setEditedGroupCalendars(copied)
      setManualRecalc(null)
    } else {
      const copied = cloneGroupCalendars(defaultBaseGroupCalendars)
      setDefaultGroupCalendars(copied)
      setDefaultRecalc(null)
      setDefaultHasEdits(false)
    }
    setManualEditError('')
  }

  const openScenarioPreview = (scenarioId) => {
    if (!scenarioId) return
    setScenarioPreviewId(scenarioId)
  }

  const selectScenarioFromPreview = () => {
    if (!previewSummary?.scenario_id) return
    if (hasUnsavedEdits) {
      const shouldDiscard = window.confirm(
        'You have unsaved calendar edits. Selecting this scenario will discard them. Continue?',
      )
      if (!shouldDiscard) return
    }
    setSelectedScenarioId(previewSummary.scenario_id)
    setScenarioPreviewId(null)
  }

  const applyPromoApplier = async () => {
    const source = activeGroupCalendars.length ? activeGroupCalendars : (selectedDetail?.group_calendars ?? [])
    if (!source.length) return

    const from = Math.max(1, Math.min(27, Number(promoApplyWeekFrom) || 1))
    const to = Math.max(1, Math.min(27, Number(promoApplyWeekTo) || 1))
    const start = Math.min(from, to) - 1
    const end = Math.max(from, to) - 1
    const level = Number(promoApplyLevel)

    const nextCalendars = source.map((group) => {
      if (promoApplyTarget !== 'ALL' && promoApplyTarget !== group.group_id) {
        return group
      }
      const nextWeekly = [...(group.weekly_discounts ?? [])]
      for (let idx = start; idx <= end; idx += 1) {
        nextWeekly[idx] = level
      }
      return { ...group, weekly_discounts: nextWeekly }
    })

    if (inScenarioMode) {
      setEditedGroupCalendars(nextCalendars)
    } else {
      setDefaultGroupCalendars(nextCalendars)
    }
    await recomputeManualCalendar(nextCalendars)
  }

  const calcPct = (nextValue, baseValue, useAbsBase = false) => {
    const safeBase = useAbsBase ? Math.max(1e-6, Math.abs(Number(baseValue) || 0)) : Math.max(1e-6, Number(baseValue) || 0)
    return ((Number(nextValue) || 0) - (Number(baseValue) || 0)) / safeBase * 100
  }
  const buildImpactCards = (baseTotalsInput, selectedTotalsInput, productImpactsInput) => {
    const grossRevenueFromImpacts = (productImpactsInput ?? []).reduce(
      (acc, row) => {
        const basePrice = Number(row?.base_price) || 0
        const baseVolume = Number(row?.current_volume) || 0
        const nextVolume = Number(row?.new_volume) || 0
        acc.base += basePrice * baseVolume
        acc.next += basePrice * nextVolume
        return acc
      },
      { base: 0, next: 0 },
    )

    const grossRevenueBase = grossRevenueFromImpacts.base > 0 ? grossRevenueFromImpacts.base : Number(baseTotalsInput?.total_revenue ?? 0)
    const grossRevenueNext = grossRevenueFromImpacts.next > 0 ? grossRevenueFromImpacts.next : Number(selectedTotalsInput?.total_revenue ?? 0)
    const netRevenueBase = Number(baseTotalsInput?.total_revenue ?? 0)
    const netRevenueNext = Number(selectedTotalsInput?.total_revenue ?? 0)
    const profitBase = Number(baseTotalsInput?.total_profit ?? 0)
    const profitNext = Number(selectedTotalsInput?.total_profit ?? 0)

    return [
      {
        label: 'Volume',
        pct: calcPct(selectedTotalsInput?.total_volume ?? 0, baseTotalsInput?.total_volume ?? 0, false),
        base: baseTotalsInput?.total_volume ?? 0,
        next: selectedTotalsInput?.total_volume ?? 0,
        money: false,
      },
      {
        label: 'Gross Revenue',
        pct: calcPct(grossRevenueNext, grossRevenueBase, false),
        base: grossRevenueBase,
        next: grossRevenueNext,
        money: true,
      },
      {
        label: 'Net Revenue',
        pct: calcPct(netRevenueNext, netRevenueBase, false),
        base: netRevenueBase,
        next: netRevenueNext,
        money: true,
      },
      {
        label: 'Gross Margin',
        pct: calcPct(profitNext, profitBase, true),
        base: profitBase,
        next: profitNext,
        money: true,
      },
    ]
  }

  const impactCards = buildImpactCards(baseTotals, selectedTotals, activeProductImpacts)
  const previewImpactCards = buildImpactCards(result?.base_totals ?? zeroTotals, previewDetail?.totals ?? zeroTotals, previewDetail?.product_impacts ?? [])

  const saveCurrentCalendar = (calendarName) => {
    if (!inScenarioMode && !defaultGroupCalendars.length) return
    const scenarioId = inScenarioMode ? selectedSummary?.scenario_id : 'default'
    if (!scenarioId) return
    const scenarioLabel = inScenarioMode
      ? `${selectedSummary?.scenario_name ?? 'Scenario'}${manualRecalc ? ' (Edited)' : ''}`
      : `Default Calendar${defaultHasEdits ? ' (Edited)' : ''}`
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      calendarName: calendarName ?? '',
      selectedMonth: (inScenarioMode ? result?.selected_month : controls.selectedMonth) ?? '',
      scenarioId,
      scenarioName: scenarioLabel,
      mode: inScenarioMode ? 'scenario' : 'default',
      edited: inScenarioMode ? Boolean(manualRecalc) : Boolean(defaultHasEdits),
      baseTotals: baseTotals ?? null,
      selectedTotals: selectedTotals ?? null,
      groupCalendars: activeGroupCalendars ?? [],
      productImpacts: activeProductImpacts ?? [],
    }
    setSavedCalendars((prev) => [entry, ...prev].slice(0, PROMO_SAVED_CALENDARS_MAX))
    setSaveToast('Calendar saved')
  }

  const openSaveDialog = () => {
    if (!inScenarioMode && !defaultGroupCalendars.length) return
    const nextIndex = savedCalendars.length + 1
    setSaveDialogName(`Promo calendar ${nextIndex}`)
    setIsSaveDialogOpen(true)
  }

  const downloadSavedCalendarsWorkbook = () => {
    if (!savedCalendars.length) return
    const workbook = XLSX.utils.book_new()
    savedCalendars.forEach((entry, index) => {
      const rows = buildCalendarRows(entry)
      const worksheet = XLSX.utils.aoa_to_sheet(rows)
      const sheetName = toSheetName(entry?.calendarName || entry?.scenarioName, `Scenario ${index + 1}`)
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    })
    const content = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadFile(
      content,
      `promo_calendar_saved_scenarios_${new Date().toISOString().slice(0, 10)}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  }

  const loadSavedCalendar = (entry) => {
    if (!entry) return
    const isDefaultEntry = entry.mode === 'default' || entry.scenarioId === 'default'
    if (isDefaultEntry) {
      const groups = cloneGroupCalendars(entry.groupCalendars ?? [])
      setDefaultBaseGroupCalendars(groups)
      setDefaultGroupCalendars(groups)
      setDefaultBaseTotals(entry.baseTotals ?? zeroTotals)
      setDefaultBaseProductImpacts(entry.productImpacts ?? [])
      setDefaultRecalc({
        totals: entry.selectedTotals ?? zeroTotals,
        product_impacts: entry.productImpacts ?? [],
      })
      setDefaultHasEdits(true)
      setSelectedScenarioId(null)
      setEditedGroupCalendars([])
      setManualRecalc(null)
      setManualEditError('')
      setError('')
      setShowSavedMenu(false)
      return
    }
    if (!result) return
    const scenarioId = entry.scenarioId
    if (!scenarioId) return

    // Prevent the selection-change effect from resetting our manual edits immediately.
    skipResetFromCacheRef.current = true
    cachedScenarioIdRef.current = scenarioId

    setSelectedScenarioId(scenarioId)
    setEditedGroupCalendars(entry.groupCalendars ?? [])

    setManualRecalc({
      totals: entry.selectedTotals ?? null,
      product_impacts: entry.productImpacts ?? [],
      base_totals: entry.baseTotals ?? null,
    })

    setManualEditError('')
    setPromoApplyTarget('ALL')
    setPromoApplyWeekFrom(16)
    setPromoApplyWeekTo(27)
    setPromoApplyLevel(10)
    setIsRecalculating(false)
    setError('')
    setShowSavedMenu(false)
  }

  const downloadSavedCalendar = (entry) => {
    const csv = buildCalendarCsv(entry)
    downloadFile(csv, `promo_calendar_saved_${(entry?.scenarioName || 'scenario').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${String(entry?.savedAt || '').slice(0, 10)}.csv`)
  }

  return (
    <AppLayout {...layoutProps}>
      <div className="space-y-6">
        <div className="sticky top-2 z-30 flex justify-end" ref={savedMenuRef}>
          <div className="relative inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <button
              type="button"
              onClick={downloadSavedCalendarsWorkbook}
              disabled={!savedCalendars.length}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
            <button
              type="button"
              onClick={() => setShowSavedMenu((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Saved ({savedCalendars.length})
              <ChevronDown className={`h-3.5 w-3.5 transition ${showSavedMenu ? 'rotate-180' : ''}`} />
            </button>
            {saveToast && (
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">{saveToast}</span>
            )}

            {showSavedMenu && (
              <div className="absolute right-0 top-10 z-40 w-[360px] rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Saved Calendars</p>
                </div>
                <div className="max-h-64 space-y-1 overflow-auto">
                  {savedCalendars.length === 0 && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-500">
                      No saved calendars yet.
                    </div>
                  )}
                  {savedCalendars.map((entry) => (
                    <div
                      key={entry.id}
                      className="cursor-pointer rounded-md border border-slate-200 px-2 py-2 hover:bg-slate-50"
                      onClick={() => loadSavedCalendar(entry)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') loadSavedCalendar(entry)
                      }}
                    >
                      <p className="truncate text-xs font-semibold text-slate-800">{entry.calendarName ?? entry.scenarioName}</p>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                        {String(entry.savedAt).slice(0, 19).replace('T', ' ')}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            downloadSavedCalendar(entry)
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700"
                        >
                          <Download className="h-3 w-3" />
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSavedCalendars((prev) => prev.filter((x) => x.id !== entry.id))
                          }}
                          className="inline-flex items-center gap-1 rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {isSaveDialogOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4"
            onClick={() => setIsSaveDialogOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h4 className="text-lg font-bold text-slate-800">Save Calendar</h4>
              <p className="mt-1 text-sm font-medium text-slate-600">Name your saved scenario.</p>

              <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Calendar name
                <input
                  autoFocus
                  type="text"
                  value={saveDialogName}
                  onChange={(event) => setSaveDialogName(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  placeholder="Promo calendar 1"
                />
              </label>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setIsSaveDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:brightness-95"
                  onClick={() => {
                    saveCurrentCalendar(saveDialogName)
                    setIsSaveDialogOpen(false)
                  }}
                  disabled={!saveDialogName.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {scenarioPreviewId && previewSummary && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            onClick={() => setScenarioPreviewId(null)}
          >
            <div
              className="w-full max-w-7xl rounded-xl border border-slate-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-slate-200 px-4 py-3">
                <h4 className="text-lg font-bold text-slate-800">
                  Scenario Preview: {previewSummary.scenario_name}
                </h4>
                <p className="mt-1 text-xs font-medium text-slate-600">
                  Baseline impact and read-only discount calendar preview.
                </p>
              </div>

              <div className="max-h-[72vh] space-y-4 overflow-auto px-4 py-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                  {previewImpactCards.map((item) => (
                    <div key={`preview-${item.label}`} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{item.label}</p>
                      <p className={`mt-1 text-3xl font-extrabold ${item.pct >= 0 ? 'text-[#047857]' : 'text-[#BE123C]'}`}>{formatPct(item.pct)}</p>
                      <p className="mt-2 text-sm font-semibold text-slate-700">
                        {item.money ? formatInr(item.base) : formatInt(item.base)} {'->'} {item.money ? formatInr(item.next) : formatInt(item.next)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full table-fixed divide-y divide-slate-200 text-xs">
                    <colgroup>
                      <col style={{ width: '12%' }} />
                      {Array.from({ length: 27 }).map((_, index) => (
                        <col key={`preview-col-${index}`} style={{ width: `${88 / 27}%` }} />
                      ))}
                    </colgroup>
                    <thead className="bg-slate-50">
                      <tr>
                        <th
                          rowSpan={2}
                          className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600"
                        >
                          SKU group
                        </th>
                        <th colSpan={15} className="border-r border-slate-200 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Base price (W1-W15)
                        </th>
                        <th colSpan={12} className="px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Promo Window (W16-W27)
                        </th>
                      </tr>
                      <tr>
                        {Array.from({ length: 27 }).map((_, index) => (
                          <th
                            key={`preview-week-${index}`}
                            className={`px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wide ${
                              index < 15 ? 'bg-slate-50 text-slate-500' : 'bg-blue-50 text-[#2563EB]'
                            }`}
                          >
                            W{index + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(previewDetail?.group_calendars ?? []).map((group) => (
                        <tr key={`preview-${group.group_id}`}>
                          <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-2 py-1.5 align-top">
                            <p className="text-sm font-bold leading-tight text-slate-800">{group.group_name}</p>
                            <p className="text-[11px] font-medium text-slate-500">{group.product_count} products</p>
                          </td>
                          {(group.weekly_discounts ?? []).map((discount, idx) => (
                            <td key={`preview-${group.group_id}-${idx}`} className={`px-1 py-1 text-center ${idx < 15 ? 'bg-slate-50/40' : 'bg-white'}`}>
                              <span className={`inline-flex h-6 w-full items-center justify-center rounded border px-1 text-[10px] font-bold ${getPromoLevelPillClass(discount, idx)}`}>
                                {Number(discount) === 0 ? '-' : `${Number(discount)}`}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setScenarioPreviewId(null)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={selectScenarioFromPreview}
                  className="rounded-md bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:brightness-95"
                >
                  Select and Analyze
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="panel p-4">
          <button
            type="button"
            onClick={() => setSimulateCollapsed((prev) => !prev)}
            className="flex w-full flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 text-left"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Simulate price-off scenarios with{' '}
                <span className="relative inline-flex items-center font-extrabold">
                  <span className="text-[#0F172A]">Trinity</span>
                  <span className="ml-1 text-[#4F46E5]">AI</span>
                  <Sparkles className="pointer-events-none absolute -right-4 -top-2 h-3.5 w-3.5 text-[#6366F1]" />
                  <Sparkles className="pointer-events-none absolute -right-3 top-2 h-2.5 w-2.5 text-[#F59E0B]" />
                </span>
              </h2>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-slate-500 transition-transform ${simulateCollapsed ? '-rotate-90' : 'rotate-0'}`}
            />
          </button>

          {!simulateCollapsed && (
          <>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="lg:col-span-4">
              <h3 className="text-base font-bold text-slate-800">Set constraints</h3>
            </div>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:col-span-4">
              WHAT IS THE BUSINESS OUTCOME YOU WANT TO ACHIEVE?
              <textarea
                value={controls.prompt}
                onChange={(event) => setControls((prev) => ({ ...prev, prompt: event.target.value }))}
                placeholder="I want to maximize my revenue..."
                className="min-h-[88px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              MINIMUM GROSS MARGIN %
              <div className="relative">
                <input
                  type="number"
                  value={controls.minGrossMarginPct}
                  min={20}
                  max={60}
                  onChange={(event) => setControls((prev) => ({ ...prev, minGrossMarginPct: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm font-medium text-slate-700"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">%</span>
              </div>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Min Discount Weeks
              <input
                type="number"
                value={controls.minPromoWeeks}
                min={0}
                max={12}
                onChange={(event) => setControls((prev) => ({ ...prev, minPromoWeeks: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Max Discount Weeks
              <input
                type="number"
                value={controls.maxPromoWeeks}
                min={1}
                max={12}
                onChange={(event) => setControls((prev) => ({ ...prev, maxPromoWeeks: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              />
            </label>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={runOptimization}
              disabled={isRunning}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run
            </button>
            <button
              type="button"
              onClick={() => {
                setControls((prev) => ({
                  ...prev,
                  prompt: '',
                  minGrossMarginPct: 40,
                  minPromoWeeks: 4,
                  maxPromoWeeks: 12,
                  scenarioCount: 1500,
                  minVolumeUpliftPct: '',
                  minRevenueUpliftPct: '',
                  maxProfitDecreasePct: '',
                }))
                setError('')
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
          {isRunning && (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
              {progress?.stage || 'Running...'} {Number.isFinite(progress?.progress_pct) ? `(${progress.progress_pct}%)` : ''}
            </div>
          )}
          {error && <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</div>}
          </>
          )}
        </div>

        {result && (
          <div className="panel p-4">
            <button
              type="button"
              onClick={() => setSelectionCollapsed((prev) => !prev)}
              className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
            >
              <div className="min-w-[280px]">
                <h3 className="text-xl font-bold text-slate-800">Select scenarios for further analysis</h3>
                <p className="mt-1 text-sm font-semibold text-slate-800">{summaries.length} scenarios generated!</p>
                {bestVolumeScenario && bestRevenueScenario && bestProfitScenario ? (
                  <p className="text-xs font-medium text-slate-600">
                    Highest Volume: {formatPct(Number(bestVolumeScenario.volume_uplift_pct) * 100)} · Highest Revenue:{' '}
                    {formatPct(Number(bestRevenueScenario.revenue_uplift_pct) * 100)} · Highest Gross Margin:{' '}
                    {formatPct(Number(bestProfitScenario.profit_uplift_pct) * 100)}
                  </p>
                ) : (
                  <p className="text-xs font-medium text-rose-700">No scenarios match current filters.</p>
                )}
              </div>
              <ChevronDown
                className={`mt-1 h-4 w-4 text-slate-500 transition-transform ${selectionCollapsed ? '-rotate-90' : 'rotate-0'}`}
              />
            </button>

            {!selectionCollapsed && (
              <>
                <div className="flex items-center gap-2 mt-3">
                  {!filtersApplied && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAllScenarios((prev) => !prev)
                        setPage(0)
                      }}
                      className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                        showAllScenarios
                          ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                          : 'border-slate-300 text-slate-700'
                      }`}
                    >
                      {showAllScenarios ? 'Show Anchor 3' : `Show All (${summaries.length})`}
                    </button>
                  )}
                  <select
                    value={sortBy}
                    onChange={(event) => {
                      setSortBy(event.target.value)
                      setPage(0)
                    }}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    <option value="revenue">Sort by Revenue %</option>
                    <option value="profit">Sort by Gross Margin %</option>
                    <option value="volume">Sort by Volume %</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => downloadCsv(displaySummaries)}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    <Download className="h-4 w-4" />
                    Download CSV
                  </button>
                </div>

                <div className="mt-3 text-xs font-semibold text-slate-600">
                  {!filtersApplied && !showAllScenarios ? 'Anchor view (Max Volume / Max Revenue / Max Gross Margin). ' : ''}
                  Showing {Math.min(page * PAGE_SIZE + 1, displaySummaries.length)}-
                  {Math.min((page + 1) * PAGE_SIZE, displaySummaries.length)} of {displaySummaries.length}
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-base font-semibold text-[#0F172A]">View and compare scenarios</h4>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <span className="text-xs font-semibold text-slate-600">
                        Page {Math.min(page + 1, pageCount)} / {pageCount}
                      </span>
                      <button
                        type="button"
                        disabled={page >= pageCount - 1}
                        onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 mb-2 text-[11px] font-medium text-slate-600">
                    Scenarios selected to surface the highest positive volume %, revenue %, and gross margin % vs base (up to three distinct
                    scenarios). Change filters to see more.
                  </p>
                  <div className="mt-3 h-[320px] w-full">
                    <ResponsiveContainer>
                      <BarChart
                        data={pagedSummaries.map((row) => ({
                          name: row.scenario_name,
                          scenarioId: row.scenario_id,
                          volumePct: Number(row.volume_uplift_pct) * 100,
                          revenuePct: Number(row.revenue_uplift_pct) * 100,
                          profitPct: Number(row.profit_uplift_pct) * 100,
                        }))}
                        margin={{ top: 16, right: 20, left: 8, bottom: 16 }}
                        onClick={(state) => {
                          const scenarioId = state?.activePayload?.[0]?.payload?.scenarioId
                          if (scenarioId) openScenarioPreview(scenarioId)
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#0F172A', fontWeight: 700 }} />
                        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#0F172A', fontWeight: 700 }} />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11, fontWeight: 600 }} />
                        <Bar
                          dataKey="volumePct"
                          name="Volume %"
                          fill="#2563EB"
                          cursor="pointer"
                          isAnimationActive={false}
                          onClick={(entry) => openScenarioPreview(entry?.scenarioId)}
                        >
                          <LabelList
                            dataKey="volumePct"
                            content={renderBarLabel}
                          />
                          {pagedSummaries.map((row) => (
                            <Cell
                              key={`v-${row.scenario_id}`}
                              cursor="pointer"
                              fill={selectedId === row.scenario_id ? '#1D4ED8' : '#2563EB'}
                              onClick={() => openScenarioPreview(row.scenario_id)}
                            />
                          ))}
                        </Bar>
                        <Bar
                          dataKey="revenuePct"
                          name="Revenue %"
                          fill="#16A34A"
                          cursor="pointer"
                          isAnimationActive={false}
                          onClick={(entry) => openScenarioPreview(entry?.scenarioId)}
                        >
                          <LabelList
                            dataKey="revenuePct"
                            content={renderBarLabel}
                          />
                        </Bar>
                        <Bar
                          dataKey="profitPct"
                          name="Gross Margin %"
                          fill="#F97316"
                          cursor="pointer"
                          isAnimationActive={false}
                          onClick={(entry) => openScenarioPreview(entry?.scenarioId)}
                        >
                          <LabelList
                            dataKey="profitPct"
                            content={renderBarLabel}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">FILTER SCENARIOS</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Min Volume % Increase
                      <input
                        type="number"
                        value={controls.minVolumeUpliftPct}
                        onChange={(event) => setControls((prev) => ({ ...prev, minVolumeUpliftPct: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Min Revenue % Increase
                      <input
                        type="number"
                        value={controls.minRevenueUpliftPct}
                        onChange={(event) => setControls((prev) => ({ ...prev, minRevenueUpliftPct: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Max Gross Margin % Decrease
                      <input
                        type="number"
                        min={0}
                        value={controls.maxProfitDecreasePct}
                        onChange={(event) => setControls((prev) => ({ ...prev, maxProfitDecreasePct: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                      />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {(inScenarioMode || defaultGroupCalendars.length > 0 || defaultInitError) && (
          <>
            <div className="panel sticky top-3 z-20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xl font-bold text-slate-800">Projected Business Impact</h3>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-600">
                    Selected Scenario: {inScenarioMode ? selectedSummary?.scenario_name : 'Default'}
                    {(inScenarioMode ? manualRecalc : defaultHasEdits) ? ' (Edited)' : ''}
                  </p>
                  {isRecalculating && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                </div>
              </div>
              {defaultInitError && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {defaultInitError}
                </div>
              )}
              {manualEditError && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {manualEditError}
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
                {impactCards.map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{item.label}</p>
                    <p className={`mt-1 text-4xl font-extrabold ${item.pct >= 0 ? 'text-[#047857]' : 'text-[#BE123C]'}`}>{formatPct(item.pct)}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      {item.money ? formatInr(item.base) : formatInt(item.base)} {'->'} {item.money ? formatInr(item.next) : formatInt(item.next)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Edit Discount Calendar</h3>
                  <p className="mt-1 text-xs font-medium text-slate-600">Click on a week (W1-W27) to set No Discount / 10% / 20% / 30% / 40%.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetCalendarEdits}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    {inScenarioMode ? 'Reset to scenario' : 'Reset'}
                  </button>
                  <button
                    type="button"
                    onClick={openSaveDialog}
                    className="inline-flex items-center gap-1 rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Calendar
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Bulk editor</p>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-6">
                  <label className="text-xs font-semibold text-slate-600">
                    SKU group
                    <select
                      value={promoApplyTarget}
                      onChange={(event) => setPromoApplyTarget(event.target.value)}
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
                    >
                      <option value="ALL">All</option>
                      {activeGroupCalendars.map((group) => (
                        <option key={group.group_id} value={group.group_id}>
                          {group.group_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Week From
                    <select
                      value={promoApplyWeekFrom}
                      onChange={(event) => setPromoApplyWeekFrom(Number(event.target.value))}
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
                    >
                      {Array.from({ length: 27 }).map((_, idx) => (
                        <option key={`from-${idx + 1}`} value={idx + 1}>
                          W{idx + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Week To
                    <select
                      value={promoApplyWeekTo}
                      onChange={(event) => setPromoApplyWeekTo(Number(event.target.value))}
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
                    >
                      {Array.from({ length: 27 }).map((_, idx) => (
                        <option key={`to-${idx + 1}`} value={idx + 1}>
                          W{idx + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Discount level
                    <select
                      value={promoApplyLevel}
                      onChange={(event) => setPromoApplyLevel(Number(event.target.value))}
                      className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
                    >
                      {PROMO_LEVEL_OPTIONS.map((level) => (
                        <option key={`lvl-${level}`} value={level}>
                          {level === 0 ? 'No Discount' : `${level}%`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="md:col-span-2 flex items-end">
                    <button
                      type="button"
                      onClick={applyPromoApplier}
                      disabled={isRecalculating || !activeGroupCalendars.length}
                      className="h-8 w-full rounded border border-[#2563EB] bg-blue-50 px-3 text-xs font-bold text-[#2563EB] disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
                {PROMO_LEVEL_OPTIONS.map((level, idx) => (
                  <span key={`legend-${level}`} className={`rounded border px-2 py-0.5 ${getPromoLevelPillClass(level, idx >= 1 ? 16 : 0)}`}>
                    {level === 0 ? 'No Discount' : `${level}%`}
                  </span>
                ))}
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full table-fixed divide-y divide-slate-200 text-xs">
                  <colgroup>
                    <col style={{ width: '12%' }} />
                    {Array.from({ length: 27 }).map((_, index) => (
                      <col key={`col-${index}`} style={{ width: `${88 / 27}%` }} />
                    ))}
                  </colgroup>
                  <thead className="bg-slate-50">
                    <tr>
                      <th
                        rowSpan={2}
                        className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600"
                      >
                        SKU group
                      </th>
                      <th colSpan={15} className="border-r border-slate-200 px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Base price (W1-W15)
                      </th>
                      <th colSpan={12} className="px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Promo Window (W16-W27)
                      </th>
                    </tr>
                    <tr>
                      {Array.from({ length: 27 }).map((_, index) => (
                        <th
                          key={index}
                          className={`px-1 py-1 text-center text-[10px] font-bold uppercase tracking-wide ${
                            index < 15 ? 'bg-slate-50 text-slate-500' : 'bg-blue-50 text-[#2563EB]'
                          }`}
                        >
                          W{index + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {activeGroupCalendars.map((group) => {
                      const segment = getSegmentMetaByBasePrice(group.base_price)
                      return (
                        <tr key={group.group_id}>
                          <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-2 py-1.5 align-top">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold leading-tight text-slate-800">{group.group_name}</p>
                              <span className={`inline-flex rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${segment.badgeClass}`}>
                                {segment.label}
                              </span>
                            </div>
                            <p className="text-[11px] font-medium text-slate-500">{group.product_count} products</p>
                          </td>
                          {group.weekly_discounts.map((discount, idx) => (
                            <td key={`${group.group_id}-${idx}`} className={`px-1 py-1 text-center ${idx < 15 ? 'bg-slate-50/40' : 'bg-white'}`}>
                              <button
                                type="button"
                                onClick={(event) => handlePromoCellClick(group.group_id, idx, discount, event)}
                                disabled={isRecalculating}
                                className={`h-6 w-full rounded border px-1 text-[10px] font-bold leading-none transition hover:brightness-95 disabled:opacity-60 ${getPromoLevelPillClass(discount, idx)}`}
                                title="Click to cycle promo level. Shift+Click reverse. Alt+Click reset."
                              >
                                {Number(discount) === 0 ? '-' : `${Number(discount)}`}
                              </button>
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </>
        )}
      </div>
    </AppLayout>
  )
}

export default PromoCalendarPage
