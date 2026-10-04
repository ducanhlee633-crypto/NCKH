import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppShell({ currentPage, onNavigate, children, user, onLogout }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href={'#' + currentPage + '/main-content'}>Đến nội dung chính</a>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div className="workspace">
        <Topbar currentPage={currentPage} onNavigate={onNavigate} user={user} onLogout={onLogout} />
        <main className="main-content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}
