import PublicHeader from '../components/PublicHeader'

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  return (
    <div className="auth-page">
      <PublicHeader />
      <main tabIndex={-1}>
        <section className="auth-card" aria-label={isRegister ? 'Đăng ký' : 'Đăng nhập'}>
          <div className="auth-tabs">
            <a href="#login" className={!isRegister ? 'selected' : ''} aria-current={!isRegister ? 'page' : undefined}>Đăng nhập</a>
            <a href="#register" className={isRegister ? 'selected' : ''} aria-current={isRegister ? 'page' : undefined}>Tạo tài khoản <i>●</i></a>
          </div>
          <h1>{isRegister ? 'Bắt đầu hành trình mới! 🌱' : 'Chào mừng trở lại! 👋'}</h1>
          <p>{isRegister ? 'Một chút tiến bộ mỗi ngày, cùng Nhịp Học.' : 'Hôm nay mình cùng học thêm một điều mới nhé.'}</p>
          <button type="button" className="google-button"><span className="google-letter">G</span> Tiếp tục với Google</button>
          <div className="divider"><span>HOẶC EMAIL</span></div>
          {isRegister && <label>Họ và tên<input autoComplete="name" placeholder="Tên của bạn" /></label>}
          <label>Địa chỉ email<input type="email" autoComplete="email" placeholder="ban@example.com" /></label>
          {isRegister && <label>Khối lớp<select defaultValue=""><option value="" disabled>Chọn khối lớp của bạn</option>{[6, 7, 8, 9, 10, 11, 12].map((grade) => <option key={grade} value={grade}>Lớp {grade}</option>)}</select></label>}
          <label>Mật khẩu<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="Tối thiểu 8 ký tự" minLength={8} /></label>
          {isRegister && <label>Xác nhận mật khẩu<input type="password" autoComplete="new-password" placeholder="Nhập lại mật khẩu" /></label>}
          <button type="button" className="primary-button auth-submit">{isRegister ? 'Tạo tài khoản' : 'Đăng nhập'} →</button>
          <p>{isRegister ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}<a className="link-button" href={isRegister ? '#login' : '#register'}>{isRegister ? 'Đăng nhập' : 'Đăng ký thành viên'}</a></p>
          <a className="auth-preview" href="#dashboard">Khám phá không gian học tập →</a>
        </section>
      </main>
      <footer className="auth-footer"><a href="#landing">Nhịp Học</a> · Học tập nhẹ nhàng, tiến bộ mỗi ngày.</footer>
    </div>
  )
}
