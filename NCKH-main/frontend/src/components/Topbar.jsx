import { useEffect, useState } from 'react'
import { loadSettings } from '../data/settings'

export default function Topbar({ onNavigate }) {
  const [settings, setSettings] = useState(loadSettings)
  useEffect(() => {
    const update = (event) => setSettings(event.detail)
    window.addEventListener('nhip-hoc-settings-preview', update)
    return () => window.removeEventListener('nhip-hoc-settings-preview', update)
  }, [])
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
        <button className="profile" onClick={() => onNavigate('settings')} aria-label={'Cài đặt tài khoản ' + settings.nickname}>
          <div className="avatar">{settings.avatar ? <img src={settings.avatar} alt="Ảnh đại diện" /> : 'MA'}<span /></div>
          <div className="profile-copy"><b>{settings.nickname}</b><small>Nhà Thám Hiểm THPT ✦</small></div>
          <span className="chevron">⌄</span>
        </button>
      </div>
    </header>
  )
}
