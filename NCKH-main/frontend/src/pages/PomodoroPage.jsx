import { useEffect, useRef, useState } from 'react'
import { CardHeader, SectionCard } from '../components/PageComponents'
import {
  POMODORO_SUBJECTS,
  createFocusTask,
  createPomodoroSession,
  deleteFocusTask,
  deletePomodoroSession,
  fetchFocusTasks,
  fetchPomodoroSessions,
  fetchPomodoroSummary,
  getSession,
  onSessionChange,
  patchFocusTask,
} from '../backendApi'
import {
  readFocusTimer,
  remainingFromDeadline,
  writeFocusTimer,
} from '../data/focusTimer'

const DEFAULT_MINUTES = [25, 5, 15]
const modeKeys = ['focus', 'short', 'long']
const today = () => new Date().toLocaleDateString('en-CA')

// Timer lần cuối còn chạy (nếu có) — để restore khi reload trang. Khi chỉ
// chuyển page trong app thì PomodoroPage được giữ mounted nền (xem App.jsx)
// nên timer tiếp tục đếm bình thường.
const restoredTimer = readFocusTimer()

function loadMinutes() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-durations'))
    if (Array.isArray(saved) && saved.length === 3 && saved.every((m) => Number.isInteger(m) && m >= 1 && m <= 180)) return saved
  } catch { /* Storage may be unavailable. */ }
  return [...DEFAULT_MINUTES]
}

function loadFocusLengthFallback() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-durations'))
    if (Array.isArray(saved) && Number.isInteger(saved[0]) && saved[0] >= 1 && saved[0] <= 180) return saved[0]
  } catch { /* Storage may be unavailable. */ }
  return 25
}

function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-focus'))
    if (saved?.date === today() && Number.isInteger(saved.sessions) && saved.sessions >= 0) {
      return {
        date: saved.date,
        sessions: saved.sessions,
        minutes: Number.isInteger(saved.minutes) && saved.minutes >= 0 ? saved.minutes : saved.sessions * loadFocusLengthFallback(),
      }
    }
  } catch { /* Storage may be unavailable. */ }
  return { date: today(), sessions: 0, minutes: 0 }
}

// Việc cần tập trung (ô nhập task): local fallback khi chưa đăng nhập.
// Shape: [{id, title, subject, status, position}]. id local: `local-<ts>-<rand>`.
function loadLocalFocusTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-focus-tasks'))
    if (!Array.isArray(saved)) return []
    return saved
      .filter((item) => item && typeof item.title === 'string' && item.title.trim())
      .map((item, index) => ({
        id: String(item.id || `local-${index}`),
        title: String(item.title).slice(0, 160),
        subject: POMODORO_SUBJECTS.includes(item.subject) ? item.subject : '',
        status: item.status === 'doing' || item.status === 'done' ? item.status : 'todo',
        position: Number.isInteger(item.position) ? Math.max(0, Math.min(10000, item.position)) : index,
      }))
  } catch { return [] }
}

function loadActiveTask() {
  try {
    const id = localStorage.getItem('nhip-hoc-focus-active-task') || ''
    const title = localStorage.getItem('nhip-hoc-focus-task-title') || ''
    return { id, title: title.slice(0, 160) }
  } catch { return { id: '', title: '' } }
}

