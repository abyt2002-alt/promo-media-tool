import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/layout/AppLayout'
import PlaygroundSidebar from '../components/playground/PlaygroundSidebar'
import { deleteSavedScenario, getSavedScenarios } from '../utils/savedScenarios'
import { evaluatePlaygroundScenario } from '../utils/playgroundUtils'

const formatInt = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
const formatPct = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
const COGS_RATIO = 0.4

const computeBaselineTotals = (scenario) => {
  if (!scenario?.rows?.length) {
    return null
  }

  const modelBasePrices = scenario.modelContext?.basePrices ?? []
  const modelBaseVolumes = scenario.modelContext?.baseVolumes ?? []
  const rows = scenario.rows

  const totals = rows.reduce(
    (acc, row, index) => {
      const basePrice = Number.isFinite(modelBasePrices[index])
        ? modelBasePrices[index]
        : Number(row.baseAsp)
      const baseVolume = Number.isFinite(modelBaseVolumes[index])
        ? modelBaseVolumes[index]
        : Number(row.baseVolume)

      if (!Number.isFinite(basePrice) || !Number.isFinite(baseVolume) || basePrice <= 0 || baseVolume <= 0) {
        return acc
      }

      const unitCost = basePrice * COGS_RATIO
      acc.totalVolume += baseVolume
      acc.totalRevenue += basePrice * baseVolume
      acc.totalProfit += (basePrice - unitCost) * baseVolume
      return acc
    },
    { totalVolume: 0, totalRevenue: 0, totalProfit: 0 },
  )

  return totals
}

