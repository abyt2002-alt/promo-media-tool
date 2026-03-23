import { Link, useLocation } from 'react-router-dom'

const steps = [
  { key: '1', label: 'Historical Promo Calendar' },
  { key: '2', label: 'Insights' },
  { key: '3', label: 'Promo Calendar' },
]

const PromoStepTabs = ({ currentStep = '1' }) => {
  const location = useLocation()
  const path = location.pathname || '/'

  return (
    <div className="panel p-3">
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => {
          const active = step.key === String(currentStep)
          return (
            <Link
              key={step.key}
              to={`${path}?step=${step.key}`}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              {step.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default PromoStepTabs
