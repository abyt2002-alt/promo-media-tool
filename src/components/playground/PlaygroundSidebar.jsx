import { Download, RotateCcw, Trash2 } from 'lucide-react'

const PlaygroundSidebar = ({
  scenarios,
  selectedScenarioId,
  onScenarioChange,
  onReset,
  onDeleteScenario,
  onDownloadScenario,
}) => {
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="text-base font-bold text-slate-800">Playground Settings</h3>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Scenario</label>
            <select
              value={selectedScenarioId}
              onChange={(event) => onScenarioChange(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              {scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset Values
          </button>
          <button
            type="button"
            onClick={() => onDeleteScenario(selectedScenarioId)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
          >
            <Trash2 className="h-4 w-4" />
            Delete Scenario
          </button>
          <button
            type="button"
            onClick={onDownloadScenario}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Download Scenario
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlaygroundSidebar
