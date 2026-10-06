import { useState } from 'react'
import { loginUser, registerUser, requestPasswordReset } from '../backendApi'
import Icon from '../components/Icon'
import '../styles/public-pages.css'
import '../styles/auth.css'

export default function AuthPage({ mode = 'login', verified = false, callbackError = '', onNavigate }) {
  const registering = mode === 'register'
  const forgot = mode === 'forgot'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(callbackError)
  const [notice, setNotice] = useState(verified ? 'Email đã được xác nhận! Hãy đăng nhập để bắt đầu làm quen với Nhịp Học.' : '')
  const [showPassword, setShowPassword] = useState(false)

  function failureMessage(failure) {
    const status = failure.response?.status
    if (failure.response?.data?.detail) return failure.response.data.detail
    if (status === 401) return 'Email hoặc mật khẩu không đúng.'
    if (status === 409) return 'Email hoặc tên đăng nhập đã tồn tại.'
    if (status === 422) return 'Thông tin chưa hợp lệ. Kiểm tra lại các trường bên dưới.'
    if (status === 429) return 'Thử quá nhiều lần. Vui lòng đợi rồi thử lại.'
    if (status === 503) return 'Dịch vụ tài khoản chưa được cấu hình. Vui lòng liên hệ quản trị viên.'
    return failure.response ? 'Không thể hoàn tất. Vui lòng thử lại.' : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const email = (values.email || '').trim()
    setError('')
    setNotice('')

    if (forgot) {
      setBusy(true)
      try {
        await requestPasswordReset(email)
        form.reset()
        setNotice('Đã gửi mail đặt lại mật khẩu. Vui lòng kiểm tra hộp thư.')
      } catch (failure) {
        setError(failureMessage(failure))
      } finally {
        setBusy(false)
      }
      return
    }

    const credentials = { email, password: values.password }
    if (registering) {
      if (!values.name.trim()) {
        setError('Vui lòng nhập họ và tên.')
        return
      }
      if (values.password !== values.confirmPassword) {
        setError('Mật khẩu xác nhận chưa khớp.')
        return
      }
    }
    setBusy(true)
    try {
      if (registering) {
        const result = await registerUser({ ...credentials, name: values.name.trim(), username: values.username.trim() })
        if (result?.needsEmailConfirmation) {
          form.reset()
          setNotice(`Tạo tài khoản thành công. Vui lòng mở mail ${result.email} để xác nhận trước khi đăng nhập.`)
        } else {
          onNavigate('dashboard')
        }
      } else {
        await loginUser(credentials)
        onNavigate('dashboard')
      }
    } catch (failure) {
      setError(failureMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return <div className="auth-page">
    <header className="landing-nav">
      <a className="landing-brand" href="#login"><span><Icon name="book" /></span>Nhịp Học</a>
      <span>Mỗi ngày một chút tiến bộ</span>
    </header>
    <main className="auth-card" tabIndex={-1}>
      <nav className="auth-tabs" aria-label="Tài khoản">
        <button type="button" className={!registering && !forgot ? 'selected' : ''} aria-current={!registering && !forgot ? 'page' : undefined} disabled={busy} onClick={() => onNavigate('login')}>Đăng nhập</button>
        <button type="button" className={registering ? 'selected' : ''} aria-current={registering ? 'page' : undefined} disabled={busy} onClick={() => onNavigate('register')}>Đăng ký</button>
      </nav>
      <div className="auth-book"><Icon name="book" size={32} /></div>
      <h1>{registering ? 'Bắt đầu nhịp học của bạn' : forgot ? 'Quên mật khẩu' : 'Chào mừng bạn trở lại!'}</h1>
      <p>{registering ? 'Tạo tài khoản để mở không gian học tập của riêng bạn.' : forgot ? 'Nhập email để nhận liên kết đặt lại mật khẩu.' : 'Đăng nhập để tiếp tục hành trình học tập.'}</p>
      {error && <div className="auth-message auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-message auth-success" role="status">{notice}</div>}
      <form onSubmit={handleSubmit} aria-busy={busy}>
        <fieldset disabled={busy}>
          {registering && <label>Họ và tên<input name="name" autoComplete="name" required maxLength={120} placeholder="Nguyễn Minh Anh" /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="ban@example.com" /></label>
          {registering && <>
            <label>Tên đăng nhập (hiển thị)<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={64} pattern="[A-Za-z0-9_.\-]+" aria-describedby="username-hint" placeholder="minhanh" /></label>
            <small id="username-hint" className="auth-hint">3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.</small>
          </>}
          {!forgot && <>
            <label>Mật khẩu<input name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} placeholder="Từ 8 đến 128 ký tự" /></label>
            {registering && <label>Xác nhận mật khẩu<input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Nhập lại mật khẩu" /></label>}
            <button type="button" className="auth-password-toggle" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}</button>
          </>}
          <button className="primary-button auth-submit" type="submit">{busy ? 'Đang xử lý…' : registering ? 'Tạo tài khoản' : forgot ? 'Gửi mail đặt lại' : 'Đăng nhập'}{!busy && <Icon name="arrow" size={18} />}</button>
        </fieldset>
      </form>
      {!registering && !forgot && <button type="button" className="auth-password-toggle" disabled={busy} onClick={() => onNavigate('forgot')}>Quên mật khẩu?</button>}
      {forgot && <button type="button" className="auth-password-toggle" disabled={busy} onClick={() => onNavigate('login')}>Quay lại đăng nhập</button>}
    </main>
    <footer className="auth-footer">Nhịp Học · Học đều đặn, tiến bộ mỗi ngày.</footer>
  </div>
}
