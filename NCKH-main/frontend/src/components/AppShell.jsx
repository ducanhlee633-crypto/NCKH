import { useCallback, useEffect } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import useStoredState from '../data/useStoredState'

export default function AppShell({ currentPage, onNavigate, children, user, onLogout }) {
  // Thu/mở sidebar để mở rộng vùng đọc bên phải khi cần. Nhớ lựa chọn của user.
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState('nhip-hoc-sidebar-collapsed', false)
  const toggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [setSidebarCollapsed])
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  return (
    <div className={'app-shell' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
      <a className="skip-link" href={'#' + currentPage + '/main-content'}>Đến nội dung chính</a>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
      <div className="workspace">
        <Topbar currentPage={currentPage} onNavigate={onNavigate} user={user} onLogout={onLogout} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
        <main className="main-content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}
