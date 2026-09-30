import { CardHeader, PageIntro, SectionCard } from '../components/PageComponents'

const faqs = [
  { question: 'Nên bắt đầu học ở đâu?', answer: 'Mở Lộ trình, chọn một mục tiêu cụ thể rồi dành thời gian cho từng bước nhỏ. Bạn có thể bắt đầu bằng một môn cần cải thiện.', route: 'roadmap', label: 'Xem lộ trình' },
  { question: 'Pomodoro là gì?', answer: 'Chia thời gian thành những phiên tập trung 25 phút, xen kẽ 5 phút nghỉ. Sau 4 phiên, hãy nghỉ dài hơn để nạp lại năng lượng.', route: 'pomodoro', label: 'Xem phòng tập trung' },
  { question: 'Theo dõi bài tập và lịch học ở đâu?', answer: 'Lịch học & Deadline tập hợp thời khóa biểu và bài tập sắp đến hạn để bạn dễ sắp xếp thời gian.', route: 'schedule', label: 'Xem lịch học' },
  { question: 'Xem tiến bộ của mình ở đâu?', answer: 'Thống kê & Streak là nơi nhìn lại thời gian học, nhịp học theo môn và các cột mốc duy trì thói quen.', route: 'stats', label: 'Xem thống kê' },
]

export default function HelpPage() {
  return (
    <>
      <PageIntro eyebrow="💬 CÙNG BẠN TÌM CÂU TRẢ LỜI" title="Trợ giúp & Phản hồi" subtitle="Một vài gợi ý để bạn làm quen với góc học tập mới." />
      <div className="help-grid">
        <SectionCard>
          <CardHeader icon="?" title="Câu hỏi thường gặp" />
          {faqs.map((faq) => <details className="faq-item" key={faq.route}><summary>{faq.question}<span aria-hidden="true">＋</span></summary><p>{faq.answer}</p><a href={'#' + faq.route}>{faq.label} →</a></details>)}
        </SectionCard>
        <SectionCard className="feedback-card">
          <CardHeader icon="✦" title="Gửi góp ý" tone="violet" />
          <p>Điều gì sẽ giúp trải nghiệm học tập của bạn tốt hơn?</p>
          <textarea aria-label="Nội dung góp ý" placeholder="Viết lời nhắn của bạn..." />
          <button className="primary-button">Gửi phản hồi</button>
        </SectionCard>
      </div>
      <SectionCard className="contact-card"><div><span aria-hidden="true">📖</span><b>Cùng khám phá Nhịp Học</b><p>Tìm một cách học phù hợp với chính mình.</p></div><a className="ghost-button" href="#dashboard">Về trang tổng quan →</a></SectionCard>
    </>
  )
}
