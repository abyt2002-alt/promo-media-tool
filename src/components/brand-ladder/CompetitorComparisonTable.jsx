const CompetitorComparisonTable = ({ rows, title }) => {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      </div>

      <div className="max-h-80 overflow-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Brand</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Product</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Current Price</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Volume</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Distribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={`${row.brandName}-${row.productName}`}>
                <td className="px-3 py-2 text-slate-700">{row.brandName}</td>
                <td className="px-3 py-2 text-slate-700">{row.productName}</td>
                <td className="px-3 py-2 text-right text-slate-700">{row.currentPrice}</td>
                <td className="px-3 py-2 text-right text-slate-700">{row.volume.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-700">{row.distribution}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CompetitorComparisonTable
