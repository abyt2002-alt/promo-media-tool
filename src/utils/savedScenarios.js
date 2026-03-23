const STORAGE_KEY = 'base_ladder_saved_scenarios_v1'
const MAX_SAVED = 100
const SCENARIO_VERSION = 2

const isValidScenario = (item) => {
  if (!item || typeof item !== 'object') return false
  if (!Array.isArray(item.rows) || item.rows.length < 2) return false
  const n = item.rows.length
  if (!item.modelContext || !Array.isArray(item.modelContext.betaPpu)) return false
  if (!Array.isArray(item.modelContext.basePrices) || !Array.isArray(item.modelContext.baseVolumes)) return false
  if (!Array.isArray(item.modelContext.gammaMatrix)) return false
  if (item.modelContext.betaPpu.length !== n) return false
  if (item.modelContext.basePrices.length !== n) return false
  if (item.modelContext.baseVolumes.length !== n) return false
  if (item.modelContext.gammaMatrix.length !== n) return false
  for (let index = 0; index < n; index += 1) {
    const row = item.rows[index]
    if (!row || typeof row !== 'object') return false
    if (!row.productName || typeof row.productName !== 'string') return false
    const baseAsp = Number(row.baseAsp)
    const baseVolume = Number(row.baseVolume)
    const scenarioAsp = Number(row.scenarioAsp)
    const scenarioVolume = Number(row.scenarioVolume)
    if (!Number.isFinite(baseAsp) || baseAsp <= 0) return false
    if (!Number.isFinite(baseVolume) || baseVolume <= 0) return false
    if (!Number.isFinite(scenarioAsp) || scenarioAsp <= 0) return false
    if (!Number.isFinite(scenarioVolume) || scenarioVolume <= 0) return false
  }
  return true
}

const safeParse = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const getSavedScenarios = () => {
  if (typeof window === 'undefined') {
    return []
  }
  return safeParse(localStorage.getItem(STORAGE_KEY)).filter(isValidScenario)
}

const writeSavedScenarios = (items) => {
  if (typeof window === 'undefined') {
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_SAVED)))
}

export const saveScenarioSnapshot = (snapshot) => {
  try {
    const current = getSavedScenarios()
    const id = `saved_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const next = [{ ...snapshot, id, version: SCENARIO_VERSION, savedAt: new Date().toISOString() }, ...current]
    writeSavedScenarios(next)
    return id
  } catch {
    return null
  }
}

export const deleteSavedScenario = (id) => {
  const next = getSavedScenarios().filter((item) => item.id !== id)
  writeSavedScenarios(next)
}
