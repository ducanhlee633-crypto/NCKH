import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppShell({ currentPage, onNavigate, children }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href={'#' + currentPage + '/main-content'}>Đến nội dung chính</a>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <div className="workspace">
        <Topbar onNavigate={onNavigate} />
        <main className="main-content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}
