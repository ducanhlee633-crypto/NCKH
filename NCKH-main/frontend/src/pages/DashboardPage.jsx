import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import Icon from '../components/Icon'
import useStoredState from '../data/useStoredState'
import { CardHeader, EmptyState, ProgressBar } from '../components/PageComponents'
import { displayUser, getSession, onSessionChange } from '../backendApi'
import { gradeLabel } from '../data/settings'
import { calendarEvents } from '../data/calendar'

const dateKey = date => date.toLocaleDateString('en-CA')

export default function DashboardPage({ onNavigate }) {
  const [tasks, saveTasks, error] = useStoredState('nhip-hoc-tasks', [])
  const [deadlines, saveDeadlines, deadlineError] = useStoredState('nhip-hoc-deadlines', [])
  const [profile] = useStoredState('nhip-hoc-settings', {})
  const [accountName, setAccountName] = useState(() => displayUser(getSession())?.name || 'bạn')
  useEffect(() => onSessionChange((session) => setAccountName(displayUser(session)?.name || 'bạn')), [])
  const [events] = useStoredState('nhip-hoc-events', {})
  const [roadmaps] = useStoredState('nhip-hoc-roadmaps', [])
  const [focus] = useStoredState('nhip-hoc-focus', {})
  const [showDeadline, setShowDeadline] = useState(false)
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState('all')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer) }, [])
  const today = dateKey(now)
  const completed = tasks.filter(task => task.done).length
  const remaining = tasks.length - completed
  const nextTask = tasks.find(task => !task.done)
  const upcoming = deadlines.filter(item => { const due = new Date(item.date + 'T' + item.end); return due >= now && due.getTime() <= now.getTime() + 7 * 86400000 }).sort((a, b) => (a.date + a.end).localeCompare(b.date + b.end))
  const sessions = focus.date === today ? focus.sessions || 0 : 0
  const week = Array.from({ length: 7 }, (_, index) => { const day = new Date(now); day.setDate(day.getDate() - (day.getDay() + 6) % 7 + index); return day })
  const visibleTasks = tasks.filter(task => filter === 'all' || (filter === 'done' ? task.done : !task.done))
  const calendar = calendarEvents(events, roadmaps, deadlines)
  const lessonsToday = calendar[today] || []
  const taskInput = () => document.getElementById('new-task')?.focus()
  function addTask(event) {
    event.preventDefault()
    if (title.trim() && saveTasks([...tasks, { id: crypto.randomUUID(), title: title.trim(), done: false }])) { setTitle(''); setFilter('all') }
  }
  return <>
    <section className="study-welcome">
      <div><p className="eyebrow">{now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Chào {accountName}, hôm nay học gì?</h1><p className="page-subtitle">Một việc vừa sức. Một khoảng tập trung. Từng chút tiến bộ.</p></div>
      <a className="ghost-button" href="#schedule"><Icon name="schedule" size={18} />Xem lịch học</a>
    </section>

    <section className="study-notebook" aria-labelledby="notebook-title">
      <div className="notebook-copy">
        <span className="notebook-tab"><Icon name="book" size={16} />Sổ học tập của bạn</span>
        <p className="notebook-context">{gradeLabel(profile.grade)}</p>
        <h2 id="notebook-title">Bắt đầu nhỏ,<br /> hiểu thêm mỗi ngày.</h2>
        <p>{nextTask ? <>Việc tiếp theo: <strong>{nextTask.title}</strong></> : 'Ghi lại bài cần làm, rồi dành một khoảng thời gian riêng cho việc học.'}</p>
        <button className="primary-button" onClick={() => nextTask ? onNavigate('pomodoro') : taskInput()}>{nextTask ? 'Vào phòng tập trung' : 'Thêm việc đầu tiên'}<Icon name="arrow" size={18} /></button>
      </div>
      <div className="notebook-week">
        <div className="notebook-week-heading"><b>Tuần của bạn</b><span>{week[0].getDate()}/{week[0].getMonth() + 1} – {week[6].getDate()}/{week[6].getMonth() + 1}</span></div>
        <ol className="week-strip">{week.map((day, index) => {
          const key = dateKey(day)
          const count = (calendar[key] || []).length
          return <li key={key} className={key === today ? 'is-today' : ''} aria-current={key === today ? 'date' : undefined}><span>{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][index]}</span><b>{day.getDate()}</b><span className={'day-dot ' + (count ? 'has-lessons' : '')} aria-label={count + ' lịch học'} /></li>
        })}</ol>
        <div className="notebook-week-foot"><span><i />Có lịch học</span><a href="#schedule">Sắp xếp tuần này <span aria-hidden="true">↗</span></a></div>
        <div className="notebook-note"><Icon name="check" size={19} /><p>Lịch học ở trường, bài tập về nhà và thời gian nghỉ — đều có chỗ trong tuần của bạn.</p></div>
      </div>
    </section>

    <div className="study-summary" aria-label="Tình hình học tập">
      {[['goals', remaining, 'việc cần làm', 'violet'], ['schedule', upcoming.length, 'hạn nộp trong 7 ngày', 'gold'], ['pomodoro', sessions * 25, 'phút tập trung hôm nay', 'mint']].map(([icon, value, label, tone]) => <div className={'study-summary-item ' + tone} key={icon}><span className={'header-icon ' + tone}><Icon name={icon} /></span><div><b>{value}</b><span>{label}</span></div></div>)}
    </div>

    <div className="content-grid student-dashboard-grid">
      <div className="primary-column">
        <section className="dashboard-card student-tasks" id="tasks">
          <CardHeader icon={<Icon name="check" />} title="Việc cần làm" tone="violet" />
          <div className="task-progress-copy"><span>{completed} / {tasks.length} việc đã hoàn thành</span><b>{tasks.length ? Math.round(completed / tasks.length * 100) : 0}%</b></div>
          <ProgressBar value={tasks.length ? completed / tasks.length * 100 : 0} tone="violet" />
          <div className="task-filters" aria-label="Lọc việc cần làm">{[['all', 'Tất cả'], ['todo', 'Chưa xong'], ['done', 'Đã xong']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
          {visibleTasks.length ? <div className="task-list">{visibleTasks.map(task => <div className={'task-item ' + (task.done ? 'is-complete' : '')} key={task.id}><label><input type="checkbox" checked={task.done} onChange={() => saveTasks(tasks.map(item => item.id === task.id ? { ...item, done: !item.done } : item))} /><span>{task.title}</span></label><button className="delete-button" aria-label={'Xóa ' + task.title} onClick={() => saveTasks(tasks.filter(item => item.id !== task.id))}>Xóa</button></div>)}</div> : <EmptyState icon={<Icon name="book" size={26} />} title={tasks.length ? 'Chưa có việc nào trong mục này.' : 'Bắt đầu với một bài tập hoặc một phần cần ôn.'} tone="violet" />}
          <form className="quick-add" onSubmit={addTask}><label className="sr-only" htmlFor="new-task">Việc cần làm</label><input id="new-task" required maxLength={160} placeholder="Ví dụ: Ôn 10 từ vựng tiếng Anh" value={title} onChange={event => setTitle(event.target.value)} /><button><Icon name="plus" size={17} />Thêm việc</button></form>
          {error && <p role="alert">{error}</p>}
        </section>
        <section className="dashboard-card student-deadlines" id="deadlines">
          <CardHeader icon={<Icon name="schedule" />} title="Sắp đến hạn nộp" tone="orange" action="Thêm hạn nộp" onAction={() => setShowDeadline(true)} />
          {upcoming.length ? <div className="student-deadline-list">{upcoming.map(item => <div className="student-deadline" key={item.id}><time dateTime={item.date}><b>{Number(item.date.slice(8))}</b><span>Tháng {Number(item.date.slice(5, 7))}</span></time><div><b>{item.title}</b><small>{item.subject || 'Bài tập'} · {item.end}</small></div><span className="deadline-status">{item.date === today ? 'Hôm nay' : item.date.split('-').reverse().slice(0, 2).join('/')}</span></div>)}</div> : <EmptyState icon={<Icon name="check" size={24} />} title="Chưa có hạn nộp trong 7 ngày tới. Thêm bài tập để dễ theo dõi." tone="orange" />}
        </section>
      </div>
      <aside className="secondary-column student-side">
        <section className="dashboard-card today-card">
          <CardHeader icon={<Icon name="schedule" />} title="Lịch hôm nay" tone="blue" />
          {lessonsToday.length ? <ol className="today-lessons">{lessonsToday.map(item => <li key={item.id}><time>{item.deadline ? item.end : item.start}<small>{item.deadline ? 'Hạn nộp' : item.end}</small></time><div><b>{item.title}</b><span>{item.subject || 'Lịch học cá nhân'}</span></div></li>)}</ol> : <div className="today-empty"><Icon name="schedule" size={30} /><b>Hôm nay chưa có lịch học</b><p>Thêm tiết học hoặc buổi ôn tập để chủ động thời gian.</p></div>}
          <a className="outline-button" href="#schedule">Mở lịch học <Icon name="arrow" size={16} /></a>
        </section>
        <section className="focus-invitation">
          <span className="focus-invitation-icon"><Icon name="pomodoro" size={26} /></span><p className="eyebrow">DÀNH MỘT KHOẢNG CHO MÌNH</p><h2>25 phút, một việc thôi.</h2><p>Chọn bài cần học, tắt thông báo và bắt đầu. Hết phiên, nghỉ 5 phút nhé.</p><a className="primary-button" href="#pomodoro">Vào phòng tập trung<Icon name="arrow" size={17} /></a>
        </section>
        <a className="study-help-link" href="#help"><Icon name="help" size={18} /><span>Mới dùng Nhịp Học? Xem hướng dẫn</span><Icon name="arrow" size={16} /></a>
      </aside>
    </div>
    {showDeadline && <Modal title="Thêm hạn nộp" onClose={() => setShowDeadline(false)}><form onSubmit={event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (saveDeadlines([...deadlines, { ...data, title: data.title.trim(), start: '00:00', tone: 'orange', id: crypto.randomUUID() }])) setShowDeadline(false) }}><label>Tên bài tập<input name="title" required pattern=".*\S.*" maxLength={160} placeholder="Ví dụ: Nộp bài thuyết trình Ngữ văn" autoFocus /></label><label>Môn học<input name="subject" maxLength={80} placeholder="Ví dụ: Ngữ văn" /></label><label>Ngày nộp<input name="date" type="date" required /></label><label>Giờ nộp<input name="end" type="time" required defaultValue="23:59" /></label>{deadlineError && <p role="alert">{deadlineError}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => setShowDeadline(false)}>Hủy</button><button className="primary-button">Lưu hạn nộp</button></div></form></Modal>}
  </>
}
