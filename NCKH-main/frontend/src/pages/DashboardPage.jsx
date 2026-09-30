import { useState } from 'react'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import { CardHeader, EmptyState } from '../components/PageComponents'

const stats = [
  { label: 'Chuỗi học', value: '0 ngày', icon: '🔥', tone: 'gold' },
  { label: 'Tuần này', value: '0 / 5', icon: '🌱', tone: 'blue' },
  { label: 'Trong 7 ngày', value: '0 hạn', icon: '☀️', tone: 'mint' },
]

export default function DashboardPage({ onNavigate }) {
  const [tasks, saveTasks, error] = useStoredState('nhip-hoc-tasks', [])
  const [deadlines, saveDeadlines, deadlineError] = useStoredState('nhip-hoc-deadlines', [])
  const [profile] = useStoredState('nhip-hoc-settings', {})
  const [showDeadline, setShowDeadline] = useState(false)
  const [title, setTitle] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [now] = useState(() => Date.now())
  const completed = tasks.filter(task => task.done).length
  const upcoming = deadlines.filter(item => { const due = new Date(item.date + 'T' + item.end); return due.getTime() >= now && due.getTime() <= now + 7 * 86400000 }).sort((a,b) => (a.date+a.end).localeCompare(b.date+b.end))
  function addTask(value) { if (!value.trim()) return false; return saveTasks([...tasks, { id: crypto.randomUUID(), title: value.trim(), done: false }]) }
  return (
    <>
      <section className="welcome-card dashboard-welcome">
        <div className="spark spark-one">✦</div><div className="spark spark-two">✧</div>
        <div className="welcome-top">
          <div>
            <p className="eyebrow">MỖI NGÀY MỘT CHÚT, MỖI NGÀY TIẾN BỘ ✨</p>
            <h1>Chào {profile.nickname || profile.name || "bạn"}! <span>👋</span></h1>
            <p className="welcome-subtitle">Mình cùng chọn một bước nhỏ để bắt đầu tuần này nhé.</p>
          </div>
          <div className="level-card"><div><span>CẤP 1</span><b>0 / 100 XP</b></div><div className="progress"><i style={{ width: '0%' }} /></div><small className="level-note">Tiến bộ nhỏ cũng đáng được ghi nhận</small></div>
        </div>
        <div className="welcome-stats">
          {stats.map((stat) => <div className={'stat-pill ' + stat.tone} key={stat.label}><div><span>{stat.label}</span><b>{stat.tone === 'blue' ? completed + ' / ' + tasks.length : stat.tone === 'mint' ? upcoming.length + ' hạn' : stat.value}</b></div><i>{stat.icon}</i></div>)}
        </div>
      </section>

      <div className="content-grid dashboard-focus-grid">
        <div className="primary-column">
          <section className="dashboard-card tasks-card weekly-focus" id="tasks">
            <CardHeader icon="☷" title="Việc cần làm tuần này" tone="violet" action="Lịch" onAction={() => onNavigate('schedule')} />
            <div className="focus-intro"><strong>Chọn 1 việc để bắt nhịp</strong><span>{completed} / {tasks.length} việc hoàn thành</span></div>
            <div className="focus-progress"><i style={{ width: (tasks.length ? completed / tasks.length * 100 : 0) + '%' }} /></div>
            {tasks.length ? <div className="task-list">{tasks.map(task => <div className="task-item" key={task.id}><label><input type="checkbox" checked={task.done} onChange={() => saveTasks(tasks.map(item => item.id === task.id ? {...item, done: !item.done} : item))} /><span style={{textDecoration: task.done ? 'line-through' : 'none'}}>{task.title}</span></label><button className="delete-button" aria-label={'Xóa ' + task.title} onClick={() => saveTasks(tasks.filter(item => item.id !== task.id))}>Xóa</button></div>)}</div> : <EmptyState icon="☷" title="Tuần mới còn nhiều khoảng trống cho bạn" tone="violet" button="Thêm việc đầu tiên" onAction={() => setShowModal(true)} />}
            <form className="quick-add" onSubmit={e => { e.preventDefault(); if(addTask(title)) setTitle('') }}><input required maxLength={160} aria-label="Tên công việc" placeholder="Ví dụ: Ôn 10 từ vựng..." value={title} onChange={e => setTitle(e.target.value)} /><button>＋ Việc mới</button></form>{error && <p role="alert">{error}</p>}
          </section>
          <section className="dashboard-card deadline-card" id="deadlines">
            <CardHeader icon="◉" title="Hạn chót trong 7 ngày" tone="orange" action="Thêm" onAction={() => setShowDeadline(true)} />
            <span className="count-badge">{upcoming.length} hạn</span>{upcoming.length ? upcoming.map(item => <div className="deadline-item" key={item.id}><div><b>{item.title}</b><small>{item.date.split('-').reverse().join('/')} · {item.start}–{item.end}</small></div></div>) : <EmptyState icon="☀" title="Chưa có hạn chót nào trong tuần này" tone="orange" />}
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
      {showDeadline && <Modal title="Thêm hạn chót" onClose={() => setShowDeadline(false)}><form onSubmit={event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (saveDeadlines([...deadlines, {...data, title: data.title.trim(), start: '00:00', tone: 'orange', id: crypto.randomUUID()}])) setShowDeadline(false) }}><label>Tên hạn chót<input name="title" required pattern=".*\S.*" maxLength={160} autoFocus /></label><label>Môn học<input name="subject" maxLength={80} /></label><label>Ngày<input name="date" type="date" required /></label><label>Hạn chót<input name="end" type="time" required defaultValue="23:59" /></label>{deadlineError && <p role="alert">{deadlineError}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => setShowDeadline(false)}>Hủy</button><button className="primary-button">Lưu hạn chót</button></div></form></Modal>}
      {showModal && <Modal title="Thêm việc đầu tiên" onClose={() => setShowModal(false)}><form onSubmit={e => { e.preventDefault(); if(addTask(modalTitle)) { setModalTitle(''); setShowModal(false) } }}><label>Tên công việc<input autoFocus required maxLength={160} value={modalTitle} onChange={e => setModalTitle(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => setShowModal(false)}>Hủy</button><button className="primary-button">Thêm việc</button></div></form></Modal>}
    </>
  )
}
