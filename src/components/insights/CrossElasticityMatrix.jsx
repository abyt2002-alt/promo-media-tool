const formatProductParts = (name) => {
  const [left, right] = String(name || '')
    .split('|')
    .map((part) => part.trim())
  return { left: left || name, right: right || '' }
}

const strengthLabel = (value) => {
  const abs = Math.abs(value)
  if (abs > 0.5) return 'Strong'
  if (abs < 0.3) return 'Low'
  return 'Medium'
}

const cellTone = (value) => {
  if (value == null) return 'bg-slate-100 text-slate-400'
  if (value === 0) return 'bg-white text-slate-300'
  if (value >= 0.35) return 'bg-emerald-200 text-emerald-900'
  if (value >= 0.25) return 'bg-emerald-100 text-emerald-800'
  if (value >= 0.15) return 'bg-emerald-50 text-emerald-700'
  return 'bg-slate-50 text-slate-600'
}

const ProductCellLabel = ({ name }) => {
  const parts = formatProductParts(name)
  return (
    <div className="whitespace-normal break-words leading-tight">
      <div className="font-medium text-slate-700">{parts.left}</div>
      {parts.right ? <div className="text-[10px] text-slate-500">{parts.right}</div> : null}
    </div>
  )
}

const CrossElasticityMatrix = ({
  matrix,
  selectedProduct,
  productOptions = [],
  onSelectedProductChange,
  visible = true,
}) => {
  if (!visible) {
    return <div className="panel p-4 text-sm text-slate-500">Cross elasticity view hidden by filter.</div>
  }

  const selectedRow = matrix.find((row) => row.productName === selectedProduct)
  const selectedColumnIndex = matrix.findIndex((row) => row.productName === selectedProduct)
  const focusedRows = (selectedRow?.cells || [])
    .filter((cell) => !cell.isSelf && cell.value !== 0 && cell.value != null)
    .map((cell) => ({
      otherProduct: cell.productName,
      crossElasticity: cell.value,
    }))
    .sort((a, b) => Math.abs(b.crossElasticity) - Math.abs(a.crossElasticity))

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-800">Cross Elasticity Matrix</h3>
        <div className="w-full max-w-xs">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Select Product
          </label>
          <select
            value={selectedProduct}
            onChange={(event) => onSelectedProductChange?.(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand.blue focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {productOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-200">
          <table
            className="border-collapse text-[11px]"
            style={{ minWidth: `${220 + matrix.length * 96}px`, width: 'max-content' }}
          >
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-56 border border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-700">
                  Product
                </th>
                {matrix.map((column, columnIndex) => (
                  <th
                    key={column.productName}
                    className={`sticky top-0 z-20 w-24 border border-slate-200 px-1 py-2 text-center align-top font-semibold ${
                      column.productName === selectedProduct ? 'bg-amber-100 text-amber-900' : 'bg-slate-50 text-slate-600'
                    }`}
                  >
                    <div className="mx-auto max-w-[76px] whitespace-normal break-words leading-tight">
                      <ProductCellLabel name={column.productName} />
                    </div>
                    <div className="sr-only">Column {columnIndex + 1}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.productName} className={row.productName === selectedProduct ? 'bg-amber-50/40' : ''}>
                  <td className="sticky left-0 z-10 w-56 border border-slate-200 bg-white px-2 py-2 align-top">
                    <ProductCellLabel name={row.productName} />
                  </td>
                  {row.cells.map((cell, cellIndex) => (
                    <td
                      key={`${row.productName}-${cell.productName}`}
                      className={`border border-slate-200 px-1 py-2 text-center font-semibold ${
                        cellIndex === selectedColumnIndex && row.productName !== selectedProduct ? 'ring-1 ring-inset ring-amber-200' : ''
                      } ${cellTone(cell.value)}`}
                    >
                      {cell.value == null ? '-' : cell.value.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-bold text-slate-800">Selected Product View</p>
            <p className="mt-0.5 text-xs text-slate-500">{selectedProduct}</p>
          </div>

          <div className="max-h-[560px] overflow-auto">
            {focusedRows.length === 0 ? (
              <div className="px-3 py-4 text-xs text-slate-500">No non-zero cross-elasticity relationships for this product.</div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Other Product</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Cross Elasticity</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Strength</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {focusedRows.map((row, index) => (
                    <tr key={row.otherProduct} className="bg-white">
                      <td className="px-3 py-2 text-slate-700">
                        <ProductCellLabel name={row.otherProduct} />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700">{row.crossElasticity.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {strengthLabel(row.crossElasticity)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{index + 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CrossElasticityMatrix
