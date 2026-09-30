export default function PublicHeader() {
  return (
    <header className="landing-nav">
      <a className="landing-brand" href="#landing"><span aria-hidden="true">📖</span> Nhịp Học <i aria-hidden="true">✦</i></a>
      <nav aria-label="Khám phá Nhịp Học">
        <a href="#landing/features">Tính năng</a>
        <a href="#landing/get-started">Cách bắt đầu</a>
        <a href="#pomodoro">Pomodoro</a>
      </nav>
      <div><a className="ghost-button" href="#login">Đăng nhập</a><a className="primary-button" href="#register">Đăng ký ✦</a></div>
    </header>
  )
}
