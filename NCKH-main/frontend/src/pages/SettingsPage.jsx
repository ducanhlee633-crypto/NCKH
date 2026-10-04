import { useEffect, useRef, useState } from 'react'
import { changePassword, fetchPreferences, fetchProfile, getSession, savePreferences, syncProfile } from '../backendApi'
import { applySettings, colors, defaultSettings, gradeLabel, grades, loadSettings } from '../data/settings'
import { CardHeader, SectionCard } from '../components/PageComponents'

const HANDLE_PATTERN = /^[A-Za-z0-9_.-]{3,64}$/

function Toggle({ active, onChange, label }) {
  return <button type="button" role="switch" aria-checked={active} aria-label={label} onClick={onChange} className={'toggle ' + (active ? 'on' : '')}><i /></button>
}

export default function SettingsPage() {
  const [saved, setSaved] = useState(loadSettings)
  const [settings, setSettings] = useState(saved)
  const [error, setError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  // --- Tài khoản đồng bộ server (UserPrivate: name/username/nickname) ---
  const [account, setAccount] = useState(() => {
    const profile = getSession()?.profile || {}
    return {
      name: profile.name || '',
      username: profile.username || '',
      nickname: profile.nickname || '',
    }
  })
  const [accountSaved, setAccountSaved] = useState(account)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountOk, setAccountOk] = useState('')
  const [prefSaving, setPrefSaving] = useState(false)
  const upload = useRef(null)
  const avatars = useRef(null)
  const password = useRef(null)
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved)
  const accountDirty = JSON.stringify(account) !== JSON.stringify(accountSaved)
  const update = (key, value) => setSettings((old) => ({ ...old, [key]: value }))
  const updateAccount = (key, value) => {
    setAccount((old) => ({ ...old, [key]: value }))
    setAccountError('')
    setAccountOk('')
  }
  useEffect(() => { applySettings(settings) }, [settings])
  useEffect(() => {
    let mounted = true
    fetchProfile()
      .then((profile) => {
        if (!mounted || !profile) return
        const next = {
          name: profile.name || '',
          username: profile.username || '',
          nickname: profile.nickname || '',
        }
        setAccount(next)
        setAccountSaved(next)
      })
      .catch(() => { /* chưa đăng nhập hoặc lỗi mạng: giữ giá trị từ session */ })
      .finally(() => { if (mounted) setAccountLoading(false) })
    return () => { mounted = false }
  }, [])
  // --- Lựa chọn Settings từ server (user_preferences, 9 field) ---
  useEffect(() => {
    if (!getSession()) return
    let mounted = true
    fetchPreferences()
      .then((remote) => {
        if (!mounted || !remote) return
        setSettings((old) => ({ ...old, ...remote }))
        setSaved((old) => ({ ...old, ...remote }))
      })
      .catch(() => { /* chưa có dòng preferences hoặc lỗi mạng: giữ bản local */ })
    return () => { mounted = false }
  }, [])
  async function save() {
    try {
      localStorage.setItem('nhip-hoc-settings', JSON.stringify(settings))
      window.dispatchEvent(new CustomEvent('nhip-hoc-storage', { detail: { key: 'nhip-hoc-settings' } }))
      setSaved({ ...settings })
      setError('')
    } catch { setError('Không thể lưu thiết lập. Hãy thử ảnh nhỏ hơn hoặc kiểm tra bộ nhớ trình duyệt.'); return }
    // Đã đăng nhập: đồng bộ 9 field lựa chọn lên server (giữ localStorage làm fallback).
    if (!getSession()) return
    setPrefSaving(true)
    try {
      const remote = await savePreferences(settings)
      const merged = { ...settings, ...remote }
      setSettings(merged)
      setSaved({ ...merged })
      try {
        localStorage.setItem('nhip-hoc-settings', JSON.stringify(merged))
        window.dispatchEvent(new CustomEvent('nhip-hoc-storage', { detail: { key: 'nhip-hoc-settings' } }))
      } catch { /* bỏ qua: server đã lưu */ }
    } catch (failure) {
      setError(failure.friendlyMessage || 'Đã lưu trên trình duyệt nhưng chưa đồng bộ được lên server.')
    } finally {
      setPrefSaving(false)
    }
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

  async function saveAccount() {
    const name = account.name.trim()
    const username = account.username.trim().toLowerCase()
    const nickname = account.nickname.trim().toLowerCase()
    if (username && !HANDLE_PATTERN.test(username)) {
      setAccountError('Username 3-64 ký tự, chỉ gồm chữ/số và _ . -')
      return
    }
    if (nickname && !HANDLE_PATTERN.test(nickname)) {
      setAccountError('Nickname 3-64 ký tự, chỉ gồm chữ/số và _ . -')
      return
    }
    if (!username && !nickname && !name) {
      setAccountError('Nhập ít nhất một trường để cập nhật.')
      return
    }
    setAccountSaving(true)
    setAccountError('')
    setAccountOk('')
    try {
      const updated = await syncProfile({
        ...(username ? { username } : {}),
        ...(nickname ? { nickname } : {}),
        ...(name ? { name } : {}),
      })
      const next = {
        name: updated.name || '',
        username: updated.username || '',
        nickname: updated.nickname || '',
      }
      setAccount(next)
      setAccountSaved(next)
      setAccountOk('Đã đồng bộ tài khoản lên server.')
    } catch (failure) {
      const status = failure.response?.status
      if (status === 409) setAccountError('Username hoặc nickname đã tồn tại.')
      else if (status === 422) setAccountError('Thông tin chưa hợp lệ. Kiểm tra lại username/nickname.')
      else setAccountError(failure.friendlyMessage || failure.response?.data?.detail || 'Không đồng bộ được. Thử lại sau.')
    } finally {
      setAccountSaving(false)
    }
  }

  return (
    <>
      <div className="settings-heading"><div><p className="eyebrow">▣ HỒ SƠ & TÀI KHOẢN</p><h1>Cài đặt cá nhân</h1></div><div className="save-status"><span>Hồ sơ học tập</span><span role="status">{dirty ? 'Chưa lưu' : 'Đã lưu trên thiết bị'}</span></div></div>
      <div className="settings-grid">
        <div className="settings-main">
          <SectionCard><CardHeader icon="●" title="Hồ sơ học sinh" /><p className="card-description">Ảnh đại diện và lớp đang học của bạn.</p><div className="profile-preview"><input type="file" ref={upload} hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadAvatar} /><button className="settings-avatar" aria-label="Tải ảnh đại diện" onClick={() => upload.current.click()}>{settings.avatar ? <img src={settings.avatar} alt="Ảnh đại diện" /> : (account.nickname || account.name || 'Bạn').slice(0, 2)}<span>⌕</span></button><div><b>{account.nickname || account.name || 'Bạn'} <em>{gradeLabel(settings.grade)}</em></b><p>{account.nickname ? `@${account.nickname} · hồ sơ công khai` : 'Hồ sơ cá nhân của bạn'}</p></div><button className="ghost-button" onClick={() => avatars.current.showModal()}>Chọn ảnh có sẵn</button></div><div className="field-grid"><label className="full">Lớp đang học<select value={settings.grade} onChange={event => update('grade', event.target.value)}><option value="">Chọn lớp của bạn</option><optgroup label="THCS">{grades.slice(0, 4).map(grade => <option key={grade} value={grade}>Lớp {grade}</option>)}</optgroup><optgroup label="THPT">{grades.slice(4).map(grade => <option key={grade} value={grade}>Lớp {grade}</option>)}</optgroup></select></label></div><div style={{ marginTop: 16 }}><b className="setting-label">Tài khoản đồng bộ server</b><p className="card-description">Tên thật + username là riêng tư (chỉ mình bạn thấy). Nickname là công khai, hiển thị ở Topbar / BXH / bạn bè. Username + nickname: 3-64 ký tự, chỉ a-z 0-9 _ . -</p>{accountLoading ? <p className="card-description">Đang tải hồ sơ từ server…</p> : <div className="field-grid"><label>Tên thật (riêng tư)<input value={account.name} maxLength={120} onChange={(event) => updateAccount('name', event.target.value)} placeholder="VD: Nguyễn Văn An" /></label><label>Username (riêng tư, duy nhất)<input value={account.username} maxLength={64} onChange={(event) => updateAccount('username', event.target.value)} placeholder="vd: an.nguyen" /></label><label className="full">Nickname hiển thị (công khai, duy nhất)<input value={account.nickname} maxLength={64} onChange={(event) => updateAccount('nickname', event.target.value)} placeholder="vd: an.hoc.gioi" /></label></div>}{accountError && <p role="alert">{accountError}</p>}{accountOk && <p role="status">✓ {accountOk}</p>}<div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="primary-button" disabled={!accountDirty || accountSaving} onClick={saveAccount}>{accountSaving ? 'Đang đồng bộ…' : 'Đồng bộ lên server'}</button>{accountDirty && <span className="card-description">Có thay đổi chưa đồng bộ</span>}</div></div><div className="password-row"><span>◴</span><div><b>Mật khẩu tài khoản</b><small>Quản lý mật khẩu tài khoản</small></div><button className="ghost-button" onClick={() => { setPasswordError(''); password.current.showModal() }}>Đổi mật khẩu</button></div></SectionCard>
          <SectionCard><CardHeader icon="♧" title="Quyền riêng tư & Bạn bè" /><p className="card-description">Kiểm soát người có thể thấy tiến độ học của bạn</p><div className="setting-list"><div><span>◉</span><p><b>Hiển thị trên Bảng xếp hạng</b><small>Cho phép bạn bè thấy thứ hạng của bạn</small></p><Toggle active={settings.ranking} label="Hiển thị trên Bảng xếp hạng" onChange={() => update('ranking', !settings.ranking)} /></div><div><span>♧</span><p><b>Chia sẻ chuỗi học</b><small>Cho phép bạn bè xem số ngày bạn đã học</small></p><Toggle active={settings.streak} label="Chia sẻ chuỗi học" onChange={() => update('streak', !settings.streak)} /></div></div></SectionCard>
        </div>
        <aside className="settings-side">
          <SectionCard><CardHeader icon="✣" title="Giao diện & Chủ đề" /><p className="card-description">Tùy biến màu sắc dịu mắt cá nhân</p><b className="setting-label">Màu chủ đạo yêu thích</b><div className="color-swatches">{Object.entries(colors).map(([key, [label, hue]]) => <button key={key} aria-label={label} aria-pressed={settings.color === key} className={settings.color === key ? 'selected' : ''} style={{ background: `hsl(${hue} 65% 52%)` }} onClick={() => update('color', key)} />)}</div><div className="theme-switch"><span>◐ Chế độ hiển thị</span>{[['light', '☼ Sáng'], ['dark', '☾ Đêm']].map(([key, label]) => <button key={key} aria-pressed={settings.theme === key} className={settings.theme === key ? 'selected' : ''} onClick={() => update('theme', key)}>{label}</button>)}</div></SectionCard>
          <SectionCard id="notifications"><CardHeader icon="☷" title="Sở thích học tập" tone="orange" /><p className="card-description">Chọn thời gian phù hợp với lịch học và nghỉ ngơi.</p><div className="preference-row"><span>Thông báo học tập</span><Toggle active={settings.reminders} label="Thông báo học tập" onChange={() => update('reminders', !settings.reminders)} /></div><div className="preference-row"><span>◷ Thời gian nhắc nhở</span><select aria-label="Thời gian nhắc nhở" value={settings.reminderMinutes} onChange={event => update('reminderMinutes', Number(event.target.value))}>{[0, 5, 10, 15, 30, 60].map(value => <option key={value} value={value}>{value === 0 ? 'Đúng giờ' : value + ' phút trước buổi học'}</option>)}</select></div><div className="preference-row"><span>◎ Mục tiêu tuần cá nhân</span><select aria-label="Mục tiêu tuần cá nhân" value={settings.weeklyHours} onChange={event => update('weeklyHours', Number(event.target.value))}>{Array.from({ length: 70 }, (_, i) => i + 1).map(value => <option key={value} value={value}>{value} giờ / tuần</option>)}</select></div><div className="preference-row"><span>♪ Âm thanh hoàn thành</span><Toggle active={settings.sound} label="Âm thanh hoàn thành" onChange={() => update('sound', !settings.sound)} /></div></SectionCard>
        </aside>
      </div>
      <div className="settings-footer"><span>{dirty ? '✿ Thiết lập có thay đổi chưa lưu' : '✓ Thiết lập đã lưu'}<br /><small>Bấm lưu để giữ trên trình duyệt này{getSession() ? ' và đồng bộ lên server' : ''}</small></span><button className="ghost-button" onClick={() => { setSettings({ ...defaultSettings }); setError('') }}>Khôi phục ban đầu</button><button className="primary-button" onClick={save} disabled={prefSaving}>{prefSaving ? 'Đang lưu…' : '✓ Lưu thiết lập'}</button></div>
      {error && <p role="alert">{error}</p>}
      <dialog ref={avatars} className="settings-dialog" aria-labelledby="avatar-title">
        <h2 id="avatar-title">Chọn ảnh đại diện</h2>
        <div className="avatar-options">{['🤖', '🦊', '🐼', '🐱', '🦉', '🚀'].map((emoji, index) => {
          const image = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="30" fill="hsl(${index * 55} 70% 90%)"/><text x="60" y="82" text-anchor="middle" font-size="64">${emoji}</text></svg>`)
          return <button key={emoji} aria-label={'Chọn avatar ' + emoji} onClick={() => { update('avatar', image); avatars.current.close() }}><img src={image} alt={emoji} /></button>
        })}</div>
        <button className="ghost-button" onClick={() => avatars.current.close()}>Đóng</button>
      </dialog>
      <dialog ref={password} className="settings-dialog" aria-labelledby="password-title" onClose={() => password.current.querySelector('form').reset()}>
        <form onSubmit={async (event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          if (fields.get('new') !== fields.get('confirm')) {
            setPasswordError('Mật khẩu xác nhận không khớp.')
            return
          }
          try {
            await changePassword(fields.get('new'))
            password.current.close()
            setPasswordError('')
          } catch {
            setPasswordError('Không đổi được mật khẩu. Hãy đăng nhập lại rồi thử.')
          }
        }}>
          <h2 id="password-title">Đổi mật khẩu</h2>
          <p className="card-description">Mật khẩu do Supabase Auth quản lý. Sau khi đổi, các thiết bị khác sẽ phải đăng nhập lại.</p>
          <label>Mật khẩu mới<input name="new" type="password" autoComplete="new-password" minLength={8} required /></label>
          <label>Xác nhận mật khẩu mới<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
          {passwordError && <p role="alert">{passwordError}</p>}
          <div><button type="button" className="ghost-button" onClick={() => password.current.close()}>Đóng</button><button className="primary-button">Đổi mật khẩu</button></div>
        </form>
      </dialog>
    </>
  )
}
