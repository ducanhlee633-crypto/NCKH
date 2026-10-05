import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import Icon from '../components/Icon'
import useStoredState from '../data/useStoredState'
import useScheduleBlocks from '../data/useScheduleBlocks'
import useDeadlines from '../data/useDeadlines'
import useRoadmaps from '../data/useRoadmaps'
import { CardHeader, EmptyState, ProgressBar } from '../components/PageComponents'
import { createDeadline, displayUser, fetchPomodoroSessions, getSession, onSessionChange, updateDeadline } from '../backendApi'
import { gradeLabel } from '../data/settings'
import { calendarEvents } from '../data/calendar'

const dateKey = date => date.toLocaleDateString('en-CA')
const deadlineDateOf = item => item?.date || item?.due_date || ''
const deadlineTimeOf = item => String(item?.time || item?.due_time || item?.end || item?.start || '23:59').slice(0, 5)
const deadlineStatusOf = item => !!item?.status
const deadlinePriorityOf = item => (item?.priority === 'high' || item?.priority === 'low' ? item.priority : 'medium')
const PRIORITY_LABEL_DASH = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' }

// Ngày local của 1 phiên Pomodoro (dùng started_at). Server lọc theo ngày UTC nên
// phiên sáng sớm giờ VN (UTC+7) có thể rơi sang hôm trước — phải lọc lại local ở đây
// (cùng cách làm với StatsPage) thì "phút tập trung hôm nay" mới đúng.
const sessionLocalDay = row => {
  const date = new Date(row?.started_at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-CA')
}
const sessionMinutes = row => Math.max(0, Number(row?.focus_minutes ?? 0) || 0)
// Số phút focus mỗi phiên do user tự chỉnh (25/50/90/custom) nằm ở 'nhip-hoc-durations'.
// Fallback cho bản local cũ thiếu field `minutes`: đừng cứng 25.
function readFocusLengthFallback() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-durations'))
    if (Array.isArray(saved) && Number.isInteger(saved[0]) && saved[0] >= 1 && saved[0] <= 180) return saved[0]
  } catch { /* Storage may be unavailable. */ }
  return 25
}
function localMinutesOf(focus, todayKey) {
  if (!focus || focus.date !== todayKey) return 0
  if (Number.isInteger(focus.minutes) && focus.minutes >= 0) return focus.minutes
  const sessions = Number.isInteger(focus.sessions) && focus.sessions > 0 ? focus.sessions : 0
  return sessions * readFocusLengthFallback()
}

