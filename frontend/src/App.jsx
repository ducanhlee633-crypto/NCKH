import { useEffect, useState } from 'react'
import AppShell from './components/AppShell'
import './styles/app-shell.css'
import './styles/shared-components.css'
import './styles/schedule.css'
import './styles/roadmap.css'
import './styles/stats.css'
import './styles/ai-assistant.css'
import './styles/pomodoro.css'
import './styles/settings.css'
import './styles/community.css'
import './styles/public-pages.css'
import './styles/responsive.css'
import { navigationItems, utilityItems } from './data/navigation'
import DashboardPage from './pages/DashboardPage'
import SchedulePage from './pages/SchedulePage'
import AIAssistantPage from './pages/AIAssistantPage'
import PomodoroPage from './pages/PomodoroPage'
import RoadmapPage from './pages/RoadmapPage'
import StatsPage from './pages/StatsPage'
import FriendsPage from './pages/FriendsPage'
import SettingsPage from './pages/SettingsPage'
import HelpPage from './pages/HelpPage'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import GoalsPage from './pages/GoalsPage'
import './styles/goals.css'

const pageMap = {
  dashboard: DashboardPage,
  schedule: SchedulePage,
  assistant: AIAssistantPage,
  pomodoro: PomodoroPage,
  roadmap: RoadmapPage,
  goals: GoalsPage,
  goal: GoalsPage,
  stats: StatsPage,
  friends: FriendsPage,
  settings: SettingsPage,
  help: HelpPage,
}

const publicTitles = { landing: 'Học nhẹ nhàng, đúng nhịp', login: 'Đăng nhập', register: 'Tạo tài khoản' }

function initialRoute() {
  return window.location.hash.slice(1) || 'dashboard'
}

export default function App() {
  const [route, setRoute] = useState(initialRoute)
  const [page, section] = route.split('/')

  useEffect(() => {
    const handleHashChange = () => setRoute(initialRoute())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const title = [...navigationItems, ...utilityItems].find((item) => item.path === page)?.label
    document.title = (title || publicTitles[page] || 'Không tìm thấy trang') + ' · Nhịp Học'
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
    document.querySelector('main')?.focus({ preventScroll: true })
  }, [page, section])

  const navigate = (nextPage) => { window.location.hash = nextPage }

  if (page === 'landing') return <LandingPage onNavigate={navigate} />
  if (page === 'login' || page === 'register') return <AuthPage mode={page} key={page} onNavigate={navigate} />

  const Page = pageMap[page]
  return (
    <AppShell currentPage={page} onNavigate={navigate}>
      {Page ? <Page onNavigate={navigate} /> : (
        <section className="dashboard-card not-found">
          <span aria-hidden="true">🧭</span>
          <h1>Trang này hơi lạc nhịp rồi!</h1>
          <p>Quay lại không gian học tập để tiếp tục nhé.</p>
          <a className="primary-button" href="#dashboard">Về tổng quan</a>
        </section>
      )}
    </AppShell>
  )
}
