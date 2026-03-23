const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizeSkuLabel = (value) =>
  String(value ?? '')
    .replace(/\|/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim()

// Min width on SKU column so names stay readable inside narrow segment cards (minmax(0,fr) can collapse to 0).
const SKU_TABLE_GRID = 'grid grid-cols-[minmax(220px,1.5fr)_84px_88px_84px_84px] gap-2'

const SegmentProductTable = ({ products, productConstraints, onProductConstraintChange }) => {
  // Single overflow container + inner pr avoids vertical scrollbar overlapping the Max column
  // inside narrow <details> panels (nested overflow-x + overflow-y made the bar paint over inputs).
  return (
    <div className="mt-2 max-h-[252px] min-w-0 overflow-auto rounded-lg border border-slate-200 bg-white [scrollbar-gutter:stable]">
      <div className="min-w-[560px] pr-3">
        <div
          className={`${SKU_TABLE_GRID} sticky top-0 z-10 border-b border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500`}
        >
          <span>SKU</span>
          <span className="text-right">Base</span>
          <span className="text-center leading-tight">Do not change</span>
          <span className="text-right">Min</span>
          <span className="text-right">Max</span>
        </div>
        <div className="divide-y divide-slate-100">
        {products.map((item) => {
          const key = item.productName
          const displaySku = normalizeSkuLabel(item.productName ?? item.skuName ?? item.product_name)
          const c = productConstraints[key] ?? {}
          const minAllowed = Math.max(1, item.basePrice - 150)
          const maxAllowed = item.basePrice + 150
          const noChange = Boolean(c.noChange)
          const minPrice = Number.isFinite(c.minPrice) ? clamp(c.minPrice, minAllowed, maxAllowed) : minAllowed
          const maxPrice = Number.isFinite(c.maxPrice) ? clamp(c.maxPrice, minAllowed, maxAllowed) : maxAllowed
          return (
            <div key={key} className={`${SKU_TABLE_GRID} items-start px-2 py-1.5`}>
              <span
                className="min-w-0 whitespace-normal break-words text-[12px] font-medium leading-snug text-slate-800"
                title={displaySku}
              >
                {displaySku}
              </span>
              <span className="text-right text-[12px] font-semibold text-slate-700">{Math.round(item.basePrice)}</span>
              <label className="inline-flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={noChange}
                  onChange={(event) => {
                    const checked = Boolean(event.target.checked)
                    onProductConstraintChange?.(key, {
                      noChange: checked,
                      minPrice: checked ? item.basePrice : Math.max(1, item.basePrice - 150),
                      maxPrice: checked ? item.basePrice : item.basePrice + 150,
                    })
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                />
              </label>
              <input
                type="number"
                value={Math.round(noChange ? item.basePrice : minPrice)}
                min={Math.round(minAllowed)}
                max={Math.round(maxAllowed)}
                step={1}
                disabled={noChange}
                onChange={(event) =>
                  onProductConstraintChange?.(key, {
                    noChange: false,
                    minPrice: Number(event.target.value),
                    maxPrice,
                  })
                }
                className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-[12px] font-medium text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
              <input
                type="number"
                value={Math.round(noChange ? item.basePrice : maxPrice)}
                min={Math.round(minAllowed)}
                max={Math.round(maxAllowed)}
                step={1}
                disabled={noChange}
                onChange={(event) =>
                  onProductConstraintChange?.(key, {
                    noChange: false,
                    minPrice,
                    maxPrice: Number(event.target.value),
                  })
                }
                className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-[12px] font-medium text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}

const SegmentColumn = ({
  title,
  noChange,
  onNoChangeChange,
  maxDecrease,
  maxIncrease,
  onRangeChange,
  products,
  productConstraints,
  onProductConstraintChange,
}) => {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-[11px] font-medium text-slate-500">{products.length} products</p>
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(noChange)}
            onChange={(event) => onNoChangeChange?.(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
          />
          Do not change
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Max Decrease (INR)</p>
          <input
            type="number"
            value={Math.round(maxDecrease)}
            min={0}
            max={150}
            step={1}
            disabled={Boolean(noChange)}
            onChange={(event) => onRangeChange({ maxDecrease: clamp(Number(event.target.value) || 0, 0, 150), maxIncrease })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Max Increase (INR)</p>
          <input
            type="number"
            value={Math.round(maxIncrease)}
            min={0}
            max={150}
            step={1}
            disabled={Boolean(noChange)}
            onChange={(event) => onRangeChange({ maxDecrease, maxIncrease: clamp(Number(event.target.value) || 0, 0, 150) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
      </div>

      <details className="mt-3 min-w-0 rounded-lg border border-slate-200 bg-white p-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          SKU-level override (optional)
        </summary>
        <SegmentProductTable
          products={products}
          productConstraints={productConstraints}
          onProductConstraintChange={onProductConstraintChange}
        />
      </details>
    </div>
  )
}

const AspInputGuardrailsPanel = ({
  controls,
  onControlsChange,
  products = [],
  productConstraints = {},
  onProductConstraintChange,
}) => {
  const dailyProducts = products.filter((item) => item.segmentKey === 'daily')
  const coreProducts = products.filter((item) => item.segmentKey === 'core')
  const premiumProducts = products.filter((item) => item.segmentKey === 'premium')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-base font-bold text-slate-800">Set constraints</h3>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Set the minimum gross margin</label>
        <div className="relative mt-1.5">
          <input
            type="number"
            min={20}
            max={60}
            step={1}
            value={controls.grossMarginPct}
            onChange={(event) => onControlsChange({ grossMarginPct: clamp(Number(event.target.value) || 0, 20, 60) })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm font-semibold text-slate-800 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">%</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <SegmentColumn
          title="Daily Casual"
          noChange={Boolean(controls.dailyNoChange)}
          onNoChangeChange={(value) => onControlsChange({ dailyNoChange: value })}
          maxDecrease={controls.dailyMaxDecrease}
          maxIncrease={controls.dailyMaxIncrease}
          onRangeChange={({ maxDecrease, maxIncrease }) => onControlsChange({ dailyMaxDecrease: maxDecrease, dailyMaxIncrease: maxIncrease })}
          products={dailyProducts}
          productConstraints={productConstraints}
          onProductConstraintChange={onProductConstraintChange}
        />

        <SegmentColumn
          title="Core Plus"
          noChange={Boolean(controls.coreNoChange)}
          onNoChangeChange={(value) => onControlsChange({ coreNoChange: value })}
          maxDecrease={controls.coreMaxDecrease}
          maxIncrease={controls.coreMaxIncrease}
          onRangeChange={({ maxDecrease, maxIncrease }) => onControlsChange({ coreMaxDecrease: maxDecrease, coreMaxIncrease: maxIncrease })}
          products={coreProducts}
          productConstraints={productConstraints}
          onProductConstraintChange={onProductConstraintChange}
        />

        <SegmentColumn
          title="Premium"
          noChange={Boolean(controls.premiumNoChange)}
          onNoChangeChange={(value) => onControlsChange({ premiumNoChange: value })}
          maxDecrease={controls.premiumMaxDecrease}
          maxIncrease={controls.premiumMaxIncrease}
          onRangeChange={({ maxDecrease, maxIncrease }) => onControlsChange({ premiumMaxDecrease: maxDecrease, premiumMaxIncrease: maxIncrease })}
          products={premiumProducts}
          productConstraints={productConstraints}
          onProductConstraintChange={onProductConstraintChange}
        />
      </div>
    </div>
  )
}

export default AspInputGuardrailsPanel
