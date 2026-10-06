import { useMemo, useState } from 'react'
import { PageIntro } from '../components/PageComponents'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import useWeeklyTasks from '../data/useWeeklyTasks'
import {
  createWeeklyTask,
  deleteWeeklyTask,
  patchWeeklyTask,
  updateWeeklyTask,
} from '../backendApi'
import { SCHOOL_SUBJECTS, defaultSubjects } from '../data/subjects'

const COLUMNS = [
  { id: 'todo', title: 'Cần làm', icon: '📝', hint: 'Việc mới trong tuần' },
  { id: 'doing', title: 'Đang làm', icon: '🚀', hint: 'Đang triển khai' },
  { id: 'done', title: 'Xong', icon: '✅', hint: 'Hoàn thành' },
]

const PRIORITY_OPTIONS = [
  ['high', 'Cao'],
  ['medium', 'Trung bình'],
  ['low', 'Thấp'],
]
const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS)

const STATUS_LABEL = Object.fromEntries(COLUMNS.map(c => [c.id, c.title]))

const keyOf = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const startOfWeek = (date) => {
  const copy = new Date(date)
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7))
  copy.setHours(0, 0, 0, 0)
  return copy
}

const addDays = (date, n) => {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + n)
  return copy
}

const parseDay = (key) => new Date(key + 'T00:00:00')

