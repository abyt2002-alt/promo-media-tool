import { Navigate, Route, Routes } from 'react-router-dom'
import PromoCalendarOptimisationApp from './pages/PromoCalendarOptimisationApp'

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/promo-calendar-optimisation?step=1" replace />} />
      <Route path="/promo-calendar-optimisation" element={<PromoCalendarOptimisationApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
