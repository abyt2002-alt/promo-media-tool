import { Link, useLocation } from 'react-router-dom'
import {
  BarChart3,
  CalendarDays,
  Home,
  LineChart,
  Menu,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useState } from 'react'

const defaultNavigation = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Brand Ladder', href: '/portfolio?step=1', icon: BarChart3, step: '1' },
  { name: 'Insights', href: '/portfolio?step=2', icon: SlidersHorizontal, step: '2' },
  { name: 'Base Ladder Detection', href: '/portfolio?step=3', icon: LineChart, step: '3' },
  { name: 'Promo Calendar', href: '/portfolio?step=4', icon: CalendarDays, step: '4' },
]

const AppLayout = ({
  children,
  rightSidebar,
  appTitle = 'Price Ladder Optimization',
  navigationItems = defaultNavigation,
}) => {
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  const stepParam = new URLSearchParams(location.search).get('step') || '1'

  const isNavActive = (item) => {
    if (item.href === '/') {
      return location.pathname === '/'
    }

    if (item.step) {
      return location.pathname === '/portfolio' && stepParam === item.step
    }

    return location.pathname === item.href
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
      <header className="z-30 flex-shrink-0 border-b border-slate-200 bg-white shadow-sm">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <BarChart3 className="h-8 w-8 text-brand.blue" />
              <h1 className="ml-3 text-lg font-bold text-slate-800 sm:text-xl">{appTitle}</h1>
            </div>

            <div className="flex items-center gap-2 lg:hidden">
              {rightSidebar && (
                <button
                  onClick={() => setIsMobileSidebarOpen((prev) => !prev)}
                  className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Settings className="h-6 w-6" />
                </button>
              )}
              <button
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="border-t border-slate-200 lg:hidden">
            <nav className="space-y-1 px-2 pb-3 pt-2">
              {navigationItems.map((item) => {
                const Icon = item.icon
                const isActive = isNavActive(item)
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center rounded-md px-3 py-2 text-base font-medium ${
                      isActive
                        ? 'border border-brand.blue bg-blue-50 text-brand.blue'
                        : 'border border-transparent text-slate-700 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <Icon className="mr-3 h-5 w-5" />
                    {item.name}
                  </Link>
                )
              })}
            </nav>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white lg:block">
          <div className="h-full overflow-y-auto">
            <nav className="space-y-1 p-4">
              {navigationItems.map((item) => {
                const Icon = item.icon
                const isActive = isNavActive(item)

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border border-brand.blue bg-blue-50 text-brand.blue'
                        : 'border border-transparent text-slate-700 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <Icon className="mr-3 h-5 w-5" />
                    {item.name}
                  </Link>
                )
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
        </main>

        {rightSidebar && (
          <>
            <aside className="hidden w-80 flex-shrink-0 border-l border-slate-200 bg-white lg:block">
              <div className="flex h-full flex-col">
                <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-white p-4">
                  <Settings className="h-5 w-5 text-brand.blue" />
                  <h2 className="text-lg font-semibold text-slate-800">Settings</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4">{rightSidebar}</div>
              </div>
            </aside>

            {isMobileSidebarOpen && (
              <div className="fixed inset-0 z-40 lg:hidden">
                <div
                  className="absolute inset-0 bg-slate-900/40"
                  onClick={() => setIsMobileSidebarOpen(false)}
                />
                <div className="absolute bottom-0 right-0 top-0 flex w-full max-w-sm flex-col bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-brand.blue" />
                      <h2 className="text-lg font-semibold text-slate-800">Settings</h2>
                    </div>
                    <button
                      onClick={() => setIsMobileSidebarOpen(false)}
                      className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">{rightSidebar}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AppLayout
