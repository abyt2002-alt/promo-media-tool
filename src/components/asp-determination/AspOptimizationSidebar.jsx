import { Download, Loader2, Play, RotateCcw, Trash2 } from 'lucide-react'

const NumberControl = ({ label, value, onChange, min = 1, max = 99, step = 1, suffix = '%' }) => {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="relative">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value)
            onChange(Number.isFinite(next) ? next : 0)
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
          {suffix}
        </span>
      </div>
    </div>
  )
}

const TextAreaControl = ({ label, value, onChange, placeholder }) => {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
    </div>
  )
}

const AspOptimizationSidebar = ({
  controls,
  onControlsChange,
  onRun,
  onReset,
  onDownloadSavedScenarios,
  onDeleteSavedScenario,
  savedScenarios = [],
  isRunning = false,
  jobProgress = { progressPct: 0, stage: '' },
}) => {
  const progressPct = Math.max(6, Math.min(100, Number(jobProgress?.progressPct) || 0))
  const stageText = jobProgress?.stage || 'Running AI-guided Monte Carlo scenario generation...'

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="text-base font-bold text-slate-800">Optimization Controls</h3>

      <div className="mt-4 space-y-3">
          <NumberControl
            label="Minimum Gross Margin"
            value={controls.grossMarginPct}
            min={20}
            max={60}
            step={1}
            onChange={(value) => onControlsChange({ grossMarginPct: Math.max(20, Math.min(60, value)) })}
          />

          <TextAreaControl
            label="AI Intent"
            value={controls.prompt ?? ''}
            placeholder="Describe your objective, e.g. push premium tiers while protecting revenue floor."
            onChange={(value) => onControlsChange({ prompt: value })}
          />

          {isRunning && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">{stageText}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-brand.blue transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          <div className="-mx-4 mt-2 border-t border-slate-200 bg-white px-4 pb-1 pt-3">
            <button
              type="button"
              onClick={onRun}
              disabled={isRunning}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#2563EB] bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isRunning ? 'Optimizing...' : 'Run Optimization'}
            </button>

            <button
              type="button"
              onClick={onReset}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Controls
            </button>

            <button
              type="button"
              onClick={onDownloadSavedScenarios}
              disabled={!savedScenarios.length}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Download Saved (Sheets)
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Saved Scenarios ({savedScenarios.length})
            </p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
              {savedScenarios.length ? (
                savedScenarios.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-slate-700">{item.name}</p>
                      <p className="text-[10px] text-slate-500">{item.savedAtLabel}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedScenario?.(item.id)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
                      title="Delete saved scenario"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-slate-500">No saved scenarios.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AspOptimizationSidebar

