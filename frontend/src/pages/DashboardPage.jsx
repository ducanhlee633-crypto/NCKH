import { CardHeader, EmptyState } from '../components/PageComponents'

const stats = [
  { label: 'Chuỗi học', value: '0 ngày', icon: '🔥', tone: 'gold' },
  { label: 'Tuần này', value: '0 / 5', icon: '🌱', tone: 'blue' },
  { label: 'Trong 7 ngày', value: '0 hạn', icon: '☀️', tone: 'mint' },
]

export default function DashboardPage({ onNavigate }) {
  return (
    <>
      <section className="welcome-card dashboard-welcome">
        <div className="spark spark-one">✦</div><div className="spark spark-two">✧</div>
        <div className="welcome-top">
          <div>
            <p className="eyebrow">MỖI NGÀY MỘT CHÚT, MỖI NGÀY TIẾN BỘ ✨</p>
            <h1>Chào Minh Anh! <span>👋</span></h1>
            <p className="welcome-subtitle">Mình cùng chọn một bước nhỏ để bắt đầu tuần này nhé.</p>
          </div>
          <div className="level-card"><div><span>CẤP 1</span><b>0 / 100 XP</b></div><div className="progress"><i /></div><small className="level-note">Tiến bộ nhỏ cũng đáng được ghi nhận</small></div>
        </div>
        <div className="welcome-stats">
          {stats.map((stat) => <div className={'stat-pill ' + stat.tone} key={stat.label}><div><span>{stat.label}</span><b>{stat.value}</b></div><i>{stat.icon}</i></div>)}
        </div>
      </section>

      <div className="content-grid dashboard-focus-grid">
        <div className="primary-column">
          <section className="dashboard-card tasks-card weekly-focus" id="tasks">
            <CardHeader icon="☷" title="Việc cần làm tuần này" tone="violet" action="Lịch" onAction={() => onNavigate('schedule')} />
            <div className="focus-intro"><strong>Chọn 1 việc để bắt nhịp</strong><span>0 / 5 việc hoàn thành</span></div>
            <div className="focus-progress"><i /></div>
            <EmptyState icon="☷" title="Tuần mới còn nhiều khoảng trống cho bạn" tone="violet" button="Thêm việc đầu tiên" />
            <div className="quick-add"><input aria-label="Tên công việc" placeholder="Ví dụ: Ôn 10 từ vựng..." /><button>＋ Việc mới</button></div>
          </section>
          <section className="dashboard-card deadline-card" id="deadlines">
            <CardHeader icon="◉" title="Hạn chót trong 7 ngày" tone="orange" action="Xem lịch" onAction={() => onNavigate('schedule')} />
            <span className="count-badge">0 hạn</span><EmptyState icon="☀" title="Chưa có hạn chót nào trong tuần này" tone="orange" />
          </section>
        </div>
        <aside className="secondary-column">
          <section className="dashboard-card streak-card" id="streaks">
            <CardHeader icon="🔥" title="Chuỗi của bạn" tone="gold" />
            <div className="streak-visual"><strong>0</strong><span>ngày liên tiếp</span></div>
            <p className="streak-message">Bắt đầu bằng 10 phút hôm nay. Ngày mai, bạn sẽ cảm ơn mình.</p>
            <button className="primary-button streak-action" onClick={() => onNavigate('schedule')}>Bắt đầu nhẹ nhàng</button>
          </section>
          <section className="dashboard-card rhythm-card">
            <CardHeader icon="✦" title="Một lời nhắc nhỏ" tone="mint" />
            <p className="rhythm-quote">“Không cần hoàn hảo. Chỉ cần tiếp tục theo nhịp của riêng bạn.”</p>
            <button className="outline-button" onClick={() => onNavigate('roadmap')}>Xem lộ trình học</button>
          </section>
        </aside>
      </div>
    </>
  )
}
