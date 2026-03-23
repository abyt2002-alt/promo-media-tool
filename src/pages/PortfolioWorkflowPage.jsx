import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import BrandLadderChart from '../components/brand-ladder/BrandLadderChart'
import BrandLadderSidebar from '../components/brand-ladder/BrandLadderSidebar'
import AppLayout from '../components/layout/AppLayout'
import AspDeterminationPage from './AspDeterminationPage'
import InsightsPage from './InsightsPage'
import PromoCalendarPage from './PromoCalendarPage'
import {
  ownBrandMonthlyData,
} from '../data/portfolioMockData'
import {
  computeMonthSummary,
  formatYearMonthLabel,
  getAvailableMonths,
  prepareOwnCompareViewData,
} from '../utils/brandLadderUtils'

const PlaceholderStep = ({ step }) => {
  return (
    <div className="panel p-8">
      <h2 className="text-xl font-semibold text-slate-800">Step {step} Placeholder</h2>
      <p className="mt-2 text-slate-600">
        Only Step 1 (Brand Ladder) is implemented in this milestone. Other steps are intentionally placeholders.
      </p>
    </div>
  )
}

const PortfolioWorkflowPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  const monthOptions = useMemo(() => getAvailableMonths(ownBrandMonthlyData), [])
  const latestMonth = monthOptions[monthOptions.length - 1]

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let dirty = false

    if (!searchParams.get('step')) {
      next.set('step', '1')
      dirty = true
      if (!next.get('month1') && latestMonth) {
        next.set('month1', latestMonth)
      }
      if (!next.get('showVolume')) {
        next.set('showVolume', '1')
      }
    }

    if (next.has('competitor')) {
      next.delete('competitor')
      dirty = true
    }

    if (next.has('brand')) {
      next.delete('brand')
      dirty = true
    }

    if (dirty) {
      setSearchParams(next, { replace: true })
    }
  }, [latestMonth, searchParams, setSearchParams])

  const step = searchParams.get('step') || '1'

  const reverseMonths = [...monthOptions].reverse()
  const month1Param = searchParams.get('month1')
  const month1 = monthOptions.includes(month1Param) ? month1Param : latestMonth

  const compareMonth = searchParams.get('compareMonth') === '1'
  const defaultMonth2 = reverseMonths.find((monthKey) => monthKey !== month1) || month1
  const month2Param = searchParams.get('month2')
  const month2 = monthOptions.includes(month2Param) ? month2Param : defaultMonth2

  const showVolume = searchParams.get('showVolume') !== '0'

  const setParams = (patch) => {
    const next = new URLSearchParams(searchParams)

    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
    })

    if (!next.get('step')) {
      next.set('step', '1')
    }

    setSearchParams(next)
  }

  const { month1Rows, month2Rows } = useMemo(
    () => prepareOwnCompareViewData(ownBrandMonthlyData, month1, month2),
    [month1, month2],
  )

  const month1Summary = useMemo(() => computeMonthSummary(month1Rows), [month1Rows])

  const rightSidebar = (
    <BrandLadderSidebar
      monthOptions={monthOptions}
      month1={month1}
      month2={month2}
      compareMonth={compareMonth}
      showVolume={showVolume}
      summary={month1Summary}
      onMonth1Change={(value) => {
        const nextMonth2 = value === month2 ? reverseMonths.find((monthKey) => monthKey !== value) || value : month2
        setParams({ month1: value, month2: nextMonth2 })
      }}
      onMonth2Change={(value) => setParams({ month2: value })}
      onCompareMonthChange={(value) => {
        if (value) {
          const safeMonth2 = month2 === month1 ? defaultMonth2 : month2
          setParams({ compareMonth: '1', month2: safeMonth2 })
          return
        }

        setParams({ compareMonth: '0', month2: null })
      }}
      onShowVolumeChange={(value) => setParams({ showVolume: value ? '1' : '0' })}
      onReset={() =>
        setParams({
          step: '1',
          month1: latestMonth,
          compareMonth: '0',
          month2: null,
          showVolume: '1',
        })
      }
    />
  )

  if (step === '2') {
    return <InsightsPage />
  }

  if (step === '3') {
    return <AspDeterminationPage />
  }

  if (step === '4') {
    return <PromoCalendarPage />
  }

  if (step !== '1') {
    return (
      <AppLayout>
        <PlaceholderStep step={step} />
      </AppLayout>
    )
  }

  return (
    <AppLayout rightSidebar={rightSidebar}>
      <div className="space-y-5">
        <div className="panel p-5">
          <h2 className="text-2xl font-semibold text-slate-800">Brand Ladder</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Full portfolio ladder at Brand x PPG level using base price positioning.
          </p>
        </div>

        <div className="space-y-5">
          <BrandLadderChart
            data={month1Rows}
            title={`Portfolio Ladder - ${formatYearMonthLabel(month1)}`}
            showVolume={showVolume}
          />

          {compareMonth && (
            <BrandLadderChart
              data={month2Rows}
              title={`Portfolio Ladder - ${formatYearMonthLabel(month2)}`}
              showVolume={showVolume}
            />
          )}
        </div>
      </div>
    </AppLayout>
  )
}

export default PortfolioWorkflowPage