const PlaygroundPage = () => {
  const [savedScenarios, setSavedScenarios] = useState(() => getSavedScenarios())
  const [selectedScenarioId, setSelectedScenarioId] = useState(savedScenarios[0]?.id ?? '')
  const [priceMap, setPriceMap] = useState({})

  const selectedScenario = useMemo(
    () => savedScenarios.find((item) => item.id === selectedScenarioId) ?? null,
    [savedScenarios, selectedScenarioId],
  )

  useEffect(() => {
    if (!savedScenarios.length) {
      setSelectedScenarioId('')
      return
    }
    if (!selectedScenarioId || !savedScenarios.some((item) => item.id === selectedScenarioId)) {
      setSelectedScenarioId(savedScenarios[0].id)
    }
  }, [savedScenarios, selectedScenarioId])

  useEffect(() => {
    if (!selectedScenario) return
    const baseMap = Object.fromEntries(
      selectedScenario.rows.map((row) => [row.productName, row.scenarioAsp]),
    )
    setPriceMap(baseMap)
  }, [selectedScenario])

  const sortedRows = useMemo(() => {
    if (!selectedScenario) return []
    const prices = selectedScenario.rows.map((row) => priceMap[row.productName] ?? row.scenarioAsp)
    const { optimizedRows } = evaluatePlaygroundScenario({ savedScenario: selectedScenario, prices })
    return optimizedRows
      .slice()
      .sort((a, b) => (b.baseAsp ?? b.currentAsp) - (a.baseAsp ?? a.currentAsp) || a.productName.localeCompare(b.productName))
  }, [selectedScenario, priceMap])

  const totals = useMemo(() => {
    if (!selectedScenario) return null
    const prices = selectedScenario.rows.map((row) => priceMap[row.productName] ?? row.scenarioAsp)
    return evaluatePlaygroundScenario({ savedScenario: selectedScenario, prices }).optimizedTotals
  }, [selectedScenario, priceMap])

  const baselineTotals = useMemo(() => computeBaselineTotals(selectedScenario), [selectedScenario])
  const rightSidebar = (
    <PlaygroundSidebar
      scenarios={savedScenarios}
      selectedScenarioId={selectedScenarioId}
      onScenarioChange={setSelectedScenarioId}
      onReset={() => {
        if (!selectedScenario) return
        const resetMap = Object.fromEntries(
          selectedScenario.rows.map((row) => [row.productName, row.scenarioAsp]),
        )
        setPriceMap(resetMap)
      }}
      onDeleteScenario={(scenarioId) => {
        deleteSavedScenario(scenarioId)
        setSavedScenarios(getSavedScenarios())
      }}
      onDownloadScenario={() => {
        if (!selectedScenario || !sortedRows.length) return
        const headers = ['Product', 'Base Price', 'Scenario Price', 'Edited Price', 'Base Volume', 'New Volume', 'Volume Change %', 'Revenue Change %', 'Profit Change %']
        const dataRows = sortedRows.map((row) => [
          row.productName,
          Math.round(row.baseAsp),
          Math.round(row.scenarioAsp ?? row.currentAsp),
          Math.round(row.optimizedAsp),
          Math.round(row.baseVolume ?? row.currentVolume),
          Math.round(row.optimizedVolume),
          (row.volumeChangePct * 100).toFixed(2),
          (row.revenueChangePct * 100).toFixed(2),
          (row.profitChangePct * 100).toFixed(2),
        ])
        const csv = [headers, ...dataRows]
          .map((line) =>
            line
              .map((cell) => {
                const text = String(cell ?? '')
                return text.includes(',') || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text
              })
              .join(','),
          )
          .join('\n')

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${selectedScenario.name.replace(/\s+/g, '_')}_playground.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }}
    />
  )

  if (!savedScenarios.length) {
    return (
      <AppLayout rightSidebar={rightSidebar}>
        <div className="panel p-8">
          <h2 className="text-2xl font-bold text-slate-800">Playground</h2>
          <p className="mt-2 text-sm text-slate-600">
            No saved scenarios yet. Go to Base Ladder Detection, choose a scenario, and click Save Scenario.
          </p>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout rightSidebar={rightSidebar}>
      <div className="space-y-5">
        <div className="panel p-5">
          <h2 className="text-3xl font-bold text-slate-800">Playground</h2>
          <p className="mt-2 text-sm text-slate-600">
            Load a saved scenario and play with product values to see elasticity-driven impact on volume, revenue, and profit.
          </p>
        </div>

        {totals && baselineTotals && (
          <div className="panel p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Total Revenue</p>
                <p className="mt-1 text-2xl font-extrabold text-emerald-800">INR {formatInt(totals.totalRevenue)}</p>
                <p className="text-xs text-emerald-700">Base: INR {formatInt(baselineTotals.totalRevenue)}</p>
                <p className="text-xs font-semibold text-emerald-700">
                  {formatPct((totals.totalRevenue - baselineTotals.totalRevenue) / Math.max(1, baselineTotals.totalRevenue))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Volume</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-800">{formatInt(totals.totalVolume)}</p>
                <p className="text-xs text-slate-500">Base: {formatInt(baselineTotals.totalVolume)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Profit</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-800">INR {formatInt(totals.totalProfit)}</p>
                <p className="text-xs text-slate-500">Base: INR {formatInt(baselineTotals.totalProfit)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Saved Scenario</p>
                <p className="mt-1 text-xl font-extrabold text-slate-800">{selectedScenario?.name}</p>
              </div>
            </div>
          </div>
        )}

        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-lg font-bold text-slate-800">Scenario Ladder Input</h3>
            <p className="mt-1 text-xs text-slate-500">Edit new scenario price directly; volume impact updates in-line.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2">
            {[sortedRows.slice(0, Math.ceil(sortedRows.length / 2)), sortedRows.slice(Math.ceil(sortedRows.length / 2))].map(
              (group, groupIndex) => (
                <div key={groupIndex} className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Ladder Group {groupIndex + 1}
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.map((row) => {
                      const scenarioAnchor = Math.round(row.scenarioAsp ?? row.currentAsp ?? row.baseAsp ?? 0)
                      const editedPrice = Math.round(priceMap[row.productName] ?? scenarioAnchor)
                      const deltaFromScenario = editedPrice - scenarioAnchor

                      return (
                        <div key={row.productName} className="grid grid-cols-[minmax(0,1.7fr)_90px_98px_96px_96px_104px] items-center gap-2 px-3 py-2">
                          <p className="text-[13px] font-semibold text-slate-800">{row.productName}</p>
                          <p className="text-right text-[11px] font-semibold text-slate-500">Base: {Math.round(row.baseAsp)}</p>
                          <p className="text-right text-[11px] font-semibold text-slate-500">Scenario: {scenarioAnchor}</p>
                          <input
                            type="number"
                            step="1"
                            value={deltaFromScenario}
                            onChange={(event) => {
                              const nextDelta = Number(event.target.value)
                              setPriceMap((prev) => ({
                                ...prev,
                                [row.productName]: Math.max(1, scenarioAnchor + (Number.isFinite(nextDelta) ? nextDelta : 0)),
                              }))
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-700"
                            title="Change vs saved scenario price"
                          />
                          <p className="text-right text-xs font-bold text-slate-800">INR {editedPrice}</p>
                          <span
                            className={`inline-flex justify-end rounded-full border px-1.5 py-0.5 text-[11px] font-bold ${
                              row.volumeChangePct >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                            }`}
                          >
                            Vol {formatPct(row.volumeChangePct)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default PlaygroundPage
