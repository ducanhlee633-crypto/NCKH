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
  return (
    <aside className="sidebar">
      <div>
        <a className="brand" href="#landing" aria-label="Giới thiệu Nhịp Học" title="Giới thiệu Nhịp Học">
          <div className="brand-mark"><span>📖</span><b>★</b></div>
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
        {utilityItems.map((item) => <NavLink key={item.path} item={item} active={currentPage === item.path} onNavigate={onNavigate} />)}
      </div>
    </aside>
  )
}
