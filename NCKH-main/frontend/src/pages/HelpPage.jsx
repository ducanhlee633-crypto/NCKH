import { useState } from 'react'
import useStoredState from '../data/useStoredState'
import { CardHeader, PageIntro, SectionCard } from '../components/PageComponents'

const faqs = [
  { question: 'Nên bắt đầu học ở đâu?', answer: 'Mở Lộ trình, chọn một mục tiêu cụ thể rồi dành thời gian cho từng bước nhỏ. Bạn có thể bắt đầu bằng một môn cần cải thiện.', route: 'roadmap', label: 'Xem lộ trình' },
  { question: 'Pomodoro là gì?', answer: 'Chia thời gian thành những phiên tập trung 25 phút, xen kẽ 5 phút nghỉ. Sau 4 phiên, hãy nghỉ dài hơn để nạp lại năng lượng.', route: 'pomodoro', label: 'Xem phòng tập trung' },
  { question: 'Theo dõi bài tập và lịch học ở đâu?', answer: 'Lịch học tập hợp thời khóa biểu và bài tập sắp đến hạn để bạn dễ sắp xếp thời gian.', route: 'schedule', label: 'Xem lịch học' },
  { question: 'Xem tiến bộ của mình ở đâu?', answer: 'Tiến bộ của bạn là nơi nhìn lại thời gian học, nhịp học theo môn và các cột mốc duy trì thói quen.', route: 'stats', label: 'Xem thống kê' },
]

export default function HelpPage() {
  const [feedback, saveFeedback, error] = useStoredState('nhip-hoc-feedback-draft', '')
  const [message, setMessage] = useState(feedback)
  const [saved, setSaved] = useState(false)
  return (
    <>
      <PageIntro eyebrow="LÀM QUEN VỚI NHỊP HỌC" title="Trợ giúp" subtitle="Một vài gợi ý để bạn làm quen với góc học tập mới." />
      <div className="help-grid">
        <SectionCard>
          <CardHeader icon="?" title="Câu hỏi thường gặp" />
          {faqs.map((faq) => <details className="faq-item" key={faq.route}><summary>{faq.question}<span aria-hidden="true">＋</span></summary><p>{faq.answer}</p><a href={'#' + faq.route}>{faq.label} →</a></details>)}
        </SectionCard>
        <SectionCard className="feedback-card">
          <CardHeader icon="✦" title="Ghi lại góp ý" tone="violet" />
          <p>Điều gì sẽ giúp trải nghiệm học tập của bạn tốt hơn?</p>
          <form onSubmit={event => { event.preventDefault(); if (saveFeedback(message.trim())) setSaved(true) }}><textarea required maxLength={2000} aria-label="Nội dung góp ý" placeholder="Điều bạn muốn cải thiện…" value={message} onChange={event => { setMessage(event.target.value); setSaved(false) }} /><button className="primary-button" disabled={!message.trim()}>Lưu góp ý</button></form>
          <p role="status">{saved ? 'Đã lưu góp ý trên thiết bị này.' : 'Góp ý được lưu riêng trên thiết bị, chưa gửi đến nhà phát triển.'}</p>{error && <p role="alert">{error}</p>}
        </SectionCard>
      </div>
      <SectionCard className="contact-card"><div><span aria-hidden="true">📖</span><b>Cùng khám phá Nhịp Học</b><p>Tìm một cách học phù hợp với chính mình.</p></div><a className="ghost-button" href="#dashboard">Về góc học tập →</a></SectionCard>
    </>
  )
}
