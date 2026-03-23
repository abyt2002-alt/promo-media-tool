import { Navigate, Route, Routes } from 'react-router-dom'
import PromoCalendarOptimisationApp from './pages/PromoCalendarOptimisationApp'

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<PromoCalendarOptimisationApp />} />
      <Route path="/promo-calendar-optimisation" element={<PromoCalendarOptimisationApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
