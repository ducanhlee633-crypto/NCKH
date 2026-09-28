import { useEffect, useRef, useState } from 'react'
import { applySettings, colors, defaultSettings, loadSettings } from '../data/settings'
import { CardHeader, SectionCard } from '../components/PageComponents'

function Toggle({ active, onChange, label }) {
  return <button type="button" role="switch" aria-checked={active} aria-label={label} onClick={onChange} className={'toggle ' + (active ? 'on' : '')}><i /></button>
}

export default function SettingsPage() {
  const [saved, setSaved] = useState(loadSettings)
  const [settings, setSettings] = useState(saved)
  const [error, setError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const upload = useRef(null)
  const avatars = useRef(null)
  const password = useRef(null)
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved)
  const update = (key, value) => setSettings((old) => ({ ...old, [key]: value }))
  useEffect(() => { applySettings(settings) }, [settings])
  function save() {
    try {
      localStorage.setItem('nhip-hoc-settings', JSON.stringify(settings))
      setSaved({ ...settings })
      setError('')
    } catch { setError('Không thể lưu thiết lập. Hãy thử ảnh nhỏ hơn hoặc kiểm tra bộ nhớ trình duyệt.') }
  }
  function uploadAvatar(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Chọn ảnh JPG, PNG, WebP hoặc GIF nhỏ hơn 2 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => { update('avatar', reader.result); setError('') }
    reader.onerror = () => setError('Không đọc được ảnh. Hãy chọn lại.')
    reader.readAsDataURL(file)
  }

  return (
    <>
      <div className="settings-heading"><div><p className="eyebrow">▣ HỒ SƠ & TÀI KHOẢN</p><h1>Cài đặt cá nhân</h1></div><div className="save-status"><span>✓ Tài khoản xác thực</span><span role="status">{dirty ? 'Chưa lưu' : '☁ Đã sao lưu'}</span></div></div>
      <div className="settings-grid">
        <div className="settings-main">
          <SectionCard><CardHeader icon="●" title="Hồ sơ học viên" /><p className="card-description">Thông tin hiển thị trên bảng xếp hạng và lớp học</p><div className="profile-preview"><input type="file" ref={upload} hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadAvatar} /><button className="settings-avatar" aria-label="Tải ảnh đại diện" onClick={() => upload.current.click()}>{settings.avatar ? <img src={settings.avatar} alt="Ảnh đại diện" /> : 'MA'}<span>⌕</span></button><div><b>{settings.nickname} <em>Học viên mới ✦</em></b><p>Gia nhập từ tháng 04/2024 · ID: NH-88219</p></div><button className="ghost-button" onClick={() => avatars.current.showModal()}>Chọn Avatar AI ✨</button></div><div className="field-grid"><label>Họ và tên<input value={settings.name} onChange={(event) => update('name', event.target.value)} /></label><label>Biệt danh hiển thị<input value={settings.nickname} onChange={(event) => update('nickname', event.target.value)} /></label><label className="full">Email liên hệ<input value={settings.email} onChange={(event) => update('email', event.target.value)} /></label></div><div className="password-row"><span>◴</span><div><b>Mật khẩu tài khoản</b><small>Đổi lần cuối 30 ngày trước</small></div><button className="ghost-button" onClick={() => { setPasswordError(''); password.current.showModal() }}>Đổi mật khẩu</button></div></SectionCard>
          <SectionCard><CardHeader icon="♧" title="Quyền riêng tư & Bạn bè" /><p className="card-description">Kiểm soát người có thể thấy tiến độ học của bạn</p><div className="setting-list"><div><span>◉</span><p><b>Hiển thị trên Bảng xếp hạng</b><small>Cho phép bạn bè thấy thứ hạng của bạn</small></p><Toggle active={settings.ranking} label="Hiển thị trên Bảng xếp hạng" onChange={() => update('ranking', !settings.ranking)} /></div><div><span>♧</span><p><b>Chia sẻ chuỗi Streak</b><small>Đồng đội cùng khóa có thể cổ vũ bạn</small></p><Toggle active={settings.streak} label="Chia sẻ chuỗi Streak" onChange={() => update('streak', !settings.streak)} /></div></div></SectionCard>
        </div>
        <aside className="settings-side">
          <SectionCard><CardHeader icon="✣" title="Giao diện & Chủ đề" /><p className="card-description">Tùy biến màu sắc dịu mắt cá nhân</p><b className="setting-label">Màu chủ đạo yêu thích</b><div className="color-swatches">{Object.entries(colors).map(([key, [label, hue]]) => <button key={key} aria-label={label} aria-pressed={settings.color === key} className={settings.color === key ? 'selected' : ''} style={{ background: `hsl(${hue} 65% 52%)` }} onClick={() => update('color', key)} />)}</div><div className="theme-switch"><span>◐ Chế độ hiển thị</span>{[['light', '☼ Sáng'], ['dark', '☾ Đêm']].map(([key, label]) => <button key={key} aria-pressed={settings.theme === key} className={settings.theme === key ? 'selected' : ''} onClick={() => update('theme', key)}>{label}</button>)}</div></SectionCard>
          <SectionCard><CardHeader icon="☷" title="Sở thích học tập" tone="orange" /><p className="card-description">Điều chỉnh theo nhịp sinh học</p><div className="preference-row"><span>◷ Thời gian nhắc nhở</span><b>15 phút trước ca</b></div><div className="preference-row"><span>◎ Mục tiêu tuần cá nhân</span><b>24 giờ / tuần</b></div><div className="preference-row"><span>♪ Âm thanh hoàn thành</span><Toggle active={settings.sound} label="Âm thanh hoàn thành" onChange={() => update('sound', !settings.sound)} /></div></SectionCard>
        </aside>
      </div>
      <div className="settings-footer"><span>{dirty ? '✿ Thiết lập có thay đổi chưa lưu' : '✓ Thiết lập đã lưu'}<br /><small>Bấm lưu để giữ thiết lập trên trình duyệt này</small></span><button className="ghost-button" onClick={() => { setSettings({ ...defaultSettings }); setError('') }}>Khôi phục ban đầu</button><button className="primary-button" onClick={save}>✓ Lưu thiết lập</button></div>
      {error && <p role="alert">{error}</p>}
      <dialog ref={avatars} className="settings-dialog" aria-labelledby="avatar-title">
        <h2 id="avatar-title">Chọn Avatar AI</h2>
        <div className="avatar-options">{['🤖', '🦊', '🐼', '🐱', '🦉', '🚀'].map((emoji, index) => {
          const image = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="30" fill="hsl(${index * 55} 70% 90%)"/><text x="60" y="82" text-anchor="middle" font-size="64">${emoji}</text></svg>`)
          return <button key={emoji} aria-label={'Chọn avatar ' + emoji} onClick={() => { update('avatar', image); avatars.current.close() }}><img src={image} alt={emoji} /></button>
        })}</div>
        <button className="ghost-button" onClick={() => avatars.current.close()}>Đóng</button>
      </dialog>
      <dialog ref={password} className="settings-dialog" aria-labelledby="password-title" onClose={() => password.current.querySelector('form').reset()}>
        <form onSubmit={(event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          setPasswordError(fields.get('new') !== fields.get('confirm') ? 'Mật khẩu xác nhận không khớp.' : 'Tính năng đổi mật khẩu chưa được kết nối với tài khoản.')
        }}>
          <h2 id="password-title">Đổi mật khẩu</h2>
          <label>Mật khẩu hiện tại<input name="current" type="password" autoComplete="current-password" required /></label>
          <label>Mật khẩu mới<input name="new" type="password" autoComplete="new-password" minLength={8} required /></label>
          <label>Xác nhận mật khẩu mới<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
          {passwordError && <p role="alert">{passwordError}</p>}
          <div><button type="button" className="ghost-button" onClick={() => password.current.close()}>Đóng</button><button className="primary-button">Đổi mật khẩu</button></div>
        </form>
      </dialog>
    </>
  )
}
