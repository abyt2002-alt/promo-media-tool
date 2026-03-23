import { CalendarDays } from 'lucide-react'
import PromoCalendarPage from './PromoCalendarPage'

const standaloneNavigation = [
  { name: 'Promo Calendar', href: '/promo-calendar-optimisation', icon: CalendarDays },
]

const PromoCalendarOptimisationApp = () => {
  return (
    <PromoCalendarPage
      layoutProps={{
        appTitle: 'Promo Calendar Optimisation',
        navigationItems: standaloneNavigation,
      }}
    />
  )
}

export default PromoCalendarOptimisationApp

