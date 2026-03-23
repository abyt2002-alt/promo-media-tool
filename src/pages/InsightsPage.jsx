import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import CrossElasticityMatrix from '../components/insights/CrossElasticityMatrix'
import DemandCurveChart from '../components/insights/DemandCurveChart'
import ElasticitySummaryCards from '../components/insights/ElasticitySummaryCards'
import InsightsSidebar from '../components/insights/InsightsSidebar'
import RevenueCurveChart from '../components/insights/RevenueCurveChart'
import AppLayout from '../components/layout/AppLayout'
import {
  buildPortfolioElasticityBands,
  buildInsightsPayload,
  formatYearMonthLabel,
  getInsightsMonths,
  getProductOptions,
} from '../utils/insightsUtils'

const InsightsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  const monthOptions = useMemo(() => getInsightsMonths(), [])
  const latestMonth = monthOptions[monthOptions.length - 1]

  const monthParam = searchParams.get('iMonth')
  const selectedMonth = monthOptions.includes(monthParam) ? monthParam : latestMonth

  const productOptions = useMemo(() => getProductOptions(selectedMonth), [selectedMonth])
  const productParam = searchParams.get('iProduct')
  const selectedProduct = productOptions.includes(productParam) ? productParam : productOptions[0]
  const crossProductParam = searchParams.get('iCrossProduct')
  const selectedCrossProduct = productOptions.includes(crossProductParam)
    ? crossProductParam
    : selectedProduct

  const curveRange = 'standard'
  const sensitivity = 'base'

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let dirty = false

    if (next.get('step') !== '2') {
      next.set('step', '2')
      dirty = true
    }

    if (!next.get('iMonth') && latestMonth) {
      next.set('iMonth', latestMonth)
      dirty = true
    }

    if (!next.get('iProduct') && productOptions[0]) {
      next.set('iProduct', productOptions[0])
      dirty = true
    }

    const nextCrossProduct = next.get('iCrossProduct')
    if (!nextCrossProduct || !productOptions.includes(nextCrossProduct)) {
      if (productOptions[0]) {
        next.set('iCrossProduct', productOptions[0])
      } else {
        next.delete('iCrossProduct')
      }
      dirty = true
    }

    if (dirty) {
      setSearchParams(next, { replace: true })
    }
  }, [latestMonth, productOptions, searchParams, setSearchParams])

  const setParams = (patch) => {
    const next = new URLSearchParams(searchParams)

    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
    })

    next.set('step', '2')
    setSearchParams(next)
  }

  const payload = useMemo(
    () =>
      buildInsightsPayload({
        yearMonth: selectedMonth,
        productName: selectedProduct,
        curveRange,
        sensitivity,
      }),
    [selectedMonth, selectedProduct, curveRange, sensitivity],
  )

  const portfolioElasticityBands = useMemo(
    () => buildPortfolioElasticityBands(payload.monthRows, sensitivity),
    [payload.monthRows, sensitivity],
  )

  const rightSidebar = (
    <InsightsSidebar
      month={selectedMonth}
      monthOptions={monthOptions}
      product={selectedProduct}
      productOptions={productOptions}
      onMonthChange={(value) => {
        const nextProductOptions = getProductOptions(value)
        const nextProduct = nextProductOptions.includes(selectedProduct)
          ? selectedProduct
          : nextProductOptions[0]
        const nextCrossProduct = nextProductOptions.includes(selectedCrossProduct)
          ? selectedCrossProduct
          : nextProduct
        setParams({ iMonth: value, iProduct: nextProduct, iCrossProduct: nextCrossProduct })
      }}
      onProductChange={(value) => setParams({ iProduct: value })}
      portfolioElasticityBands={portfolioElasticityBands}
      onReset={() =>
        setParams({
          iMonth: latestMonth,
          iProduct: getProductOptions(latestMonth)[0],
          iCrossProduct: getProductOptions(latestMonth)[0],
        })
      }
    />
  )

  return (
    <AppLayout rightSidebar={rightSidebar}>
      <div className="space-y-5">
        <div className="panel p-5">
          <h2 className="text-3xl font-bold text-slate-800">Insights</h2>
          <p className="mt-2 max-w-4xl text-sm font-medium text-slate-600">
            Analyze demand response, revenue behavior, and product interactions across the portfolio.
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Product: {selectedProduct} | Week: {formatYearMonthLabel(selectedMonth)}
          </p>
        </div>

        <ElasticitySummaryCards
          anchorRow={payload.anchorRow}
          ownElasticity={payload.ownElasticity}
          currentPointElasticity={payload.currentPointElasticity}
          revenueCurrent={payload.revenueCurve.currentPoint.revenue}
          revenueMax={payload.revenueCurve.maxRevenuePoint.revenue}
          revenueMaxPrice={payload.revenueCurve.maxRevenuePoint.price}
          volumeAtRevenueMax={payload.revenueCurve.maxRevenuePoint.predictedDemand}
        />

        <div className="grid grid-cols-1 items-stretch gap-5 2xl:grid-cols-2">
          <DemandCurveChart
            points={payload.demandCurve}
            currentPoint={payload.revenueCurve.currentPoint}
            maxRevenuePrice={payload.revenueCurve.maxRevenuePoint.price}
            visible
          />

          <RevenueCurveChart
            points={payload.revenueCurve.points}
            currentPoint={payload.revenueCurve.currentPoint}
            maxPoint={payload.revenueCurve.maxRevenuePoint}
            visible
          />
        </div>

        <CrossElasticityMatrix
          matrix={payload.matrix}
          selectedProduct={selectedCrossProduct}
          productOptions={productOptions}
          onSelectedProductChange={(value) => setParams({ iCrossProduct: value })}
          visible
        />
      </div>
    </AppLayout>
  )
}

export default InsightsPage
