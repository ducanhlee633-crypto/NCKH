import { useEffect, useState } from 'react'
import AppShell from './components/AppShell'
import AuthPage from './pages/AuthPage'
import { displayUser, getSession, initSessionSync, logoutUser, onSessionChange } from './backendApi'
import './styles/app-shell.css'
import './styles/shared-components.css'
import './styles/schedule.css'
import './styles/roadmap.css'
import './styles/stats.css'
import './styles/ai-assistant.css'
import './styles/pomodoro.css'
import './styles/settings.css'
import './styles/community.css'
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
import GoalsPage from './pages/GoalsPage'
import './styles/goals.css'
import './styles/student-design.css'

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


function initialRoute() {
  return window.location.hash.slice(1) || 'dashboard'
}

export default function App() {
  const [route, setRoute] = useState(initialRoute)
  const [session, setSession] = useState(getSession)
  const [sessionReady, setSessionReady] = useState(false)
  const [requestedPage, section] = route.split('/')
  const authPage = ['auth', 'login', 'register', 'forgot', 'landing'].includes(requestedPage)
  const page = session ? (authPage ? 'dashboard' : requestedPage) : (requestedPage === 'register' ? 'register' : requestedPage === 'forgot' ? 'forgot' : 'login')

  useEffect(() => {
    const stopSync = initSessionSync()
    const stopListening = onSessionChange(() => {
      setSession(getSession())
      setSessionReady(true)
    })
    // Trường hợp Supabase chưa cấu hình: vẫn cho render màn hình auth.
    const timer = window.setTimeout(() => setSessionReady(true), 3000)
    return () => {
      stopSync()
      stopListening()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const handleHashChange = () => setRoute(initialRoute())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const title = ({ login: 'Đăng nhập', register: 'Đăng ký', forgot: 'Quên mật khẩu' })[page] || [...navigationItems, ...utilityItems].find((item) => item.path === page)?.label
    document.title = (title || 'Không tìm thấy trang') + ' · Nhịp Học'
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
    document.querySelector('main')?.focus({ preventScroll: true })
  }, [page, section])

  const navigate = (nextPage) => {
    setRoute(nextPage)
    window.location.hash = nextPage
  }

  async function handleLogout() {
    await logoutUser()
    navigate('login')
  }

  if (!sessionReady) return <main className="auth-page"><p>Đang tải…</p></main>
  if (!session) return <AuthPage key={page} mode={page} onNavigate={navigate} />

  const Page = pageMap[page]
  return (
    <AppShell currentPage={page} onNavigate={navigate} user={displayUser(session)} onLogout={handleLogout}>
      {Page ? <Page onNavigate={navigate} /> : (
        <section className="dashboard-card not-found">
          <span aria-hidden="true">🧭</span>
          <h1>Trang này hơi lạc nhịp rồi!</h1>
          <p>Quay lại không gian học tập để tiếp tục nhé.</p>
          <a className="primary-button" href="#dashboard">Về góc học tập</a>
        </section>
      )}
    </AppShell>
  )
}
