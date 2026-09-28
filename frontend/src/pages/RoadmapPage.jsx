import { useState } from 'react'
import { addGoal } from '../data/goals'
import { CardHeader, PageIntro, ProgressBar, SectionCard } from '../components/PageComponents'

const stages = [
  { tone: 'blue', icon: '📖', label: 'Chặng 1', title: 'Nền tảng', state: 'Sẵn sàng' },
  { tone: 'mint', icon: '⚡', label: 'Chặng 2', title: 'Vận dụng', state: 'Chờ mở' },
  { tone: 'violet', icon: '🚀', label: 'Chặng 3', title: 'Bứt phá', state: 'Chờ mở' },
  { tone: 'gold', icon: '🏆', label: 'Chặng 4', title: 'Về đích', state: 'Khóa' },
]

export default function RoadmapPage({ onNavigate }) {
  const [error, setError] = useState('')
  function saveGoal(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = data.get('title').trim()
    if (!title) { setError('Hãy đặt tên cho mục tiêu của bạn.'); return }
    try {
      addGoal({ title, targetScore: data.get('targetScore'), date: data.get('date') })
      onNavigate('goals')
    } catch { setError('Chưa lưu được mục tiêu. Hãy kiểm tra quyền lưu dữ liệu của trình duyệt rồi thử lại.') }
  }
  return (
    <>
      <PageIntro eyebrow="🧭 KẾ HOẠCH CÁ NHÂN HÓA AI" title="Lộ trình học tập 🎯" subtitle="Chọn mục tiêu để Nhịp Học cùng bạn tạo hành trình vừa sức.">
        <div className="roadmap-kpis"><span>🏳️ <b>Mục tiêu</b><strong>0 đang theo đuổi</strong></span><span>◔ <b>Tiến độ chung</b><strong>0% sẵn sàng</strong></span></div>
      </PageIntro>
      <div className="roadmap-notice"><span>ⓘ Chưa kích hoạt mục tiêu nào <b>0%</b></span><p>Nhấn nút bên cạnh để bắt đầu hành trình của bạn</p><button className="primary-button" onClick={() => onNavigate('roadmap/goal-builder')}>◉ + Khởi tạo mục tiêu mới</button></div>
      <SectionCard className="roadmap-hero">
        <div className="roadmap-copy"><div className="badge-row"><span className="tag gold">⚑ CHƯA KÍCH HOẠT</span><span className="tag blue">Chưa chọn kỳ thi / chứng chỉ</span><span className="ready-label">✦ AI Study Planner sẵn sàng</span></div><h2>Chưa có lộ trình</h2><div className="chapter-progress"><div><b>Chặng 0: Khởi động & Thiết lập mục tiêu</b><span>/ 0 Chặng tổng thể</span><strong>0%</strong></div><ProgressBar value={0} /> <div className="mini-chapters">{['🏁 Nền tảng', '⚡ Vận dụng', '🚀 Bứt tốc', '🏆 Về đích'].map((name) => <span key={name}>{name}</span>)}</div></div><div className="roadmap-bottom"><span>▣ <b>HÔM NAY</b><strong>Chưa có bài học</strong></span><button className="primary-button" onClick={() => onNavigate('roadmap/goal-builder')}>⊕ + Tạo lộ trình</button></div></div>
        <div className="roadmap-score"><div className="score-ring"><strong>—</strong><span>🎯<br />Chưa đặt mục tiêu</span></div><div className="score-meta"><span><b>ĐÃ LÀM</b>0/0</span><span><b>THỜI HẠN</b>0 ngày</span><span><b>ĐỘ CHUẨN</b>0%</span></div></div>
      </SectionCard>
      <div className="section-heading"><h2>🗺️ Cấu trúc 4 chặng lộ trình</h2><span className="tag mint">Mô hình thích ứng AI</span><small>↻ Tự động phân bổ lại theo tiến độ thực tế</small></div>
      <div className="stage-grid">{stages.map((stage) => <SectionCard className={'stage-card ' + stage.tone} key={stage.title}><div className="stage-top"><span>{stage.label}</span><small>{stage.state}</small></div><div className="stage-icon">{stage.icon}</div><h3>{stage.label}: {stage.title}</h3><ProgressBar value={0} tone={stage.tone} /><p>0% (0/0 mốc)</p></SectionCard>)}</div>
      <div className="roadmap-bottom-grid"><SectionCard className="long-stage"><span className="tag blue">Chặng 1</span><h3>📖 Chặng 1: Nền tảng</h3><ProgressBar value={0} /><span className="muted-label">0% (0/0 mốc)</span></SectionCard><SectionCard className="goal-builder" id="goal-builder"><CardHeader icon="✦" title="Khởi tạo mục tiêu" tone="violet" /><p>AI Study Planner sẽ giúp bạn chia nhỏ mục tiêu thành từng bước dễ hoàn thành.</p><form onSubmit={saveGoal}><div className="field-grid goal-fields"><label className="full">Kỳ thi / mục tiêu<input name="title" required maxLength={160} placeholder="Ví dụ: Thi vào lớp 10" /></label><label>Điểm mục tiêu<input name="targetScore" type="number" min="0" max="10" step="0.1" placeholder="8.5" /></label><label>Ngày dự kiến<input name="date" type="date" required /></label></div><button className="primary-button" type="submit">Lưu mục tiêu ✦</button>{error && <p role="alert">{error}</p>}</form></SectionCard></div>
    </>
  )
}
