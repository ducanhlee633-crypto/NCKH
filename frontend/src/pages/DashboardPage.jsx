import { CardHeader, EmptyState } from '../components/PageComponents'

const stats = [
  { label: 'Chuỗi ngày', value: '0 ngày', icon: '🔥', tone: 'gold' },
  { label: 'Hôm nay', value: '0h', icon: '☀️', tone: 'blue' },
  { label: 'Nhiệm vụ', value: '0 / 0', icon: '✓', tone: 'mint' },
]

export default function DashboardPage({ onNavigate }) {
  return (
    <>
      <section className="welcome-card">
        <div className="spark spark-one">✦</div><div className="spark spark-two">✧</div>
        <div className="welcome-top">
          <div>
            <p className="eyebrow">MỖI NGÀY MỘT CHÚT, MỖI NGÀY TIẾN BỘ ✨</p>
            <h1>Chào Minh Anh! <span>👋</span></h1>
            <p className="welcome-subtitle">Học tập nhẹ nhàng, từng bước mỗi ngày</p>
          </div>
          <div className="level-card"><div><span>CẤP 1</span><b>0 / 100 XP</b></div><div className="progress"><i /></div></div>
        </div>
        <div className="welcome-stats">
          {stats.map((stat) => <div className={'stat-pill ' + stat.tone} key={stat.label}><div><span>{stat.label}</span><b>{stat.value}</b></div><i>{stat.icon}</i></div>)}
        </div>
      </section>

      <div className="content-grid">
        <div className="primary-column">
          <section className="dashboard-card score-card">
            <CardHeader icon="↗" title="Bảng điểm" action="Nhập điểm" />
            <EmptyState icon="♜" title="Chưa có dữ liệu điểm" button="Thêm điểm môn" />
          </section>
          <section className="dashboard-card tasks-card" id="tasks">
            <CardHeader icon="☷" title="Việc cần làm" tone="violet" />
            <span className="count-badge">0 việc</span>
            <EmptyState icon="☷" title="Chưa có việc nào cần làm" tone="violet" />
            <div className="quick-add"><input aria-label="Tên công việc" placeholder="Nhập tên công việc..." /><button>＋ Việc mới</button></div>
          </section>
          <section className="dashboard-card schedule-card">
            <CardHeader icon="▥" title="Lịch học & Báo cáo" tone="mint" action="Lịch" onAction={() => onNavigate('schedule')} />
            <EmptyState icon="▥" title="Chưa có dữ liệu học tập" tone="mint" />
          </section>
        </div>
        <aside className="secondary-column">
          <section className="dashboard-card pomodoro-card">
            <CardHeader icon="◷" title="Pomodoro" tone="coral" />
            <span className="session-badge">Phiên 3/6</span>
            <div className="timer-ring"><div><strong>25:00</strong><span>Tập trung nhé!</span></div></div>
            <div className="timer-actions"><button className="primary-button" onClick={() => onNavigate('pomodoro')}>▶ &nbsp; Bắt đầu</button><button className="icon-button">▮▶</button></div>
          </section>
          <section className="dashboard-card deadline-card">
            <CardHeader icon="◉" title="Hạn chót" tone="orange" />
            <span className="count-badge">0</span><EmptyState icon="▣" title="Không có hạn chót sắp tới" tone="orange" />
          </section>
          <section className="dashboard-card friends-card">
            <CardHeader icon="♧" title="Bạn bè" tone="pink" />
            <span className="count-badge">0</span>
            <div className="friend-empty"><div className="mascot">🦊</div><p>Chưa có bạn bè</p><button className="primary-button" onClick={() => onNavigate('friends')}>＋ Tìm bạn</button></div>
          </section>
        </aside>
      </div>
    </>
  )
}
