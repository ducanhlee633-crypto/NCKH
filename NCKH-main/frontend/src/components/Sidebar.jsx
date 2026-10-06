import { useEffect, useState } from 'react'
import useStoredState from '../data/useStoredState'
import { displayUser, getSession, onSessionChange } from '../backendApi'
import { defaultSettings, gradeLabel } from '../data/settings'
import { navigationItems, utilityItems } from '../data/navigation'
import Icon from './Icon'

function NavLink({ item, active, onNavigate }) {
  return <a className={'nav-item ' + (active ? 'active' : '')} href={'#' + item.path} aria-current={active ? 'page' : undefined} onClick={event => { event.preventDefault(); onNavigate(item.path) }}>
    <span className="nav-icon"><Icon name={item.path} /></span><span>{item.label}</span>
  </a>
}

export default function Sidebar({ currentPage, onNavigate, collapsed, onToggleSidebar }) {
  const [profile] = useStoredState('nhip-hoc-settings', defaultSettings)
  const [accountName, setAccountName] = useState(() => displayUser(getSession())?.name || '')
  // Lớp ưu tiên từ profile server khi đã đăng nhập, fallback settings local.
  const [serverGrade, setServerGrade] = useState(() => getSession()?.profile?.grade || '')
  useEffect(() => onSessionChange((session) => {
    setAccountName(displayUser(session)?.name || '')
    setServerGrade(session?.profile?.grade || '')
  }), [])
  return <aside className="sidebar" id="main-sidebar">
    <div>
      <a className="brand" href="#dashboard" aria-label="Nhịp Học — Góc học tập">
        <div className="brand-mark"><Icon name="book" size={27} /></div>
        <div><div className="brand-name">Nhịp Học<span>·</span></div><div className="brand-caption">Một chút mỗi ngày</div></div>
      </a>
      {onToggleSidebar && <button
        type="button"
        className="sidebar-collapse-btn"
        onClick={onToggleSidebar}
        aria-expanded={!collapsed}
        aria-controls="main-sidebar"
        title={collapsed ? 'Mở sidebar (Ctrl+B)' : 'Thu gọn sidebar để đọc rộng hơn (Ctrl+B)'}
        aria-label={collapsed ? 'Mở sidebar' : 'Thu gọn sidebar'}
      >
        <Icon name={collapsed ? 'sidebar-expand' : 'sidebar-collapse'} size={19} />
      </button>}
      <nav className="main-nav" aria-label="Điều hướng chính">
        <p className="nav-group-label">Không gian của bạn</p>
        {navigationItems.map(item => <NavLink key={item.path} item={item} active={currentPage === item.path || (item.path === 'goals' && currentPage === 'goal')} onNavigate={onNavigate} />)}
        <p className="nav-group-label nav-utility-label">Dành cho bạn</p>
        {utilityItems.map(item => <NavLink key={item.path} item={item} active={currentPage === item.path} onNavigate={onNavigate} />)}
      </nav>
    </div>
    <div className="sidebar-bottom">
      <div className="sidebar-note"><Icon name="book" /><p>Không cần học thật nhiều.<br /><b>Hãy bắt đầu từ một việc nhỏ.</b></p></div>
      <button className="sidebar-profile" onClick={() => onNavigate('settings')} aria-label="Chỉnh sửa hồ sơ học tập">
        <div className="avatar">{profile.avatar ? <img src={profile.avatar} alt="" /> : (accountName || 'Bạn').slice(0, 2)}</div>
        <div className="sidebar-profile-copy"><b>{accountName || 'Hồ sơ của bạn'}</b><small>{gradeLabel(serverGrade || profile.grade)}</small></div>
        <Icon name="settings" size={18} />
      </button>
    </div>
  </aside>
}