export default function DashboardPage({ onNavigate }) {
  const [tasks, saveTasks, error] = useStoredState('nhip-hoc-tasks', [])
  const { deadlines, loggedIn: deadlineLoggedIn, serverRows: deadlineRows, setServerRows: setDeadlineRows, setLocalDeadlines: saveDeadlines, localError: deadlineLocalError } = useDeadlines()
  const [deadlineError, setDeadlineError] = useState('')
  const [profile] = useStoredState('nhip-hoc-settings', {})
  const [accountName, setAccountName] = useState(() => displayUser(getSession())?.name || 'bạn')
  // Lớp ưu tiên từ profile server khi đã đăng nhập, fallback settings local.
  const [serverGrade, setServerGrade] = useState(() => getSession()?.profile?.grade || '')
  useEffect(() => onSessionChange((session) => {
    setAccountName(displayUser(session)?.name || 'bạn')
    setServerGrade(session?.profile?.grade || '')
  }), [])
  // Cùng nguồn sự thật với SchedulePage: login -> server, chưa login -> local.
  // Sửa lỗi dashboard báo sai (hiện block IELTS đã xóa) do trước đây chỉ đọc local.
  const { eventMap: events, loadingSchedule } = useScheduleBlocks()
  // Lộ trình hiển thị trong lịch: login -> server, chưa login -> local cũ.
  const { roadmaps } = useRoadmaps()
  const [focus] = useStoredState('nhip-hoc-focus', {})
  const [serverFocusMinutes, setServerFocusMinutes] = useState(null)
  const [hasSession, setHasSession] = useState(() => !!getSession())
  useEffect(() => {
    let cancelled = false
    const load = async (session) => {
      const active = session ?? getSession()
      setHasSession(!!active)
      if (!active) {
        if (!cancelled) setServerFocusMinutes(null)
        return
      }
      try {
        // Lấy rộng ±1 ngày rồi lọc theo ngày local: bù lệch múi giờ UTC của server
        // (phiên sáng sớm giờ VN thuộc UTC hôm trước, query đúng hôm nay sẽ mất).
        const base = new Date()
        const lower = new Date(base)
        lower.setDate(lower.getDate() - 1)
        const upper = new Date(base)
        upper.setDate(upper.getDate() + 1)
        const rows = await fetchPomodoroSessions(dateKey(lower), dateKey(upper))
        if (cancelled) return
        const key = dateKey(new Date())
        const total = (Array.isArray(rows) ? rows : [])
          .filter(row => sessionLocalDay(row) === key)
          .reduce((sum, row) => sum + sessionMinutes(row), 0)
        setServerFocusMinutes(total)
      } catch {
        // Rớt mạng: giữ số local.
      }
    }
    // onSessionChange gọi load ngay 1 lần + mỗi khi login/logout.
    const stopSession = onSessionChange(load)    // Timer có thể chạy xong ở nền (PomodoroPage keepalive) trong lúc user đang ở
    // dashboard: refresh khi quay lại dashboard / focus lại tab / có số local mới / định kỳ.
    const refresh = () => load()
    const onHash = () => {
      if ((window.location.hash || '').replace(/^#/, '').split('/')[0] === 'dashboard') refresh()
    }
    const onStorage = event => {
      if (event.key === 'nhip-hoc-focus' || event.key === null) refresh()
    }
    const onLocalUpdate = event => {
      if (!event?.detail || event.detail.key === 'nhip-hoc-focus') refresh()
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', onStorage)
    window.addEventListener('nhip-hoc-storage', onLocalUpdate)
    const timer = setInterval(refresh, 30000)
    return () => {
      cancelled = true
      stopSession()
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('nhip-hoc-storage', onLocalUpdate)
      clearInterval(timer)
    }
  }, [])
  const [showDeadline, setShowDeadline] = useState(false)
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState('all')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer) }, [])
  const today = dateKey(now)
  const completed = tasks.filter(task => task.done).length
  const remaining = tasks.length - completed
  const nextTask = tasks.find(task => !task.done)
  const upcoming = deadlines.filter(item => { if (deadlineStatusOf(item)) return false; const day = deadlineDateOf(item); if (!day) return false; const due = new Date(day + 'T' + deadlineTimeOf(item)); return due >= now && due.getTime() <= now.getTime() + 7 * 86400000 }).sort((a, b) => (deadlineDateOf(a) + deadlineTimeOf(a)).localeCompare(deadlineDateOf(b) + deadlineTimeOf(b)))
  const localFocusMinutes = localMinutesOf(focus, today)
  // Đã đăng nhập: lấy max(server, local) để không tụt số trong lúc phiên mới
  // vừa xong local nhưng POST server chưa kịp về; chưa đăng nhập: chỉ dùng local.
  const focusMinutesToday = hasSession ? Math.max(serverFocusMinutes ?? 0, localFocusMinutes) : localFocusMinutes
  const week = Array.from({ length: 7 }, (_, index) => { const day = new Date(now); day.setDate(day.getDate() - (day.getDay() + 6) % 7 + index); return day })
  const visibleTasks = tasks.filter(task => filter === 'all' || (filter === 'done' ? task.done : !task.done))
  const calendar = calendarEvents(events, roadmaps, deadlines)
  const lessonsToday = calendar[today] || []
  const taskInput = () => document.getElementById('new-task')?.focus()
  function addTask(event) {
    event.preventDefault()
    if (title.trim() && saveTasks([...tasks, { id: crypto.randomUUID(), title: title.trim(), done: false }])) { setTitle(''); setFilter('all') }
  }
  function addDeadline(event) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    const title = String(data.title || '').trim()
    const day = data.date
    const time = String(data.time || data.end || '23:59').slice(0, 5)
    if (!title || !day || !time) { setDeadlineError('Hãy điền tên, ngày và giờ nộp.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) { setDeadlineError('Ngày hoặc giờ nộp chưa hợp lệ.'); return }
    const priority = data.priority === 'high' || data.priority === 'low' ? data.priority : 'medium'
    setDeadlineError('')
    if (deadlineLoggedIn && deadlineRows) {
      const payload = { title, due_date: day, due_time: time, priority, status: false }
      const tempId = 'temp-' + Date.now()
      setDeadlineRows(rows => [...(rows || []), { id: tempId, user_id: 'local', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload }])
      setShowDeadline(false)
      createDeadline(payload)
        .then(created => setDeadlineRows(rows => (rows || []).map(row => row.id === tempId ? created : row)))
        .catch(failure => {
          setDeadlineRows(rows => (rows || []).filter(row => row.id !== tempId))
          setDeadlineError(failure.friendlyMessage || 'Không lưu được hạn nộp lên server.')
        })
      return
    }
    if (saveDeadlines([...deadlines, { title, date: day, time, end: time, start: '00:00', tone: 'orange', priority, status: false, id: crypto.randomUUID() }])) setShowDeadline(false)
  }
  function toggleDeadline(id) {
    if (!id) return
    const target = (deadlines || []).find(item => item.id === id)
    if (!target) return
    const nextStatus = !deadlineStatusOf(target)
    if (deadlineLoggedIn && deadlineRows) {
      if (String(id).startsWith('temp-')) {
        setDeadlineRows(rows => (rows || []).map(row => row.id === id ? { ...row, status: nextStatus } : row))
        return
      }
      const snapshot = deadlineRows
      setDeadlineRows(rows => (rows || []).map(row => row.id === id ? { ...row, status: nextStatus } : row))
      updateDeadline(id, { status: nextStatus }).then(
        updated => setDeadlineRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row)),
        failure => { setDeadlineRows(snapshot); setDeadlineError(failure.friendlyMessage || 'Không đổi được trạng thái hạn nộp.') },
      )
      return
    }
    saveDeadlines((deadlines || []).map(item => item.id === id ? { ...item, status: nextStatus } : item))
  }
  return <>
    <section className="study-welcome">
      <div><p className="eyebrow">{now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Chào {accountName}, hôm nay học gì?</h1><p className="page-subtitle">Một việc vừa sức. Một khoảng tập trung. Từng chút tiến bộ.</p></div>
      <a className="ghost-button" href="#schedule"><Icon name="schedule" size={18} />Xem lịch học</a>
    </section>

    <section className="study-notebook" aria-labelledby="notebook-title">
      <div className="notebook-copy">
        <span className="notebook-tab"><Icon name="book" size={16} />Sổ học tập của bạn</span>
        <p className="notebook-context">{gradeLabel(serverGrade || profile.grade)}</p>
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
      {[['goals', remaining, 'việc cần làm', 'violet'], ['schedule', upcoming.length, 'hạn nộp trong 7 ngày', 'gold'], ['pomodoro', focusMinutesToday, 'phút tập trung hôm nay', 'mint']].map(([icon, value, label, tone]) => <div className={'study-summary-item ' + tone} key={icon}><span className={'header-icon ' + tone}><Icon name={icon} /></span><div><b>{value}</b><span>{label}</span></div></div>)}
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
          {upcoming.length ? <div className="student-deadline-list">{upcoming.map(item => { const day = deadlineDateOf(item); return <div className="student-deadline" key={item.id}><time dateTime={day}><b>{Number(day.slice(8))}</b><span>Tháng {Number(day.slice(5, 7))}</span></time><div><b>{item.title}</b><small>{item.subject || 'Bài tập'} · {deadlineTimeOf(item)} · {PRIORITY_LABEL_DASH[deadlinePriorityOf(item)]}</small></div><button type="button" className="deadline-toggle" aria-label={'Hoàn thành hạn nộp ' + item.title} title="Hoàn thành" onClick={() => toggleDeadline(item.id)} /><span className="deadline-status">{day === today ? 'Hôm nay' : day.split('-').reverse().slice(0, 2).join('/')}</span></div> })}</div> : <EmptyState icon={<Icon name="check" size={24} />} title="Chưa có hạn nộp trong 7 ngày tới. Thêm bài tập để dễ theo dõi." tone="orange" />}
        </section>
      </div>
      <aside className="secondary-column student-side">
        <section className="dashboard-card today-card">
          <CardHeader icon={<Icon name="schedule" />} title="Lịch hôm nay" tone="blue" />
          {loadingSchedule ? <div className="today-empty"><b>Đang đồng bộ lịch…</b></div> : lessonsToday.length ? <ol className="today-lessons">{lessonsToday.map(item => <li key={item.id}><time>{item.deadline ? deadlineTimeOf(item) : item.start}<small>{item.deadline ? 'Hạn nộp' : item.end}</small></time><div><b>{item.title}</b><span>{item.subject || 'Lịch học cá nhân'}</span></div></li>)}</ol> : <div className="today-empty"><Icon name="schedule" size={30} /><b>Hôm nay chưa có lịch học</b><p>Thêm tiết học hoặc buổi ôn tập để chủ động thời gian.</p></div>}
          <a className="outline-button" href="#schedule">Mở lịch học <Icon name="arrow" size={16} /></a>
        </section>
        <section className="focus-invitation">
          <span className="focus-invitation-icon"><Icon name="pomodoro" size={26} /></span><p className="eyebrow">DÀNH MỘT KHOẢNG CHO MÌNH</p><h2>25 phút, một việc thôi.</h2><p>Chọn bài cần học, tắt thông báo và bắt đầu. Hết phiên, nghỉ 5 phút nhé.</p><a className="primary-button" href="#pomodoro">Vào phòng tập trung<Icon name="arrow" size={17} /></a>
        </section>
        <a className="study-help-link" href="#help"><Icon name="help" size={18} /><span>Mới dùng Nhịp Học? Xem hướng dẫn</span><Icon name="arrow" size={16} /></a>
      </aside>
    </div>
    {showDeadline && <Modal title="Thêm hạn nộp" onClose={() => setShowDeadline(false)}><form onSubmit={addDeadline}><label>Tên bài tập<input name="title" required pattern=".*\S.*" maxLength={160} placeholder="Ví dụ: Nộp bài thuyết trình Ngữ văn" autoFocus /></label><label>Môn học<input name="subject" maxLength={80} placeholder="Ví dụ: Ngữ văn" /></label><label>Ngày nộp<input name="date" type="date" required /></label><label>Giờ nộp<input name="time" type="time" required defaultValue="23:59" /></label><label>Mức độ quan trọng<select name="priority" defaultValue="medium"><option value="high">Cao</option><option value="medium">Trung bình</option><option value="low">Thấp</option></select></label>{(deadlineError || deadlineLocalError) && <p role="alert">{deadlineError || deadlineLocalError}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => setShowDeadline(false)}>Hủy</button><button className="primary-button">Lưu hạn nộp</button></div></form></Modal>}
  </>
}