export default function PomodoroPage() {
  const [customMinutes, setCustomMinutes] = useState(loadMinutes)
  const durations = customMinutes.map((m) => m * 60)
  const modeLabels = [`Tập trung ${customMinutes[0]}’`, `Nghỉ ${customMinutes[1]}’`, `Nghỉ ${customMinutes[2]}’`]
  // Restore timer còn dang dở từ lần trước (reload giữa chừng). Thời gian còn
  // lại luôn tính từ `deadline` nên đúng dù user đã rời đi bao lâu.
  const [mode, setMode] = useState(restoredTimer?.mode ?? 0)
  const [remaining, setRemaining] = useState(() => {
    if (!restoredTimer) return customMinutes[0] * 60
    if (restoredTimer.running) return remainingFromDeadline(restoredTimer.deadline)
    return restoredTimer.remaining
  })
  const [running, setRunning] = useState(() => restoredTimer?.running ?? false)
  const [stats, setStats] = useState(loadStats)
  const [sound, setSound] = useState(null)
  const [soundError, setSoundError] = useState('')
  // Giữ deadline trong ref để tick tính giờ còn lại theo thời gian thực —
  // đúng cả khi tab browser bị ẩn hay user đang ở page khác.
  const deadline = useRef(restoredTimer?.running ? restoredTimer.deadline : null)
  const audio = useRef(null)
  // Môn học của phiên focus (khóa cứng 9 lựa chọn, '' = không chọn) — gửi kèm khi POST /api/pomodoro.
  const [subject, setSubject] = useState(() => {
    try {
      const saved = localStorage.getItem('nhip-hoc-focus-subject') || ''
      return POMODORO_SUBJECTS.includes(saved) ? saved : ''
    } catch { return '' }
  })
  const subjectRef = useRef(subject)
  // Đồng bộ server khi đã đăng nhập: hoàn thành 1 phiên -> tự POST; rớt mạng giữ local.
  const [loggedIn, setLoggedIn] = useState(() => !!getSession())
  const [serverToday, setServerToday] = useState(null)
  const [serverSessions, setServerSessions] = useState([])
  const [syncError, setSyncError] = useState('')
  // Việc cần tập trung (ô nhập task + danh sách): đăng nhập -> server
  // (bảng focus_tasks), chưa đăng nhập -> localStorage. activeTaskId là việc
  // đang bấm giờ; taskTitle tự do cho phép gõ nhanh không cần thêm vào list.
  const [focusTasks, setFocusTasks] = useState(() => (getSession() ? [] : loadLocalFocusTasks()))
  const [localTasks, setLocalTasks] = useState(loadLocalFocusTasks)
  const [activeTaskId, setActiveTaskId] = useState(() => loadActiveTask().id)
  const [taskTitle, setTaskTitle] = useState(() => loadActiveTask().title)
  const [taskDraft, setTaskDraft] = useState('')
  const [taskSubject, setTaskSubject] = useState('')
  const [taskError, setTaskError] = useState('')
  const [taskSaving, setTaskSaving] = useState(false)
  // Form thêm task ẩn/hiện kiểu Pomofocus + menu ⋮ của từng dòng.
  const [showAddForm, setShowAddForm] = useState(false)
  const [openMenuId, setOpenMenuId] = useState('')
  const tasks = loggedIn ? focusTasks : localTasks
  const activeTask = tasks.find((item) => String(item.id) === String(activeTaskId)) || null
  // Tên việc gửi kèm phiên: ưu tiên task đang chọn, rơi về ô gõ tự do.
  const effectiveTaskTitle = (activeTask?.title || taskTitle || '').trim().slice(0, 160)
  const effectiveSubject = activeTask?.subject || subject
  const activeTaskRef = useRef({ id: activeTaskId, title: effectiveTaskTitle, subject: effectiveSubject })
  useEffect(() => {
    activeTaskRef.current = { id: activeTaskId, title: effectiveTaskTitle, subject: effectiveSubject }
  }, [activeTaskId, effectiveTaskTitle, effectiveSubject])

  async function refreshFocusTasks() {
    if (!getSession()) {
      setFocusTasks([])
      return
    }
    try {
      const rows = await fetchFocusTasks()
      setFocusTasks(Array.isArray(rows) ? rows : [])
      setTaskError('')
    } catch {
      // Rớt mạng: giữ danh sách cũ, không chặn timer.
    }
  }

  // Persist task local + việc đang làm để reload giữa chừng không mất.
  useEffect(() => {
    if (loggedIn) return
    try { localStorage.setItem('nhip-hoc-focus-tasks', JSON.stringify(localTasks)) } catch { /* Keep in-memory tasks. */ }
  }, [localTasks, loggedIn])
  useEffect(() => {
    try {
      localStorage.setItem('nhip-hoc-focus-active-task', activeTaskId || '')
      localStorage.setItem('nhip-hoc-focus-task-title', activeTask ? '' : taskTitle.slice(0, 160))
    } catch { /* Keep in-memory selection. */ }
  }, [activeTaskId, taskTitle, activeTask])

  async function refreshServer() {
    if (!getSession()) {
      setServerToday(null)
      setServerSessions([])
      return
    }
    try {
      const day = today()
      const [summary, rows] = await Promise.all([
        fetchPomodoroSummary(day, day),
        fetchPomodoroSessions(day, day),
      ])
      setServerToday(summary)
      setServerSessions(rows)
      setSyncError('')
    } catch {
      // Rớt mạng: giữ số local, không chặn timer.
    }
  }

  useEffect(() => {
    subjectRef.current = subject
    try { localStorage.setItem('nhip-hoc-focus-subject', subject) } catch { /* Keep in-memory subject. */ }
  }, [subject])

  useEffect(() => {
    refreshServer()
    refreshFocusTasks()
    return onSessionChange((session) => {
      setLoggedIn(!!session)
      refreshServer()
      refreshFocusTasks()
      if (!session) setFocusTasks([])
    })
  }, [])

  useEffect(() => {
    try { localStorage.setItem('nhip-hoc-focus', JSON.stringify(stats)) } catch { /* Keep in-memory statistics. */ }
    // Báo cho các page cùng tab (VD: Dashboard dùng useStoredState) cập nhật số
    // phút live. Trước đây ghi thẳng localStorage nên dashboard đang mở vẫn hiện số cũ.
    try { window.dispatchEvent(new CustomEvent('nhip-hoc-storage', { detail: { key: 'nhip-hoc-focus' } })) } catch { /* Keep in-memory statistics. */ }
  }, [stats])

  useEffect(() => {
    try { localStorage.setItem('nhip-hoc-durations', JSON.stringify(customMinutes)) } catch { /* Keep in-memory durations. */ }
  }, [customMinutes])

  useEffect(() => {
    if (!running) return
    const tick = () => {
      if (deadline.current === null) return
      const seconds = remainingFromDeadline(deadline.current)
      setRemaining(seconds)
      // Lưu nền mỗi tick (silent để badge Topbar không render 5 lần/giây —
      // badge tự đếm từ deadline mỗi giây). Nhờ deadline persist mà chuyển
      // page hay reload giữa chừng vẫn tính đúng thời gian còn lại.
      writeFocusTimer({ mode, running: true, deadline: deadline.current, remaining: seconds }, { silent: true })
      if (seconds > 0) return
      const finishedDeadline = deadline.current
      deadline.current = null
      setRunning(false)
      if (mode === 0) {
        const focusLength = customMinutes[0]
        const endedAt = new Date()
        const startedAt = new Date(endedAt.getTime() - focusLength * 60000)
        setStats((old) => {
          const base = old.date === today() ? old : { date: today(), sessions: 0, minutes: 0 }
          const sessions = base.sessions + 1
          return { date: today(), sessions, minutes: (base.minutes ?? base.sessions * focusLength) + focusLength }
        })
        // Đã đăng nhập: tự ghi phiên đã hoàn thành lên server (giữ local nếu rớt mạng).
        if (getSession()) {
          const active = activeTaskRef.current
          createPomodoroSession({
            focus_minutes: focusLength,
            subject: active.subject || subjectRef.current,
            ...(active.title ? { task_title: active.title } : {}),
            ...(active.id && !String(active.id).startsWith('local-') ? { focus_task_id: active.id } : {}),
            started_at: startedAt.toISOString(),
            ended_at: endedAt.toISOString(),
          })
            .then(() => refreshServer())
            .catch((failure) => setSyncError(failure.friendlyMessage || 'Không lưu được phiên lên server. Đã giữ số local.'))
        }
        // Mỗi 4 phiên tập trung thì nghỉ dài, còn lại nghỉ ngắn. Tự chạy phiên nghỉ tiếp theo.
        // Mốc nối từ deadline vừa hết hạn (tránh trôi giờ) + bắt kịp khi user vắng mặt lâu:
        // nếu cả phiên nghỉ cũng đã trôi qua trong lúc rời đi thì về thẳng focus, dừng lại.
        const doneSessions = (stats.date === today() ? stats.sessions : 0) + 1
        const nextMode = doneSessions % 4 === 0 ? 2 : 1
        const nextSeconds = customMinutes[nextMode] * 60
        const nextDeadline = finishedDeadline + nextSeconds * 1000
        if (nextDeadline <= Date.now()) {
          setMode(0)
          setRemaining(customMinutes[0] * 60)
          writeFocusTimer({ mode: 0, running: false, deadline: null, remaining: customMinutes[0] * 60 })
        } else {
          setMode(nextMode)
          setRemaining(nextSeconds)
          deadline.current = nextDeadline
          setRunning(true)
          writeFocusTimer({ mode: nextMode, running: true, deadline: nextDeadline, remaining: nextSeconds })
        }
      } else {
        // Nghỉ xong thì quay về phiên tập trung, dừng lại để người dùng chủ động bắt đầu.
        setMode(0)
        setRemaining(customMinutes[0] * 60)
        writeFocusTimer({ mode: 0, running: false, deadline: null, remaining: customMinutes[0] * 60 })
      }
    }
    const interval = setInterval(tick, 200)
    return () => clearInterval(interval)
  }, [running, mode, customMinutes, stats.date, stats.sessions])

  // Page được giữ mounted nền nên chỉ fetch server 1 lần lúc mở app —
  // refresh lại mỗi khi user quay về #pomodoro để số liệu mới nhất.
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#pomodoro') {
        refreshServer()
        refreshFocusTasks()
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Khi đồng hồ đang dừng, giữ bản persist đồng bộ (đổi mode, sửa số phút...)
  // để reload mở lại đúng trạng thái. Tick lúc chạy đã tự persist riêng.
  useEffect(() => {
    if (running) return
    writeFocusTimer({ mode, running: false, deadline: null, remaining }, { silent: true })
  }, [mode, remaining, running])

  useEffect(() => () => { audio.current?.close() }, [])

  function reset(nextMode = mode) {
    deadline.current = null
    setRunning(false)
    setMode(nextMode)
    const seconds = customMinutes[nextMode] * 60
    setRemaining(seconds)
    writeFocusTimer({ mode: nextMode, running: false, deadline: null, remaining: seconds })
  }

  function updateMinutes(index, value) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) return
    const clamped = Math.min(180, Math.max(1, parsed))
    setCustomMinutes((old) => {
      if (old[index] === clamped) return old
      const next = [...old]
      next[index] = clamped
      return next
    })
    // Nếu đang đứng yên ở đúng chế độ vừa sửa thì cập nhật đồng hồ luôn.
    if (!running && mode === index) setRemaining(clamped * 60)
  }

  function applyPreset(preset) {
    setCustomMinutes([...preset])
    if (!running) setRemaining(preset[mode] * 60)
  }

  function toggleTimer() {
    if (running) {
      const seconds = remainingFromDeadline(deadline.current)
      setRemaining(seconds)
      deadline.current = null
      setRunning(false)
      writeFocusTimer({ mode, running: false, deadline: null, remaining: seconds })
    } else {
      const seconds = remaining || durations[mode]
      setRemaining(seconds)
      const nextDeadline = Date.now() + seconds * 1000
      deadline.current = nextDeadline
      setRunning(true)
      writeFocusTimer({ mode, running: true, deadline: nextDeadline, remaining: seconds })
    }
  }

  async function toggleSound(nextSound) {
    const previous = audio.current
    audio.current = null
    previous?.close()
    setSoundError('')
    if (sound === nextSound) { setSound(null); return }
    let context
    try {
      context = new AudioContext()
      audio.current = context
      setSound(nextSound)
      await context.resume()
      if (audio.current !== context) return
      const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate)
      const data = buffer.getChannelData(0)
      const random = new Uint32Array(8192)
      let smooth = 0
      for (let i = 0; i < data.length; i++) {
        if (i % random.length === 0) crypto.getRandomValues(random)
        const noise = random[i % random.length] / 0xffffffff * 2 - 1
        smooth = (smooth + noise * 0.02) / 1.02
        data[i] = nextSound === 'rain' ? noise : smooth * 5
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = nextSound === 'rain' ? 4500 : 900
      const gain = context.createGain()
      gain.gain.value = nextSound === 'rain' ? 0.12 : 0.35
      source.connect(filter).connect(gain).connect(context.destination)
      if (nextSound === 'waves') {
        const wave = context.createOscillator()
        const depth = context.createGain()
        wave.frequency.value = 0.12
        depth.gain.value = 0.25
        wave.connect(depth).connect(gain.gain)
        wave.start()
      }
      source.start()
    } catch {
      context?.close()
      if (audio.current === context) {
        audio.current = null
        setSound(null)
        setSoundError('Không thể phát âm thanh trên trình duyệt này.')
      }
    }
  }

  async function removeSession(id) {
    if (!id) return
    const snapshot = serverSessions
    setServerSessions((rows) => (rows || []).filter((row) => row.id !== id))
    try {
      await deletePomodoroSession(id)
      refreshServer()
    } catch (failure) {
      setServerSessions(snapshot)
      setSyncError(failure.friendlyMessage || 'Không xóa được phiên trên server.')
    }
  }

  function applyTasks(next) {
    if (loggedIn) setFocusTasks(next)
    else setLocalTasks(next)
  }

  async function addFocusTask(event) {
    event?.preventDefault()
    const title = taskDraft.trim().slice(0, 160)
    if (!title) {
      setTaskError('Hãy nhập tên việc cần tập trung.')
      return
    }
    setTaskError('')
    setTaskSaving(true)
    try {
      if (loggedIn) {
        const created = await createFocusTask({ title, subject: taskSubject || null, status: 'todo', position: tasks.length })
        setFocusTasks((rows) => [...(rows || []), created])
        setActiveTaskId(String(created.id))
        setTaskTitle('')
        if (created.subject) setSubject(created.subject)
      } else {
        const created = {
          id: `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          title,
          subject: POMODORO_SUBJECTS.includes(taskSubject) ? taskSubject : '',
          status: 'todo',
          position: localTasks.length,
        }
        setLocalTasks((rows) => [...rows, created])
        setActiveTaskId(created.id)
        setTaskTitle('')
        if (created.subject) setSubject(created.subject)
      }
      setTaskDraft('')
      setTaskSubject('')
      setShowAddForm(false)
    } catch (failure) {
      setTaskError(failure.friendlyMessage || 'Không lưu được việc. Vui lòng thử lại.')
    } finally {
      setTaskSaving(false)
    }
  }

  async function clearDoneTasks() {
    const done = tasks.filter((item) => item.status === 'done')
    if (done.length === 0) return
    const snapshot = tasks
    applyTasks(tasks.filter((item) => item.status !== 'done'))
    if (done.some((item) => String(item.id) === String(activeTaskId))) {
      setActiveTaskId('')
      setTaskTitle('')
    }
    if (!loggedIn) return
    try {
      await Promise.all(done.filter((item) => !String(item.id).startsWith('local-')).map((item) => deleteFocusTask(item.id)))
      refreshFocusTasks()
    } catch {
      applyTasks(snapshot)
    }
  }

  // Số phiên hôm nay đã gắn vào 1 task (khớp focus_task_id, rơi về tên task).
  function sessionsOfTask(item) {
    if (!loggedIn || !Array.isArray(serverSessions)) return 0
    return serverSessions.filter((row) => {
      if (row.focus_task_id && String(row.focus_task_id) === String(item.id)) return true
      const snapshot = String(row.task_title || '').trim().toLowerCase()
      return snapshot && snapshot === String(item.title || '').trim().toLowerCase()
    }).length
  }

  async function selectFocusTask(task) {
    const id = String(task.id)
    const isActive = String(activeTaskId) === id
    setActiveTaskId(isActive ? '' : id)
    if (!isActive) {
      setTaskTitle('')
      if (task.subject) setSubject(task.subject)
    }
    // Đánh dấu doing cho việc đang làm, các việc doing khác về todo.
    const next = tasks.map((item) => {
      if (String(item.id) === id) return { ...item, status: isActive ? 'todo' : 'doing' }
      if (item.status === 'doing') return { ...item, status: 'todo' }
      return item
    })
    applyTasks(next)
    if (!loggedIn) return
    try {
      await patchFocusTask(task.id, { status: isActive ? 'todo' : 'doing' })
      const demote = tasks.filter((item) => String(item.id) !== id && item.status === 'doing')
      await Promise.all(demote.map((item) => patchFocusTask(item.id, { status: 'todo' }).catch(() => null)))
      refreshFocusTasks()
    } catch {
      // Giữ trạng thái local, không chặn timer.
    }
  }

  async function toggleFocusDone(task) {
    const nextStatus = task.status === 'done' ? 'todo' : 'done'
    const next = tasks.map((item) => (String(item.id) === String(task.id) ? { ...item, status: nextStatus } : item))
    applyTasks(next)
    if (String(activeTaskId) === String(task.id) && nextStatus === 'done') {
      setActiveTaskId('')
      setTaskTitle('')
    }
    if (!loggedIn) return
    try {
      await patchFocusTask(task.id, { status: nextStatus })
      refreshFocusTasks()
    } catch {
      // Giữ trạng thái local.
    }
  }

  async function removeFocusTask(task) {
    const snapshot = tasks
    applyTasks(tasks.filter((item) => String(item.id) !== String(task.id)))
    if (String(activeTaskId) === String(task.id)) {
      setActiveTaskId('')
      setTaskTitle('')
    }
    if (!loggedIn) return
    if (String(task.id).startsWith('local-')) return
    try {
      await deleteFocusTask(task.id)
      refreshFocusTasks()
    } catch (failure) {
      applyTasks(snapshot)
      setTaskError(failure.friendlyMessage || 'Không xóa được việc.')
    }
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    const doneWeight = (item) => (item.status === 'done' ? 1 : 0)
    if (doneWeight(a) !== doneWeight(b)) return doneWeight(a) - doneWeight(b)
    return (a.position ?? 0) - (b.position ?? 0)
  })
  const openTasks = tasks.filter((item) => item.status !== 'done').length

  const localSessions = stats.date === today() ? stats.sessions : 0
  const localMinutes = stats.date === today() ? (stats.minutes ?? localSessions * customMinutes[0]) : 0
  const sessions = loggedIn && serverToday ? Number(serverToday.total_sessions ?? 0) : localSessions
  const minutes = loggedIn && serverToday ? Number(serverToday.total_minutes ?? 0) : localMinutes
  const cycle = sessions ? (sessions - 1) % 4 + 1 : 0
  const time = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
  const progress = durations[mode] > 0 ? (remaining / durations[mode]) * 100 : 0
  const statusText = running
    ? (mode === 0 ? 'Đang tập trung' : 'Đang nghỉ ngơi')
    : remaining === 0
      ? 'Đã hoàn thành'
      : remaining === durations[mode]
        ? 'Sẵn sàng bắt đầu'
        : 'Đã tạm dừng'

  return (
    <>
      <PageHeading focus={customMinutes[0]} short={customMinutes[1]} long={customMinutes[2]} />
      <div className="focus-layout">
        <SectionCard className="focus-card">
          <CardHeader icon="◷" title="Phòng tập trung" tone="blue" />
          <div className="segmented-control">{modeLabels.map((label, index) => <button key={modeKeys[index]} className={mode === index ? 'selected' : ''} aria-pressed={mode === index} onClick={() => reset(index)}>{label}</button>)}</div>
          <div className="focus-ring" style={{ background: `conic-gradient(var(--blue) 0 ${progress}%, var(--line) 0 100%)` }}><div><strong role="timer" aria-label="Thời gian còn lại">{time}</strong><span>{statusText}</span></div></div>
          <div className="cycle-row"><span>Chu kỳ phiên hôm nay</span><b>{cycle} / 4</b></div><div className="cycle-dots">{[0, 1, 2, 3].map((index) => <i key={index} className={index < cycle ? 'completed' : ''} />)}</div>
          <div className="focus-actions"><button className="primary-button" onClick={toggleTimer}>{running ? 'Ⅱ Tạm dừng' : '▶ Bắt đầu'}</button><button className="icon-button" onClick={() => reset()} aria-label="Đặt lại thời gian">↻</button></div>
          <section className="pomo-tasks" aria-label="Danh sách việc cần tập trung">
            <div className="pomo-tasks-head">
              <h2>Việc cần tập trung{openTasks ? ` · còn ${openTasks}` : ''}</h2>
              {tasks.some((item) => item.status === 'done') && (
                <button type="button" className="pomo-tasks-clear" onClick={clearDoneTasks}>Dọn việc xong</button>
              )}
            </div>
            {sortedTasks.length === 0 && !showAddForm && (
              <p className="duration-hint">Chưa có việc nào — thêm task để mỗi phiên pomodoro bám đúng 1 việc.</p>
            )}
            <div className="pomo-task-list">
              {sortedTasks.map((item) => {
                const isActive = String(activeTaskId) === String(item.id)
                const isDone = item.status === 'done'
                const doneCount = sessionsOfTask(item)
                const menuOpen = String(openMenuId) === String(item.id)
                return (
                  <div className={`pomo-task-row${isActive ? ' active' : ''}${isDone ? ' done' : ''}`} key={item.id}>
                    <button
                      type="button"
                      className="pomo-task-check"
                      aria-pressed={isDone}
                      aria-label={isDone ? `Đánh dấu chưa xong: ${item.title}` : `Đánh dấu xong: ${item.title}`}
                      onClick={() => toggleFocusDone(item)}
                    >{isDone ? '✓' : ''}</button>
                    <button
                      type="button"
                      className="pomo-task-title"
                      title={item.subject ? `${item.title} · ${item.subject}` : item.title}
                      onClick={() => !isDone && selectFocusTask(item)}
                    >
                      <b>{item.title}</b>
                      {item.subject ? <small>{item.subject}</small> : null}
                    </button>
                    {doneCount > 0 && <span className="pomo-task-count" title={`${doneCount} phiên hôm nay cho việc này`}>{doneCount} phiên</span>}
                    <button
                      type="button"
                      className="pomo-task-menu-btn"
                      aria-expanded={menuOpen}
                      aria-label={`Tùy chọn cho việc ${item.title}`}
                      onClick={() => setOpenMenuId(menuOpen ? '' : String(item.id))}
                    >⋮</button>
                    {menuOpen && (
                      <div className="pomo-task-menu" role="menu">
                        {!isDone && (
                          <button type="button" role="menuitem" onClick={() => { setOpenMenuId(''); selectFocusTask(item) }}>
                            {isActive ? 'Bỏ ghim khỏi đồng hồ' : 'Ghim lên đồng hồ'}
                          </button>
                        )}
                        <button type="button" role="menuitem" onClick={() => { setOpenMenuId(''); toggleFocusDone(item) }}>
                          {isDone ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong'}
                        </button>
                        <button type="button" role="menuitem" className="danger" onClick={() => { setOpenMenuId(''); removeFocusTask(item) }}>
                          Xóa việc
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {showAddForm ? (
              <form className="pomo-task-form" onSubmit={addFocusTask}>
                <input
                  autoFocus
                  value={taskDraft}
                  onChange={(event) => setTaskDraft(event.target.value)}
                  maxLength={160}
                  placeholder="Nhập task… Ví dụ: Ôn 30 từ vựng Unit 5"
                  aria-label="Tên việc cần tập trung"
                />
                <div className="pomo-task-form-row">
                  <select value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)} aria-label="Môn của việc mới">
                    <option value="">— Môn —</option>
                    {POMODORO_SUBJECTS.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <button type="button" className="ghost-button" onClick={() => { setShowAddForm(false); setTaskError('') }}>Hủy</button>
                  <button type="submit" className="primary-button" disabled={taskSaving}>{taskSaving ? 'Đang thêm…' : 'Thêm việc'}</button>
                </div>
              </form>
            ) : (
              <button type="button" className="pomo-task-add" onClick={() => { setShowAddForm(true); setTaskError('') }}>
                <span aria-hidden="true">⊕</span> Thêm việc
              </button>
            )}
            {taskError && <p role="alert">{taskError}</p>}
            {!loggedIn && <p className="duration-note">Chưa đăng nhập — việc lưu trên trình duyệt này. Đăng nhập để đồng bộ lên server.</p>}
          </section>
          <label className="duration-hint" style={{ display: 'block', marginTop: 12 }}>
            <span>Môn học của phiên này</span>
            <div className="duration-input subject-input" style={{ marginTop: 6 }}>
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                aria-label="Môn học của phiên tập trung"
              >
                <option value="">— Chọn môn —</option>
                {POMODORO_SUBJECTS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </label>
          {loggedIn && <p className="duration-note">Đã đăng nhập — mỗi phiên focus chạy hết giờ sẽ tự lưu lên server.</p>}
          {!loggedIn && <p className="duration-note">Đăng nhập để tự lưu mỗi phiên focus lên server.</p>}
        </SectionCard>
        <aside className="focus-side">
          <SectionCard><CardHeader icon="▤" title="Thống kê" tone="mint" /><div className="focus-stats"><div><b>⌛</b><strong>{Math.floor(minutes / 60)} giờ {minutes % 60} phút</strong></div><div><b>♧</b><strong>{sessions} phiên</strong></div></div>{loggedIn && <p className="duration-note">Số liệu hôm nay từ server{syncError ? ` — ${syncError}` : ''}.</p>}{!loggedIn && syncError && <p role="alert">{syncError}</p>}</SectionCard>
          <SectionCard>
            <CardHeader icon="◷" title="Phiên hôm nay" tone="blue" />
            {!loggedIn && <p className="duration-hint">Đăng nhập để xem các phiên đã lưu trên server. Số local vẫn hiển thị ở thẻ Thống kê.</p>}
            {loggedIn && serverSessions.length === 0 && <p className="duration-hint">Chưa có phiên nào hôm nay. Hoàn thành 1 phiên focus để tự lưu.</p>}
            {loggedIn && serverSessions.length > 0 && (
              <div className="task-list">
                {serverSessions.map((row) => {
                  const start = new Date(row.started_at)
                  const end = new Date(row.ended_at)
                  const time = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
                    ? ''
                    : `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}–${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
                  return (
                    <div className="task-item" key={row.id}>
                      <div><b>{row.task_title || `${row.focus_minutes} phút`}{row.task_title ? ` · ${row.focus_minutes} phút` : ''}{row.subject ? ` · ${row.subject}` : ''}</b><br /><small>{time}</small></div>
                      <button type="button" className="delete-button" aria-label={`Xóa phiên ${row.focus_minutes} phút`} onClick={() => removeSession(row.id)}>Xóa</button>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
          <SectionCard className="duration-card">
            <CardHeader icon="◷" title="Thời gian mỗi phiên" tone="blue" />
            <p className="duration-hint">Tự chỉnh số phút cho hợp nhịp học của bạn (1–180 phút).</p>
            <div className="duration-grid">
              {[
                { label: 'Tập trung', index: 0 },
                { label: 'Nghỉ ngắn', index: 1 },
                { label: 'Nghỉ dài', index: 2 },
              ].map(({ label, index }) => (
                <label key={modeKeys[index]}>
                  <span>{label}</span>
                  <div className="duration-input">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      step={1}
                      value={customMinutes[index]}
                      onChange={(event) => updateMinutes(index, event.target.value)}
                      aria-label={`Số phút ${label.toLowerCase()}`}
                    />
                    <span>phút</span>
                  </div>
                </label>
              ))}
            </div>
            {running && <p className="duration-note">Đang chạy — đổi số phút sẽ áp dụng từ phiên tiếp theo.</p>}
            <div className="duration-presets">
              {[
                { label: '25 / 5 / 15', value: [25, 5, 15] },
                { label: '50 / 10 / 20', value: [50, 10, 20] },
                { label: '90 / 15 / 30', value: [90, 15, 30] },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="ghost-button"
                  onClick={() => applyPreset(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button type="button" className="ghost-button duration-reset" onClick={() => applyPreset(DEFAULT_MINUTES)}>↻ Về mặc định</button>
          </SectionCard>
        </aside>
      </div>
      <SectionCard className="sound-card"><CardHeader icon="♧" title="Âm thanh" /><div className="sound-options">{[['rain', '🌧️ Mưa'], ['waves', '≋ Sóng']].map(([value, label]) => <button key={value} aria-pressed={sound === value} onClick={() => toggleSound(value)}>{label}{sound === value ? ' · Đang phát' : ''}</button>)}</div>{soundError && <p role="alert">{soundError}</p>}</SectionCard>
    </>
  )
}

function PageHeading({ focus, short }) {
  return <div className="simple-heading"><div><p className="eyebrow">⏱️ NHỊP HỌC TẬP TRUNG</p><h1>Phòng tập trung</h1><p className="page-subtitle">Học {focus} phút, nghỉ {short} phút. Tập trung vào một việc mỗi lần.</p></div><div className="focus-tip">💡 Mẹo: Để điện thoại xa tầm tay</div></div>
}
