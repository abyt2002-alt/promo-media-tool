import { CalendarDays, LineChart, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import HistoricalPromoCalendarPage from './HistoricalPromoCalendarPage'
import PromoElasticityInsightsPage from './PromoElasticityInsightsPage'
import PromoCalendarPage from './PromoCalendarPage'

const standaloneNavigation = [
  { name: 'Historical Promo Calendar', href: '/promo-calendar-optimisation?step=1', icon: CalendarDays },
  { name: 'Insights', href: '/promo-calendar-optimisation?step=2', icon: SlidersHorizontal },
  { name: 'Promo Calendar', href: '/promo-calendar-optimisation?step=3', icon: LineChart },
]

const PromoCalendarOptimisationApp = () => {
  const [searchParams] = useSearchParams()
  const step = searchParams.get('step') || '1'
  const layoutProps = {
    appTitle: 'Promo Calendar Optimisation',
    navigationItems: standaloneNavigation,
  }

  if (step === '2') {
    return <PromoElasticityInsightsPage layoutProps={layoutProps} />
  }
  if (step === '3') {
    return <PromoCalendarPage layoutProps={layoutProps} />
  }

  return (
    <HistoricalPromoCalendarPage layoutProps={layoutProps} />
  )
}

export default PromoCalendarOptimisationApp
