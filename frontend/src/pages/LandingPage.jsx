import PublicHeader from '../components/PublicHeader'

const features = [
  { icon: '📈', title: 'Thấy rõ tiến bộ', copy: 'Ghi nhận từng buổi học, từng bước tiến của chính mình.', route: 'stats' },
  { icon: '🤖', title: 'Bạn đồng hành AI', copy: 'Gợi mở cách nghĩ và cùng bạn tháo gỡ những bài học khó.', route: 'assistant' },
  { icon: '🌱', title: 'Học theo nhịp riêng', copy: 'Một kế hoạch vừa sức, có thời gian học và cả thời gian nghỉ.', route: 'roadmap' },
  { icon: '🔔', title: 'Chủ động lịch học', copy: 'Đặt lịch, theo dõi bài tập và chuẩn bị cho kỳ thi sắp tới.', route: 'schedule' },
]

export default function LandingPage() {
  return (
    <div className="landing-page">
      <PublicHeader />
      <main tabIndex={-1}>
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="tag blue">MỘT GÓC HỌC TẬP DÀNH RIÊNG CHO BẠN</span>
            <h1>Học nhẹ nhàng,<br /><em>đúng nhịp.</em></h1>
            <p>Từ bài kiểm tra ngày mai đến kỳ thi quan trọng. Nhịp Học cùng bạn chia nhỏ mục tiêu, giữ thói quen và tiến bộ mỗi ngày.</p>
            <div><a className="primary-button" href="#register">Bắt đầu hành trình 🚀</a><a className="ghost-button" href="#dashboard">Xem không gian học →</a></div>
            <small className="landing-audience">Dành cho học sinh THCS & THPT Việt Nam</small>
          </div>
          <div className="landing-card">
            <span>🌟 Mỗi bước nhỏ đều đáng tự hào</span>
            <div className="landing-mockup">
              <p className="mockup-label">MỘT TUẦN HỌC THẬT VUI</p>
              <div className="mock-score"><b>Điểm trung bình</b><strong>8.8<small>/10</small></strong></div>
              {['Toán', 'Ngữ văn', 'Tiếng Anh', 'Khoa học tự nhiên'].map((subject, index) => <div className="mock-progress" key={subject}><span>{subject}</span><i style={{ width: 60 + index * 7 + '%' }} /></div>)}
              <small>Hôm nay bạn đã tiến thêm một bước ✨</small>
            </div>
          </div>
        </section>
        <section className="landing-section" id="features">
          <p className="eyebrow">MỌI THỨ Ở CÙNG MỘT NƠI</p><h2>Một góc nhỏ, nhiều điều hay</h2>
          <div className="landing-features">{features.map((feature) => <a href={'#' + feature.route} key={feature.route}><span>{feature.icon}</span><h3>{feature.title}</h3><p>{feature.copy}</p><b>Khám phá →</b></a>)}</div>
        </section>
        <section className="landing-section landing-steps" id="get-started">
          <p className="eyebrow">BẮT ĐẦU TỪ NHỮNG ĐIỀU NHỎ</p><h2>Vào nhịp chỉ với 3 bước</h2>
          <div>{[['1', 'Chọn đích đến', 'Ôn thi vào lớp 10, nâng điểm một môn hay học đều hơn.', 'roadmap'], ['2', 'Sắp xếp nhịp học', 'Dành từng khoảng thời gian nhỏ cho điều quan trọng.', 'schedule'], ['3', 'Giữ nhịp mỗi ngày', 'Tập trung, nghỉ ngơi và nhìn lại tiến bộ của bạn.', 'pomodoro']].map(([step, title, copy, route]) => <a href={'#' + route} key={step}><span>{step}</span><h3>{title}</h3><p>{copy}</p></a>)}</div>
        </section>
        <section className="landing-cta"><span aria-hidden="true">✦</span><h2>Sẵn sàng tìm nhịp học của mình?</h2><p>Không cần hoàn hảo. Chỉ cần bắt đầu.</p><a className="gold-button" href="#dashboard">Khám phá Nhịp Học →</a></section>
      </main>
      <footer className="landing-footer"><div><a className="landing-brand" href="#landing">Nhịp Học ✦</a><p>Học tập nhẹ nhàng, tiến bộ mỗi ngày.</p></div><nav aria-label="Liên kết cuối trang"><a href="#help">Trợ giúp</a><a href="#settings">Cài đặt</a><a href="#login">Đăng nhập</a></nav></footer>
    </div>
  )
}
