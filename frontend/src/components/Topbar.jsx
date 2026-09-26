export default function Topbar({ onNavigate }) {
  return (
    <header className="topbar">
      <label className="search-box">
        <span>⌕</span>
        <input aria-label="Tìm kiếm" placeholder="Tìm kiếm kho báu kiến thức..." />
      </label>
      <div className="top-actions">
        <div className="streak-pill"><span>🔥</span><div><b>0 ngày</b><small>Sẵn sàng thắp lửa!</small></div></div>
        <div className="xp-pill"><span>✪</span> 0 / 100 XP</div>
        <a className="primary-button" href="#dashboard/tasks" aria-label="Việc cần làm">⊕ <span>Việc cần làm</span></a>
        <button className="icon-button notification" aria-label="Thông báo">♧<i /></button>
        <button className="profile" onClick={() => onNavigate('settings')} aria-label="Cài đặt tài khoản Minh Anh">
          <div className="avatar">MA<span /></div>
          <div className="profile-copy"><b>Minh Anh</b><small>Nhà Thám Hiểm THPT ✦</small></div>
          <span className="chevron">⌄</span>
        </button>
      </div>
    </header>
  )
}
