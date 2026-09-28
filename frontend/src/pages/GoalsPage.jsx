import { useState } from 'react'
import { PageIntro, ProgressBar, SectionCard } from '../components/PageComponents'
import { readGoals } from '../data/goals'

function formatDate(value) {
  const date = new Date(value + 'T00:00:00')
  return Number.isNaN(date.getTime()) ? 'Chưa chọn ngày' : new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export default function GoalsPage({ onNavigate }) {
  const [result] = useState(() => {
    try { return { goals: readGoals() } } catch { return { goals: [], error: true } }
  })
  const goals = result.goals.map((goal) => ({ ...goal, tone: 'mint', icon: '🌱', subject: goal.targetScore ? `Điểm mong muốn: ${goal.targetScore}` : 'Mục tiêu cá nhân', note: goal.progress === 100 ? 'Bạn đã làm được! Hãy dành một chút thời gian tự hào về mình.' : 'Mỗi bước nhỏ đều đưa bạn đến gần hơn.' }))
  const average = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length) : 0
  const nextGoal = [...goals].sort((a, b) => b.progress - a.progress)[0]

  return (
    <>
      <PageIntro eyebrow="🌱 NHỊP TIẾN BỘ CỦA RIÊNG BẠN" title="Mục tiêu của bạn 🎯" subtitle="Mỗi mục tiêu là một lời hứa dịu dàng với chính mình. Cứ tiến từng bước nhỏ nhé.">
        <button className="primary-button" onClick={() => onNavigate('roadmap/goal-builder')}>＋ Thêm mục tiêu</button>
      </PageIntro>
      <section className="goals-hero">
        <div className="goals-hero-copy"><span className="goals-kicker">MỖI BƯỚC NHỎ ĐỀU ĐÁNG GHI NHẬN</span><h2>Không cần nhanh.<br /><em>Chỉ cần tiếp tục.</em></h2><p>{nextGoal ? nextGoal.note : 'Chọn một mục tiêu nhỏ để bắt đầu hành trình của bạn.'}</p><button className="outline-button" onClick={() => onNavigate('schedule')}>Bắt đầu một bước nhỏ →</button></div>
        <div className="goals-overview"><div className="goals-ring" style={{ '--goal-progress': `${average * 3.6}deg` }}><strong>{average}%</strong><span>tiến độ chung</span></div><div className="goals-overview-copy"><b>{goals.length} mục tiêu</b><span>đang được bạn vun đắp</span><small>✨ Tiến bộ nhỏ vẫn là tiến bộ</small></div></div>
      </section>
      <div className="goals-heading"><div><h2>Những điều bạn đang hướng tới</h2><p>Đích đến để truyền cảm hứng, không phải áp lực.</p></div><span className="goals-count">{goals.length} mục tiêu</span></div>
      {result.error ? <p role="alert">Chưa đọc được mục tiêu đã lưu. Hãy thử tải lại trang.</p> : goals.length === 0 && <SectionCard><h2>Gieo mục tiêu đầu tiên của bạn 🌱</h2><p>Bạn muốn tự tin hơn ở điều gì? Hãy bắt đầu từ đó.</p><button className="primary-button" onClick={() => onNavigate('roadmap/goal-builder')}>Thiết lập mục tiêu</button></SectionCard>}
      <div className="goals-grid">{goals.map((goal) => <SectionCard className={'goal-card ' + goal.tone} key={goal.id}><div className="goal-card-top"><span className="goal-icon">{goal.icon}</span><span className="goal-subject">{goal.subject}</span></div><h3>{goal.title}</h3><div className="goal-date"><span>🏁</span><div><small>{goal.completedAt ? "Ngày đã hoàn thành" : "Ngày hoàn thành dự kiến"}</small><b>{formatDate(goal.completedAt || goal.date)}</b></div></div><div className="goal-progress-label"><span>Tiến độ hiện tại</span><strong>{goal.progress}%</strong></div><div role="progressbar" aria-label={goal.title} aria-valuenow={goal.progress} aria-valuemin={0} aria-valuemax={100}><ProgressBar value={goal.progress} tone={goal.tone} /></div><p className="goal-note">{goal.note}</p><button className="goal-action" onClick={() => onNavigate('roadmap')}>Xem hành trình <span>→</span></button></SectionCard>)}</div>
      <section className="goals-encouragement"><span>✦</span><div><b>Một lời nhắc cho hôm nay</b><p>Chọn một việc chỉ mất 10 phút. Bạn không cần hoàn thành cả hành trình trong một ngày.</p></div><span>🌤️</span></section>
    </>
  )
}
