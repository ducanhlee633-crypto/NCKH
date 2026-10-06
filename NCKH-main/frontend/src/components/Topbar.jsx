import { useEffect, useState } from 'react'
import useStoredState from '../data/useStoredState'
import { defaultSettings, gradeLabel } from '../data/settings'
import { getSession, onSessionChange } from '../backendApi'
import { formatClock, readFocusTimer, remainingFromDeadline, subscribeFocusTimer } from '../data/focusTimer'
import { navigationItems, utilityItems } from '../data/navigation'
import Icon from './Icon'

// Badge mini hiện đồng hồ tập trung đang đếm nền khi user ở page khác.
// Bấm vào để quay về Phòng tập trung. Tự ẩn khi timer dừng/hết giờ.
function FocusTimerBadge({ onNavigate }) {
  const [timer, setTimer] = useState(readFocusTimer)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => subscribeFocusTimer(() => setTimer(readFocusTimer())), [])
  useEffect(() => {
    if (!timer?.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer?.running])
  if (!timer?.running || !timer.deadline) return null
  const seconds = remainingFromDeadline(timer.deadline, now)
  if (seconds <= 0) return null
  const focusing = timer.mode === 0
  return (
    <button
      type="button"
      className="focus-mini-badge"
      onClick={() => onNavigate('pomodoro')}
      title="Timer vẫn đang đếm — bấm để về Phòng tập trung"
    >
      <span aria-hidden="true">{focusing ? '🔥' : '☕'}</span>
      <b role="timer" aria-label="Thời gian tập trung còn lại">{formatClock(seconds)}</b>
      <span>{focusing ? 'Đang tập trung' : 'Đang nghỉ'}</span>
    </button>
  )
}

export default function Topbar({ currentPage, onNavigate, user, onLogout, sidebarCollapsed, onToggleSidebar }) {
  const [profile] = useStoredState('nhip-hoc-settings', defaultSettings)
  // Lớp ưu tiên từ profile server khi đã đăng nhập, fallback settings local.
  const [serverGrade, setServerGrade] = useState(() => getSession()?.profile?.grade || '')
  useEffect(() => onSessionChange((session) => setServerGrade(session?.profile?.grade || '')), [])
  const shownGrade = serverGrade || profile.grade
  const page = [...navigationItems, ...utilityItems].find(item => item.path === currentPage)
  return <header className="study-header">
    <div className="study-header-left">
      {onToggleSidebar && <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggleSidebar}
        aria-expanded={!sidebarCollapsed}
        aria-controls="main-sidebar"
        title={sidebarCollapsed ? 'Mở sidebar (Ctrl+B)' : 'Thu gọn sidebar để đọc rộng hơn (Ctrl+B)'}
        aria-label={sidebarCollapsed ? 'Mở sidebar' : 'Thu gọn sidebar'}
      >
        <Icon name={sidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'} size={20} />
      </button>}
      <div className="study-breadcrumb"><Icon name={currentPage} size={18} /><span>Không gian học tập</span><span aria-hidden="true">/</span><b>{page?.label || 'Mục tiêu'}</b></div>
    </div>
    {currentPage !== 'pomodoro' && <FocusTimerBadge onNavigate={onNavigate} />}
    <div className="auth-account"><span>{user?.name}</span><button className="ghost-button" onClick={onLogout}>Đăng xuất</button>
    <button className="student-profile-chip" onClick={() => onNavigate('settings')}><Icon name="book" size={17} />{shownGrade ? gradeLabel(shownGrade) : 'Chọn lớp của bạn'}</button></div>
  </header>
}
