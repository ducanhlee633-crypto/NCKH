import { useEffect, useRef, useState } from 'react'
import AppShell from './components/AppShell'
import AuthPage from './pages/AuthPage'
import { consumeEmailConfirmationCallback, displayUser, exchangeEmailConfirmationCode, fetchOnboardingStatus, fetchPreferences, fetchProfile, getSession, initSessionSync, logoutUser, onSessionChange, saveSessionFromHashTokens, updateSessionProfile } from './backendApi'
import './styles/app-shell.css'
import './styles/shared-components.css'
import './styles/schedule.css'
import './styles/roadmap.css'
import './styles/stats.css'
import './styles/ai-assistant.css'
import './styles/ai-widget.css'
import './styles/pomodoro.css'
import './styles/weekly-tasks.css'
import './styles/settings.css'
import './styles/community.css'
import './styles/responsive.css'
import { navigationItems, utilityItems } from './data/navigation'
import DashboardPage from './pages/DashboardPage'
import SchedulePage from './pages/SchedulePage'
import WeeklyTasksPage from './pages/WeeklyTasksPage'
import AIAssistantPage from './pages/AIAssistantPage'
import AiAssistantWidget from './components/AiAssistantWidget'
import PomodoroPage from './pages/PomodoroPage'
import RoadmapPage from './pages/RoadmapPage'
import StatsPage from './pages/StatsPage'
import WellbeingPage from './pages/WellbeingPage'
import FriendsPage from './pages/FriendsPage'
import SettingsPage from './pages/SettingsPage'
import HelpPage from './pages/HelpPage'
import GoalsPage from './pages/GoalsPage'
import OnboardingPage from './pages/OnboardingPage'
import './styles/goals.css'
import './styles/onboarding.css'
import './styles/student-design.css'
import './styles/mobile-app.css'
import { applySettings, loadSettings, persistSettings } from './data/settings'

const pageMap = {
  dashboard: DashboardPage,
  schedule: SchedulePage,
  'weekly-tasks': WeeklyTasksPage,
  weekly: WeeklyTasksPage,
  assistant: AIAssistantPage,
  pomodoro: PomodoroPage,
  roadmap: RoadmapPage,
  goals: GoalsPage,
  goal: GoalsPage,
  stats: StatsPage,
  wellbeing: WellbeingPage,
  friends: FriendsPage,
  settings: SettingsPage,
  help: HelpPage,
}


function initialRoute() {
  return window.location.hash.slice(1) || 'dashboard'
}

/** Tách query khỏi hash route: 'login?verified=1' -> { path: 'login', query }. */
function parseRoute(raw) {
  const [path, queryString] = String(raw || '').split('?')
  return { path: path || 'dashboard', query: new URLSearchParams(queryString || '') }
}

