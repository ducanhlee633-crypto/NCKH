import useStoredState from '../data/useStoredState'
import { defaultSettings } from '../data/settings'
import { navigationItems, utilityItems } from '../data/navigation'

function NavLink({ item, active, onNavigate }) {
  return (
    <a
      className={'nav-item ' + (active ? 'active' : '')}
      href={'#' + item.path}
      aria-label={item.label}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => { event.preventDefault(); onNavigate(item.path) }}
    >
      <span className="nav-icon">{item.icon}</span>
      <span>{item.label}</span>
      {item.badge && <em>{item.badge}</em>}
      {active && <strong>★</strong>}
    </a>
  )
}

export default function Sidebar({ currentPage, onNavigate }) {
  const [profile] = useStoredState('nhip-hoc-settings', defaultSettings)
  return (
    <aside className="sidebar">
      <div>
        <a className="brand" href="#dashboard" aria-label="Tổng quan Nhịp Học" title="Tổng quan Nhịp Học">
          <div className="brand-mark"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v15M12 5C8 2 4 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-2-1-6-2-10 1Z" /></svg></div>
          <div>
            <div className="brand-name">Nhịp Học <span>✦</span></div>
            <div className="brand-caption">CẤP 1 • TÂN THỦ</div>
          </div>
        </a>
        <nav className="main-nav" aria-label="Điều hướng chính">
          {navigationItems.map((item) => <NavLink key={item.path} item={item} active={currentPage === item.path} onNavigate={onNavigate} />)}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-profile" onClick={() => onNavigate('settings')} aria-label="Cài đặt tài khoản">
          <div className="avatar">{profile.avatar ? <img src={profile.avatar} alt="Ảnh tài khoản" /> : (profile.nickname || profile.name || "Bạn").slice(0,2)}<span /></div>
          <div className="sidebar-profile-copy"><b>{profile.nickname || profile.name || "Tài khoản"}</b><small>Nhà Thám Hiểm THPT ✦</small></div>
        </button>
        <div className="sidebar-xp"><span>✪</span><div><b>0 / 100 XP</b><small>Tiến bộ mỗi ngày</small></div></div>
        {utilityItems.map((item) => <NavLink key={item.path} item={item} active={currentPage === item.path} onNavigate={onNavigate} />)}
      </div>
    </aside>
  )
}
