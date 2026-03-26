import { useEffect, useMemo, useRef, useState } from 'react'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizeSkuLabel = (value) =>
  String(value ?? '')
    .replace(/\|/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim()

const FILTER_SKU_TABLE_GRID = 'grid grid-cols-[minmax(220px,1.5fr)_minmax(78px,92px)_84px_84px_84px] gap-2'

const NumberInput = ({ label, value, onChange, min = -100, max = 500, step = 1, suffix = '%' }) => {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="relative">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChange('')
              return
            }
            const next = Number(raw)
            onChange(Number.isFinite(next) ? next : '')
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm font-medium text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder=""
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  )
}

const ProductFilterTable = ({
  products = [],
  productConstraints = {},
  onProductConstraintChange,
}) => {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[548px] max-h-[280px] overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        <div
          className={`${FILTER_SKU_TABLE_GRID} sticky top-0 z-10 border-b border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500`}
        >
          <span>SKU</span>
          <span className="text-right leading-tight">Base Price</span>
          <span className="text-center">No Chg</span>
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
            <div key={key} className={`${FILTER_SKU_TABLE_GRID} items-start gap-2 px-2 py-1.5`}>
              <span className="min-w-0 whitespace-normal break-words text-[12px] font-medium leading-snug text-slate-800" title={displaySku}>
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

const AspScenarioFiltersPanel = ({
  controls,
  onControlsChange,
  products = [],
  productConstraints = {},
  onProductConstraintChange,
  onResetProductConstraints,
}) => {
  const [query, setQuery] = useState('')
  const [isProductFilterOpen, setIsProductFilterOpen] = useState(false)
  const productFilterRef = useRef(null)

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter((item) => String(item.productName || '').toLowerCase().includes(q))
  }, [products, query])

  useEffect(() => {
    if (!isProductFilterOpen) return undefined

    const handleOutsidePointer = (event) => {
      if (!productFilterRef.current) return
      if (!productFilterRef.current.contains(event.target)) {
        setIsProductFilterOpen(false)
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsProductFilterOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsidePointer)
    document.addEventListener('touchstart', handleOutsidePointer)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer)
      document.removeEventListener('touchstart', handleOutsidePointer)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isProductFilterOpen])

  return (
    <div className="panel p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Filter scenarios</p>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <NumberInput
          label="Min Volume % Increase"
          value={controls.minVolumeUpliftPct}
          min={-100}
          max={500}
          step={1}
          onChange={(value) => onControlsChange({ minVolumeUpliftPct: value })}
        />
        <NumberInput
          label="Min Revenue % Increase"
          value={controls.minRevenueUpliftPct}
          min={-100}
          max={500}
          step={1}
          onChange={(value) => onControlsChange({ minRevenueUpliftPct: value })}
        />
        <NumberInput
          label="Min Gross Margin % Increase"
          value={controls.minProfitUpliftPct}
          min={-100}
          max={500}
          step={1}
          onChange={(value) => onControlsChange({ minProfitUpliftPct: value })}
        />
      </div>

      <div ref={productFilterRef} className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        <button
          type="button"
          onClick={() => setIsProductFilterOpen((prev) => !prev)}
          className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-700"
        >
          <span>SKU-level filters</span>
          <span>{isProductFilterOpen ? '▾' : '▸'}</span>
        </button>

        {isProductFilterOpen ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search SKU..."
                className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button
                type="button"
                onClick={onResetProductConstraints}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
            <ProductFilterTable
              products={filteredProducts}
              productConstraints={productConstraints}
              onProductConstraintChange={onProductConstraintChange}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

export default AspScenarioFiltersPanel