export default function App() {
  const [route, setRoute] = useState(initialRoute)
  const [session, setSession] = useState(getSession)
  const [sessionReady, setSessionReady] = useState(false)
  const [onboarding, setOnboarding] = useState(null)
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  // Kết quả link xác nhận email (Supabase đáp về `/?verified=1...`).
  const [authCallback, setAuthCallback] = useState(null)
  const codeExchangedRef = useRef(false)
  const { path: routePath, query: routeQuery } = parseRoute(route)
  const verifiedFlag = routeQuery.get('verified') === '1'
  const [requestedPage, section] = routePath.split('/')
  const sessionUserId = session?.user?.id
  const authPage = ['auth', 'login', 'register', 'forgot', 'landing'].includes(requestedPage)
  const page = session ? (authPage ? 'dashboard' : requestedPage) : (requestedPage === 'register' ? 'register' : requestedPage === 'forgot' ? 'forgot' : 'login')
  // Route chi tiết lộ trình: #roadmap/:id -> vẫn dùng RoadmapPage nhưng truyền detailId.
  const roadmapDetailId = requestedPage === 'roadmap' ? section : null

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

  // Link xác nhận email (Supabase đáp về `/?verified=1...`): tự đăng nhập rồi
  // App đẩy tiếp vào onboarding khi chưa xong — bấm xác nhận là vào onboarding.
  useEffect(() => {
    const result = consumeEmailConfirmationCallback()
    if (result.kind === 'none') return
    if (result.kind === 'session') {
      const saved = saveSessionFromHashTokens(result)
      if (saved) {
        setSession(getSession())
        setAuthCallback({ kind: 'session' })
        navigate('dashboard')
        // Nạp profile để tên hiển thị đúng ngay lần đầu vào onboarding.
        fetchProfile().then(updateSessionProfile).catch(() => {})
      } else {
        setAuthCallback({ kind: 'error', description: '' })
      }
      return
    }
    if (result.kind === 'code') {
      if (codeExchangedRef.current) return
      codeExchangedRef.current = true
      setAuthCallback({ kind: 'code' })
      exchangeEmailConfirmationCode(result.code)
        .then(() => {
          setSession(getSession())
          setAuthCallback({ kind: 'session' })
          navigate('dashboard')
        })
        .catch((failure) => setAuthCallback({ kind: 'error', description: failure.friendlyMessage || '' }))
      return
    }
    if (result.kind === 'verified') {
      setAuthCallback({ kind: 'verified' })
      navigate('login?verified=1')
      return
    }
    if (result.kind === 'error') {
      setAuthCallback({ kind: 'error', description: result.description || '' })
      navigate('login')
    }
  }, [])

  useEffect(() => {
    const handleHashChange = () => setRoute(initialRoute())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Onboarding bắt buộc: đã đăng nhập mà thiếu lớp / <3 goals / chưa có preferences
  // thì chặn toàn bộ app cho tới khi xong. Thoát giữa chừng -> lần sau vào lại
  // status.next_step vẫn thiếu nên hiện lại đúng bước dở.
  useEffect(() => {
    if (!sessionReady || !session) {
      setOnboarding(null)
      return
    }
    let cancelled = false
    setOnboardingLoading(true)
    fetchOnboardingStatus()
      .then((fresh) => { if (!cancelled) setOnboarding(fresh) })
      .catch(() => { if (!cancelled) setOnboarding({ completed: true }) })
      .finally(() => { if (!cancelled) setOnboardingLoading(false) })
    return () => { cancelled = true }
  }, [sessionReady, sessionUserId])
  // Áp theme/color từ server ngay khi vừa đăng nhập, không đợi vào SettingsPage.
  // Trước đây chỉ main.jsx apply local 1 lần + SettingsPage mới fetch server,
  // nên mỗi lần reload đều hiện sai theme cho tới khi bấm vào Cài đặt.
  useEffect(() => {
    if (!sessionReady || !session) return
    let cancelled = false
    fetchPreferences()
      .then((remote) => {
        if (cancelled || !remote) return
        const merged = { ...loadSettings(), ...remote }
        persistSettings(merged)
        applySettings(merged)
      })
      .catch(() => { /* giữ bản local khi chưa có preferences / lỗi mạng */ })
    return () => { cancelled = true }
  }, [sessionReady, sessionUserId])

  useEffect(() => {
    const title = ({ login: 'Đăng nhập', register: 'Đăng ký', forgot: 'Quên mật khẩu' })[page] || [...navigationItems, ...utilityItems].find((item) => item.path === page)?.label
    document.title = ((roadmapDetailId ? 'Chi tiết lộ trình' : title) || 'Không tìm thấy trang') + ' · Nhịp Học'
    if (section && !roadmapDetailId) document.getElementById(section)?.scrollIntoView({ block: 'start' })
    else if (!roadmapDetailId) window.scrollTo({ top: 0, behavior: 'instant' })
    document.querySelector('main')?.focus({ preventScroll: true })
  }, [page, section, roadmapDetailId])

  const navigate = (nextPage) => {
    setRoute(nextPage)
    window.location.hash = nextPage
  }

  async function handleLogout() {
    await logoutUser()
    setOnboarding(null)
    navigate('login')
  }

  if (!sessionReady) return <main className="auth-page"><p>Đang tải…</p></main>
  if (!session) {
    // Đang đổi `code` xác nhận mail lấy session -> chờ xong mới hiện form.
    if (authCallback?.kind === 'code') return <main className="auth-page"><p>Đang xác nhận email…</p></main>
    const callbackError = authCallback?.kind === 'error'
      ? (authCallback.description || 'Liên kết xác nhận không hợp lệ hoặc đã hết hạn.')
      : ''
    const justVerified = verifiedFlag || authCallback?.kind === 'verified'
    return <AuthPage key={`${page}${justVerified ? '?verified=1' : ''}`} mode={page} verified={justVerified} callbackError={callbackError} onNavigate={navigate} />
  }
  if (onboardingLoading) return <main className="auth-page"><p>Đang kiểm tra onboarding…</p></main>
  if (onboarding && !onboarding.completed) {
    return <OnboardingPage initialStatus={onboarding} onLogout={handleLogout} onDone={(fresh) => { setOnboarding(fresh?.completed ? fresh : { completed: true }); navigate('dashboard') }} />
  }

  const Page = pageMap[page]
  // Giữ Phòng tập trung luôn mounted (ẩn bằng hidden khi ở page khác) để
  // timer đếm nền: chuyển tab giữa các page không reset đồng hồ, hết giờ vẫn
  // tự cộng phiên + lưu server đúng lúc. Nội dung ẩn nên không ảnh hưởng a11y.
  const pomodoroHidden = page !== 'pomodoro'
  return (
    <AppShell currentPage={page} onNavigate={navigate} user={displayUser(session)} onLogout={handleLogout}>
      <div className="focus-keepalive" hidden={pomodoroHidden || undefined} aria-hidden={pomodoroHidden || undefined}>
        <PomodoroPage onNavigate={navigate} />
      </div>
      {pomodoroHidden && (Page ? <Page onNavigate={navigate} detailId={roadmapDetailId} /> : (
        <section className="dashboard-card not-found">
          <span aria-hidden="true">🧭</span>
          <h1>Trang này hơi lạc nhịp rồi!</h1>
          <p>Quay lại không gian học tập để tiếp tục nhé.</p>
          <a className="primary-button" href="#dashboard">Về góc học tập</a>
        </section>
      ))}
      <AiAssistantWidget />
    </AppShell>
  )
}