const formatShort = (key) => {
  if (!key) return 'Chưa hẹn ngày'
  const d = parseDay(key)
  if (Number.isNaN(d.getTime())) return key
  const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  return `${weekdays[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function seedForWeek(mondayKey) {
  const monday = parseDay(mondayKey)
  const id = (suffix) => `seed-${suffix}`
  return [
    { id: id('1'), title: 'Ôn 30 từ vựng Unit 5', description: 'Học 15 từ mới + ôn 15 từ cũ, làm quiz cuối.', subject: 'Tiếng Anh', date: keyOf(addDays(monday, 0)), priority: 'high', status: 'todo', createdAt: new Date().toISOString() },
    { id: id('2'), title: 'Giải đề Toán chương hàm số', description: 'Làm đề 45 phút, chữa câu sai vào vở.', subject: 'Toán', date: keyOf(addDays(monday, 1)), priority: 'medium', status: 'todo', createdAt: new Date().toISOString() },
    { id: id('3'), title: 'Tóm tắt bài Quang hợp', description: 'Vẽ sơ đồ tư duy 1 trang, ghi 3 ý chính.', subject: 'Sinh học', date: keyOf(addDays(monday, 2)), priority: 'medium', status: 'doing', createdAt: new Date().toISOString() },
    { id: id('4'), title: 'Viết dàn ý NLXH 200 chữ', description: 'Chủ đề: kỷ luật bản thân. Lấy 1 dẫn chứng mới.', subject: 'Ngữ văn', date: keyOf(addDays(monday, 3)), priority: 'low', status: 'doing', createdAt: new Date().toISOString() },
    { id: id('5'), title: 'Ôn trắc nghiệm Lịch sử bài 8', description: '20 câu trắc nghiệm, mục tiêu đúng 17+.', subject: 'Lịch sử', date: keyOf(addDays(monday, 4)), priority: 'low', status: 'done', createdAt: new Date().toISOString() },
  ]
}

function emptyDraft(anchorMonday, status = 'todo') {
  return { id: null, title: '', description: '', subject: '', date: keyOf(addDays(anchorMonday, 1)), priority: 'medium', status }
}

export default function WeeklyTasksPage() {
  const [anchor, setAnchor] = useState(() => new Date())
  const {
    loggedIn, loadingTasks, tasks: hookTasks, localTasks,
    serverRows, setServerRows, setLocalTasks, localError, syncError, setSyncError,
  } = useWeeklyTasks()
  const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects)
  const [composer, setComposer] = useState(null) // { mode: 'create'|'edit', draft, targetColumn }
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [query, setQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const monday = startOfWeek(anchor)
  const sunday = addDays(monday, 6)
  const mondayKey = keyOf(monday)
  const sundayKey = keyOf(sunday)

  // Nguồn sự thật: đã login -> server; chưa login -> localStorage (null = seed mẫu 1 lần).
  const tasks = useMemo(() => {
    if (loggedIn) return Array.isArray(hookTasks) ? hookTasks : []
    if (localTasks === null || localTasks === undefined) return seedForWeek(mondayKey)
    return Array.isArray(localTasks) ? localTasks : []
  }, [loggedIn, hookTasks, localTasks, mondayKey])

  const persistLocal = (next) => setLocalTasks(next)

  const weekTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (!t.date) return true // chưa hẹn ngày -> luôn hiện
      return t.date >= mondayKey && t.date <= sundayKey
    })
  }, [tasks, mondayKey, sundayKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return weekTasks.filter((t) => {
      if (subjectFilter !== 'all' && (t.subject || '') !== subjectFilter) return false
      if (priorityFilter !== 'all' && (t.priority || 'medium') !== priorityFilter) return false
      if (q && !((t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [weekTasks, query, subjectFilter, priorityFilter])

  const byColumn = useMemo(() => {
    const map = { todo: [], doing: [], done: [] }
    for (const t of filtered) {
      const col = map[t.status] ? t.status : 'todo'
      map[col].push(t)
    }
    // Ưu tiên cao + ngày gần nhất lên trước
    for (const col of Object.keys(map)) {
      map[col].sort((a, b) => {
        const weight = { high: 0, medium: 1, low: 2 }
        const p = (weight[a.priority] ?? 1) - (weight[b.priority] ?? 1)
        if (p !== 0) return p
        return (a.date || '9999').localeCompare(b.date || '9999')
      })
    }
    return map
  }, [filtered])

  const total = weekTasks.length
  const doneCount = weekTasks.filter((t) => t.status === 'done').length
  const percent = total ? Math.round((doneCount / total) * 100) : 0
  const todayKey = keyOf(new Date())
  const overdue = weekTasks.filter((t) => t.status !== 'done' && t.date && t.date < todayKey).length

  const weekLabel = `${monday.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })} – ${sunday.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })}`

  function moveWeek(delta) {
    const next = new Date(anchor)
    next.setDate(next.getDate() + delta * 7)
    setAnchor(next)
  }

  function openCreate(columnId = 'todo') {
    setFormError('')
    setComposer({ mode: 'create', draft: emptyDraft(monday, columnId) })
  }

  function openEdit(task) {
    setFormError('')
    setComposer({
      mode: 'edit',
      draft: {
        id: task.id,
        title: task.title || '',
        description: task.description || '',
        subject: task.subject || '',
        date: task.date || mondayKey,
        priority: task.priority || 'medium',
        status: task.status || 'todo',
      },
    })
  }

  async function saveComposer() {
    const d = composer?.draft
    if (!d) return
    const title = (d.title || '').trim()
    if (!title) { setFormError('Hãy nhập tên việc cần làm.'); return }
    if (title.length > 120) { setFormError('Tên việc tối đa 120 ký tự.'); return }
    if ((d.description || '').length > 500) { setFormError('Mô tả tối đa 500 ký tự.'); return }
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) { setFormError('Ngày chưa hợp lệ.'); return }

    const payload = {
      title,
      description: (d.description || '').trim(),
      subject: (d.subject || '').trim(),
      date: d.date || '',
      priority: ['high', 'medium', 'low'].includes(d.priority) ? d.priority : 'medium',
      status: ['todo', 'doing', 'done'].includes(d.status) ? d.status : 'todo',
    }

    if (!loggedIn) {
      if (composer.mode === 'edit') {
        const next = tasks.map((t) => (t.id === d.id ? { ...t, ...payload } : t))
        if (persistLocal(next)) setComposer(null)
      } else {
        const next = [...tasks, { ...payload, id: crypto.randomUUID(), createdAt: new Date().toISOString() }]
        if (persistLocal(next)) {
          setComposer(null)
          // Nhảy tới tuần chứa task vừa tạo để user thấy ngay.
          if (payload.date && (payload.date < mondayKey || payload.date > sundayKey)) {
            setAnchor(parseDay(payload.date))
          }
        }
      }
      return
    }

    // Đã đăng nhập: lưu Supabase với optimistic UI.
    if (serverRows === null) { setFormError('Đang tải việc từ server, thử lại sau giây lát.'); return }
    setSaving(true)
    try {
      if (composer.mode === 'edit') {
        const snapshot = serverRows
        setServerRows(rows => (rows || []).map(row => row.id === d.id ? {
          ...row, title: payload.title, description: payload.description,
          subject: payload.subject || null, date: payload.date || null,
          priority: payload.priority, status: payload.status,
        } : row))
        setSyncError(''); setComposer(null); setFormError('')
        try {
          const updated = await updateWeeklyTask(d.id, payload)
          setServerRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
        } catch (failure) {
          setServerRows(snapshot)
          setSyncError(failure.friendlyMessage || 'Không sửa được việc trên server. Đã hoàn tác.')
        }
      } else {
        const tempId = 'temp-' + Date.now()
        const optimisticRow = {
          id: tempId, user_id: 'local',
          title: payload.title, description: payload.description,
          subject: payload.subject || null, date: payload.date || null,
          priority: payload.priority, status: payload.status,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }
        setServerRows(rows => [...(rows || []), optimisticRow])
        setSyncError(''); setComposer(null); setFormError('')
        try {
          const created = await createWeeklyTask(payload)
          setServerRows(rows => (rows || []).map(row => row.id === tempId ? created : row))
          if (payload.date && (payload.date < mondayKey || payload.date > sundayKey)) {
            setAnchor(parseDay(payload.date))
          }
        } catch (failure) {
          setServerRows(rows => (rows || []).filter(row => row.id !== tempId))
          setSyncError(failure.friendlyMessage || 'Không lưu được việc lên server. Đã hoàn tác.')
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function removeTask(id) {
    if (!id) return
    if (!window.confirm('Xóa việc này khỏi tuần?')) return
    if (!loggedIn) {
      persistLocal(tasks.filter((t) => t.id !== id))
      return
    }
    if (String(id).startsWith('temp-') || String(id).startsWith('seed-')) {
      setServerRows(rows => (rows || []).filter(row => row.id !== id))
      return
    }
    const snapshot = serverRows
    setServerRows(rows => (rows || []).filter(row => row.id !== id))
    try { await deleteWeeklyTask(id) }
    catch (failure) { setServerRows(snapshot); setSyncError(failure.friendlyMessage || 'Không xóa được việc trên server.') }
  }

  async function moveTask(id, nextStatus) {
    if (!['todo', 'doing', 'done'].includes(nextStatus)) return
    if (!loggedIn) {
      persistLocal(tasks.map((t) => (t.id === id ? { ...t, status: nextStatus } : t)))
      return
    }
    if (String(id).startsWith('temp-')) {
      setServerRows(rows => (rows || []).map(row => row.id === id ? { ...row, status: nextStatus } : row))
      return
    }
    const snapshot = serverRows
    setServerRows(rows => (rows || []).map(row => row.id === id ? { ...row, status: nextStatus } : row))
    setSyncError('')
    try {
      const updated = await patchWeeklyTask(id, { status: nextStatus })
      setServerRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
    } catch (failure) {
      setServerRows(snapshot)
      setSyncError(failure.friendlyMessage || 'Không đổi được trạng thái việc trên server. Đã hoàn tác.')
    }
  }

  function stepTask(task, dir) {
    const order = ['todo', 'doing', 'done']
    const idx = order.indexOf(task.status)
    const next = order[idx + dir]
    if (next) moveTask(task.id, next)
  }

  // --- Drag & drop (HTML5) ---
  function onDragStart(e, id) {
    setDraggingId(id)
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragEnd() {
    setDraggingId(null)
    setDragOver(null)
  }
  function onColumnDragOver(e, columnId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOver !== columnId) setDragOver(columnId)
  }
  function onColumnDrop(e, columnId) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    setDragOver(null)
    setDraggingId(null)
    if (id) moveTask(id, columnId)
  }

  const allSubjects = [...new Set([...(subjects || []), ...SCHOOL_SUBJECTS, ...tasks.map((t) => t.subject).filter(Boolean)])]

  const syncStatus = !loggedIn
    ? 'Chưa đăng nhập — việc tuần này chỉ lưu trên trình duyệt này.'
    : loadingTasks
      ? 'Đang đồng bộ việc tuần này với server…'
      : syncError
        ? syncError
        : serverRows
          ? `Đã lưu việc tuần này lên server ✓ (${serverRows.length} việc)`
          : ''

  return (
    <>
      <PageIntro
        eyebrow="VIỆC TRONG TUẦN"
        title="Weekly tasks"
        subtitle={`Kanban ${weekLabel} — kéo thẻ qua lại để cập nhật tiến độ.`}
      >
        <div className="intro-actions">
          <button className="primary-button" onClick={() => openCreate('todo')}>＋ Thêm việc</button>
        </div>
      </PageIntro>
      {syncStatus && <p className="repeat-hint" role="status">{syncStatus}</p>}

      <div className="summary-grid weekly-stats">
        <div className="summary-chip blue"><span>TỔNG VIỆC TUẦN NÀY</span><b>{total}</b></div>
        <div className="summary-chip mint"><span>HOÀN THÀNH</span><b>{doneCount}/{total} · {percent}%</b></div>
        <div className={'summary-chip ' + (overdue ? 'gold' : 'mint')}><span>QUÁ HẠN</span><b>{overdue} việc</b></div>
      </div>

      <section className="dashboard-card weekly-toolbar-card">
        <div className="calendar-toolbar weekly-toolbar">
          <div className="calendar-nav">
            <button className="today-button" onClick={() => setAnchor(new Date())}>Tuần này</button>
            <button className="round-button" aria-label="Tuần trước" onClick={() => moveWeek(-1)}>‹</button>
            <button className="round-button" aria-label="Tuần sau" onClick={() => moveWeek(1)}>›</button>
            <strong>T2 {monday.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })} – CN {sunday.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })}</strong>
          </div>
          <div className="weekly-filters">
            <input
              className="weekly-search"
              type="search"
              placeholder="Tìm việc…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Tìm việc trong tuần"
            />
            <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} aria-label="Lọc theo môn">
              <option value="all">Mọi môn</option>
              {allSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Lọc theo mức ưu tiên">
              <option value="all">Mọi ưu tiên</option>
              {PRIORITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="weekly-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ tuần">
          <i style={{ width: percent + '%' }} />
        </div>
      </section>

      {localError && <p role="alert">{localError}</p>}
      {loggedIn && loadingTasks && <p role="status">Đang tải việc trong tuần…</p>}

      <div className="weekly-board">
        {COLUMNS.map((col) => {
          const items = byColumn[col.id] || []
          const isOver = dragOver === col.id
          return (
            <section
              key={col.id}
              className={'weekly-column weekly-column-' + col.id + (isOver ? ' is-dragover' : '')}
              onDragOver={(e) => onColumnDragOver(e, col.id)}
              onDragLeave={() => setDragOver((cur) => (cur === col.id ? null : cur))}
              onDrop={(e) => onColumnDrop(e, col.id)}
              aria-label={col.title}
            >
              <header className="weekly-column-head">
                <div>
                  <b><span aria-hidden="true">{col.icon} </span>{col.title}</b>
                  <small>{col.hint}</small>
                </div>
                <span className="weekly-count">{items.length}</span>
              </header>

              <div className="weekly-column-body">
                {items.length === 0 && (
                  <div className="weekly-empty">
                    {col.id === 'todo' ? 'Chưa có việc mới. Thêm việc cho tuần này nhé.' : col.id === 'doing' ? 'Kéo việc từ “Cần làm” sang đây khi bắt đầu.' : 'Hoàn thành việc đầu tiên để ăn mừng nào 🎉'}
                  </div>
                )}
                {items.map((task) => {
                  const isOverdue = task.status !== 'done' && task.date && task.date < todayKey
                  const isToday = task.date === todayKey
                  const isDragging = draggingId === task.id
                  return (
                    <article
                      key={task.id}
                      className={'weekly-card priority-' + (task.priority || 'medium') + (isDragging ? ' is-dragging' : '') + (isOverdue ? ' is-overdue' : '')}
                      draggable
                      onDragStart={(e) => onDragStart(e, task.id)}
                      onDragEnd={onDragEnd}
                    >
                      <div className="weekly-card-top">
                        <span className={'priority-pill priority-' + (task.priority || 'medium')}>
                          {PRIORITY_LABEL[task.priority] || 'Trung bình'}
                        </span>
                        {task.subject && <span className="weekly-subject">{task.subject}</span>}
                      </div>
                      <h3>{task.title}</h3>
                      {task.description && <p className="weekly-desc">{task.description}</p>}
                      <div className="weekly-meta">
                        <span className={'weekly-date' + (isOverdue ? ' overdue' : isToday ? ' today' : '')} title={task.date || 'Chưa hẹn ngày'}>
                          📅 {formatShort(task.date)}{isOverdue ? ' · quá hạn' : isToday ? ' · hôm nay' : ''}
                        </span>
                      </div>
                      <div className="weekly-card-actions">
                        <div className="weekly-stepper" role="group" aria-label={'Chuyển trạng thái cho ' + task.title}>
                          <button type="button" title="Lùi về cột trước" disabled={task.status === 'todo'} onClick={() => stepTask(task, -1)} aria-label="Lùi về cột trước">←</button>
                          <span>{STATUS_LABEL[task.status]}</span>
                          <button type="button" title="Tiến tới cột sau" disabled={task.status === 'done'} onClick={() => stepTask(task, 1)} aria-label="Tiến tới cột sau">→</button>
                        </div>
                        <div className="weekly-icon-actions">
                          <button type="button" className="link-button" onClick={() => openEdit(task)} aria-label={'Sửa ' + task.title}>Sửa</button>
                          <button type="button" className="weekly-delete" onClick={() => removeTask(task.id)} aria-label={'Xóa ' + task.title}>×</button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>

              <button type="button" className="weekly-add" onClick={() => openCreate(col.id)}>
                ＋ Thêm vào {col.title.toLowerCase()}
              </button>
            </section>
          )
        })}
      </div>

      <p className="repeat-hint weekly-hint">
        💡 Mẹo: kéo-thả thẻ qua cột để đổi trạng thái. Trên điện thoại dùng nút ← → trong thẻ.
        {loggedIn ? ' Đã đăng nhập: việc lưu trên Supabase, đổi máy vẫn còn.' : ' Chưa đăng nhập: việc chỉ lưu trên trình duyệt này — đăng nhập để đồng bộ Supabase.'}
      </p>

      {composer && (
        <Modal title={composer.mode === 'edit' ? 'Sửa việc trong tuần' : 'Thêm việc trong tuần'} onClose={() => setComposer(null)}>
          <form onSubmit={(e) => { e.preventDefault(); saveComposer() }}>
            <label>Tên việc *
              <input autoFocus required maxLength={120} value={composer.draft.title} onChange={(e) => setComposer({ ...composer, draft: { ...composer.draft, title: e.target.value } })} placeholder="Ví dụ: Ôn 30 từ vựng Unit 5" />
            </label>
            <label>Mô tả
              <textarea rows={3} maxLength={500} value={composer.draft.description} onChange={(e) => setComposer({ ...composer, draft: { ...composer.draft, description: e.target.value } })} placeholder="Ghi rõ làm gì, bao nhiêu, tiêu chí xong…" />
            </label>
            <label>Môn học
              <input maxLength={40} list="weekly-subjects" value={composer.draft.subject} onChange={(e) => setComposer({ ...composer, draft: { ...composer.draft, subject: e.target.value } })} placeholder="Ví dụ: Toán, Tiếng Anh…" />
              <datalist id="weekly-subjects">{allSubjects.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            <div className="composer-times">
              <label>Ngày trong tuần
                <input type="date" value={composer.draft.date} min={mondayKey} max={sundayKey} onChange={(e) => setComposer({ ...composer, draft: { ...composer.draft, date: e.target.value } })} />
              </label>
              <label>Mức ưu tiên
                <select value={composer.draft.priority} onChange={(e) => setComposer({ ...composer, draft: { ...composer.draft, priority: e.target.value } })}>
                  {PRIORITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <label>Trạng thái
              <select value={composer.draft.status} onChange={(e) => setComposer({ ...composer, draft: { ...composer.draft, status: e.target.value } })}>
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {formError && <p role="alert">{formError}</p>}
            <div className="composer-actions">
              <button type="button" className="ghost-button" onClick={() => setComposer(null)}>Hủy</button>
              <button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : (composer.mode === 'edit' ? 'Lưu thay đổi' : 'Thêm việc')}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
