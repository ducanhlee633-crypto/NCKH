import { useEffect, useMemo, useRef, useState } from 'react'
import { PageIntro, ProgressBar, SectionCard, EmptyState } from '../components/PageComponents'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import { SCHOOL_SUBJECTS, defaultSubjects } from '../data/subjects'
import useGoals from '../data/useGoals'
import { grades, loadSettings } from '../data/settings'
import { buildAvailableDates, dateKey, MAX_LESSONS, safeMaterialUrl, validateRoadmapDraft } from '../data/roadmap'
import {
  createRoadmap,
  deleteRoadmap,
  fetchRoadmaps,
  generateRoadmapPlan,
  getSession,
  onSessionChange,
  patchRoadmapLesson,
  roadmapFromServer,
  roadmapToPayload,
} from '../backendApi'

// Chặng mặc định cho lộ trình cơ bản (không có stages riêng) — giữ để hiển thị.
const FALLBACK_STAGES = [
  { tone: 'blue', icon: '📖', title: 'Nền tảng' },
  { tone: 'mint', icon: '⚡', title: 'Vận dụng' },
  { tone: 'violet', icon: '🚀', title: 'Bứt phá' },
  { tone: 'gold', icon: '🏆', title: 'Về đích' },
]
const AI_TONES = ['blue', 'mint', 'violet', 'gold']
const AI_ICONS = ['📖', '⚡', '🚀', '🏆']
// Mỗi chặng có một nhóm việc mẫu để tự sinh buổi học từ ngữ cảnh.
const stageTasks = {
  0: ['Ôn kiến thức nền tảng', 'Hệ thống lý thuyết trọng tâm', 'Xem lại ví dụ mẫu', 'Ghi chú công thức / ý chính'],
  1: ['Luyện bài tập cơ bản', 'Làm bài vận dụng theo mẫu', 'Chữa lỗi sai thường gặp'],
  2: ['Giải bài nâng cao', 'Luyện đề tổng hợp', 'Rèn tốc độ làm bài'],
  3: ['Thi thử & tự chấm', 'Ôn tập tổng kết', 'Củng cố điểm yếu còn lại'],
}
const WEEKDAYS = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [0, 'CN']]
const emptyDraft = { title: '', goalId: '', subject: '', startDate: '', endDate: '', time: '19:00', duration: 60, sessionsPerWeek: 5, context: '', notes: '', grade: '', level: '', currentScore: '', targetScore: '', weakTopics: '', learningStyle: '', studyDays: [0, 1, 2, 3, 4, 5, 6] }

// Tách ngữ cảnh thành các ý ngắn (mỗi dòng một ý). Nếu người học chỉ viết
// một đoạn văn thì trả về mảng rỗng để giữ tiêu đề buổi học gọn gàng.
function extractFocuses(context) {
  return String(context || '')
    .split('\n')
    .map(line => String(line).trim().replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(line => line.length >= 2 && line.length <= 80)
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, 20)
}

// Tự sinh một bài học cho mỗi buổi trống, chia đều vào 4 chặng.
function buildLessonsFromContext({ context, slots, time, endLabel }) {
  const focuses = extractFocuses(context)
  const useFocus = focuses.length >= 2 ? focuses : []
  return slots.map((date, index) => {
    const stage = Math.min(3, Math.floor(index * 4 / slots.length))
    const tasks = stageTasks[stage] || stageTasks[0]
    const task = tasks[index % tasks.length]
    const focus = useFocus.length ? useFocus[index % useFocus.length] : ''
    const title = `Buổi ${index + 1}: ${task}${focus ? ` — ${focus}` : ''}`
    return { title, focus, stage, date: dateKey(date), start: time, end: endLabel, done: false }
  })
}

// Chuẩn hóa chặng hiển thị: lộ trình AI có `stages` tự đặt tên,
// lộ trình cơ bản rơi về 4 chặng mặc định.
function normalizeStages(roadmap) {
  const custom = Array.isArray(roadmap?.stages) ? roadmap.stages : []
  if (custom.length) {
    return custom.slice(0, 5).map((stage, index) => ({
      tone: AI_TONES[index % AI_TONES.length],
      icon: AI_ICONS[index % AI_ICONS.length],
      title: String(stage?.title || `Chặng ${index + 1}`),
      goal: String(stage?.goal || ''),
      materials: Array.isArray(stage?.materials) ? stage.materials.filter(item => safeMaterialUrl(item?.url)) : [],
      checkpoint: String(stage?.checkpoint || ''),
      isAi: true,
    }))
  }
  return FALLBACK_STAGES.map(stage => ({ ...stage, goal: '', materials: [], checkpoint: '', isAi: false }))
}

// Dàn buổi AI (đã đủ total_sessions) thành lessons có ngày/giờ để xếp lịch.
function buildLessonsFromAiPlan({ planStages, slots, time, endLabel }) {
  const flat = []
  ;(planStages || []).forEach((stage, stageIndex) => {
    ;(stage?.lessons || []).forEach(lesson => {
      if (!lesson?.title) return
      const material = (stage?.materials || []).find(item => item.url === lesson.material_url)
      flat.push({
        title: String(lesson.title),
        focus: String(lesson.focus || ''),
        materialUrl: String(lesson.material_url || ''),
        materialLabel: String(material?.label || lesson.material_url || ''),
        stage: stageIndex,
      })
    })
  })
  return flat.slice(0, slots.length).map((lesson, index) => ({
    ...lesson,
    date: dateKey(slots[index]),
    start: time,
    end: endLabel,
    done: false,
  }))
}

// ---------- Presentational helpers cho layout course ----------

const COVER_TONES = ['blue', 'violet', 'gold', 'mint', 'rose', 'sky']
function coverTone(subject) {
  const text = String(subject || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return COVER_TONES[hash % COVER_TONES.length]
}

function subjectIcon(subject) {
  const text = String(subject || '').toLowerCase()
  if (text.includes('toán') || text.includes('toan')) return '📐'
  if (text.includes('văn') || text.includes('van')) return '📝'
  if (text.includes('anh') || text.includes('tiếng anh') || text.includes('english')) return '🔤'
  if (text.includes('lý') || text.includes('ly') || text.includes('vật')) return '⚛️'
  if (text.includes('hóa') || text.includes('hoa')) return '⚗️'
  if (text.includes('sinh')) return '🧬'
  if (text.includes('sử') || text.includes('su')) return '🏛️'
  if (text.includes('địa') || text.includes('dia')) return '🌍'
  if (text.includes('tin')) return '💻'
  return '📚'
}

function formatDate(value) {
  if (!value) return ''
  return String(value).split('-').reverse().join('/')
}

function progressOf(lessons) {
  const list = Array.isArray(lessons) ? lessons : []
  const done = list.filter(item => item.done).length
  const percent = list.length ? Math.round(done / list.length * 100) : 0
  return { total: list.length, done, left: list.length - done, percent }
}

export default function RoadmapPage({ onNavigate, detailId }) {
  // Lộ trình BẮT BUỘC đăng nhập mới lưu được (server là nguồn sự thật duy nhất).
  const [session, setSession] = useState(() => getSession())
  const loggedIn = !!session
  const [serverRows, setServerRows] = useState(null)
  const [syncError, setSyncError] = useState('')
  const [saving, setSaving] = useState(false)
  const [storedSubjects] = useStoredState('nhip-hoc-subjects', defaultSubjects)
  const subjects = Array.isArray(storedSubjects) ? storedSubjects : defaultSubjects
  const { goals, loadingGoals, syncError: goalSyncError } = useGoals()
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [validation, setValidation] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [mode, setMode] = useState('ai')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState(null)
  // Mở/đóng từng chặng trong trang chi tiết (accordion kiểu course).
  const [openStages, setOpenStages] = useState({})
  const request = useRef(null)
  const prefillHandled = useRef(false)
  const selectedGoal = goals.find(item => item.id === draft.goalId)
  const inputKey = JSON.stringify({ draft, goal: selectedGoal })
  const currentKey = useRef(inputKey)
  currentKey.current = inputKey
  const aiPlan = aiResult?.inputKey === inputKey ? aiResult.stages : null
  const slots = useMemo(() => buildAvailableDates(new Date(draft.startDate + 'T00:00:00'), new Date(draft.endDate + 'T00:00:00'), Number(draft.sessionsPerWeek), draft.studyDays), [draft.startDate, draft.endDate, draft.sessionsPerWeek, draft.studyDays])
  const previewCount = slots.length
  const aiReady = !!aiPlan?.length

  useEffect(() => onSessionChange(setSession), [])

  useEffect(() => {
    if (!loggedIn) { setServerRows(null); setSyncError(''); return }
    let mounted = true
    setServerRows(null)
    setSyncError('')
    fetchRoadmaps()
      .then(rows => { if (mounted) setServerRows(rows) })
      .catch(failure => {
        if (mounted) {
          setSyncError(failure?.friendlyMessage || 'Không tải được lộ trình từ server.')
          setServerRows([])
        }
      })
    return () => { mounted = false }
  }, [loggedIn])

  // Map server rows -> UI items, gắn goalTitle từ goals để hiển thị tag 🎯.
  const roadmaps = useMemo(() => {
    const rows = Array.isArray(serverRows) ? serverRows : []
    return rows
      .map(row => {
        const item = roadmapFromServer(row)
        const goal = goals.find(g => g.id === item.goalId)
        return { ...item, goalTitle: goal?.title || '' }
      })
      .filter(item => item?.id && Array.isArray(item.lessons))
  }, [serverRows, goals])
  const loadingRoadmaps = loggedIn && serverRows === null

  // Detail: tìm theo route #roadmap/:id. Không còn dropdown chọn lộ trình.
  const active = detailId ? roadmaps.find(item => String(item.id) === String(detailId)) : null
  const activeLessons = active?.lessons || []
  const activeStages = useMemo(() => normalizeStages(active), [active])
  const activeProgress = progressOf(activeLessons)

  // Về đầu trang mỗi khi chuyển sang lộ trình khác.
  useEffect(() => {
    if (detailId) window.scrollTo({ top: 0 })
  }, [detailId])

  // Mặc định mở chặng đầu tiên chưa xong, các chặng còn lại đóng.
  useEffect(() => {
    if (!active) return
    setOpenStages(prev => {
      if (Object.keys(prev).length) return prev
      const firstOpen = {}
      let opened = false
      activeStages.forEach((stage, index) => {
        const lessons = activeLessons.filter(item => item.stage === index)
        const done = lessons.filter(item => item.done).length
        const shouldOpen = !opened && (!lessons.length || done < lessons.length)
        firstOpen[index] = shouldOpen || (!opened && index === 0)
        if (shouldOpen) opened = true
      })
      return firstOpen
    })
  }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Reset accordion khi đổi lộ trình.
  useEffect(() => { setOpenStages({}) }, [detailId])

  function cancelGeneration() {
    request.current?.abort()
    request.current = null
    setAiLoading(false)
  }
  function closeComposer() {
    cancelGeneration()
    setShowModal(false)
  }
  function update(key, value) {
    cancelGeneration()
    setDraft(old => ({ ...old, [key]: value }))
    setAiResult(null)
    setAiError('')
    setValidation('')
  }
  function openComposer(prefillGoalId) {
    if (!loggedIn) {
      setValidation('')
      setAiError('')
      setShowModal(false)
      return
    }
    cancelGeneration()
    const today = new Date()
    const end = new Date(today)
    end.setDate(end.getDate() + 27)
    const goal = goals.find(item => item.id === prefillGoalId)
    setDraft({ ...emptyDraft, goalId: goal?.id || '', title: goal?.title || '', subject: subjects[0] || '',
      grade: String(loadSettings().grade || ''), startDate: dateKey(today),
      endDate: goal?.date >= dateKey(today) ? goal.date : dateKey(end), targetScore: goal?.targetScore ?? '' })
    setMode('ai')
    setValidation(''); setAiError(''); setAiResult(null); setShowModal(true)
  }
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (loadingGoals || prefillHandled.current) return
    prefillHandled.current = true
    let prefill = null
    try { prefill = localStorage.getItem('nhip-hoc-roadmap-prefill-goal'); localStorage.removeItem('nhip-hoc-roadmap-prefill-goal') } catch { /* Storage unavailable. */ }
    if (prefill && loggedIn) openComposer(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingGoals, loggedIn])

  async function generateWithAi() {
    if (request.current) return
    setAiError(''); setValidation('')
    const checked = validateRoadmapDraft(draft)
    if (checked.error) { setValidation(checked.error); return }
    if (loadingGoals) { setValidation('Đang tải mục tiêu học tập.'); return }
    if (draft.goalId && !selectedGoal) { setValidation('Mục tiêu không còn tồn tại. Hãy chọn lại.'); return }
    if (!getSession()) { setAiError('Hãy đăng nhập để AI soạn lộ trình cá nhân hóa.'); return }
    const controller = new AbortController()
    request.current = controller
    setAiLoading(true)
    setAiResult(null)
    try {
      const result = await generateRoadmapPlan({
        subject: draft.subject.trim(), context: draft.context.trim(), totalSessions: checked.slots.length,
        goalTitle: selectedGoal?.title || draft.title.trim(),
        goalDetails: selectedGoal ? { targetScore: selectedGoal.targetScore ?? null, deadline: selectedGoal.date || null } : null,
        duration: Number(draft.duration), sessionsPerWeek: Number(draft.sessionsPerWeek),
        startDate: draft.startDate, endDate: draft.endDate, studyDays: draft.studyDays, notes: draft.notes.trim(),
        learnerProfile: { grade: draft.grade ? Number(draft.grade) : null, level: draft.level,
          currentScore: draft.currentScore === '' ? null : Number(draft.currentScore),
          targetScore: draft.targetScore === '' ? null : Number(draft.targetScore),
          weakTopics: draft.weakTopics.trim(), learningStyle: draft.learningStyle.trim() },
      }, { signal: controller.signal })
      if (!controller.signal.aborted && currentKey.current === inputKey) setAiResult({ ...result, inputKey })
    } catch (failure) {
      if (!controller.signal.aborted && currentKey.current === inputKey) setAiError(failure?.friendlyMessage || 'AI không tạo được lộ trình. Hãy thử lại.')
    } finally {
      if (request.current === controller) { request.current = null; setAiLoading(false) }
    }
  }

  async function create(event) {
    event.preventDefault()
    if (aiLoading || saving) return
    if (!loggedIn) { setValidation('Hãy đăng nhập để lưu lộ trình học.'); return }
    const checked = validateRoadmapDraft(draft)
    if (checked.error) { setValidation(checked.error); return }
    if (draft.goalId && !selectedGoal) { setValidation('Mục tiêu không còn tồn tại. Hãy chọn lại.'); return }
    if (mode === 'ai' && !aiReady) { generateWithAi(); return }
    const { slots: dates, endLabel } = checked
    const useAi = mode === 'ai' && aiReady
    const lessons = useAi ? buildLessonsFromAiPlan({ planStages: aiPlan, slots: dates, time: draft.time, endLabel }) :
      buildLessonsFromContext({ context: draft.context, slots: dates, time: draft.time, endLabel })
    if (lessons.length !== dates.length) { setValidation('Bản AI thiếu buổi học. Hãy soạn lại.'); return }
    const stages = useAi ? aiPlan.map(({ lessons: _lessons, ...stage }) => stage) : []
    const payload = roadmapToPayload({ draft, stages, lessons, aiGenerated: useAi })
    setSaving(true)
    setValidation('')
    try {
      const created = await createRoadmap(payload)
      setServerRows(rows => [...(Array.isArray(rows) ? rows : []), created])
      closeComposer()
      setAiResult(null)
      if (created?.id) onNavigate(`roadmap/${created.id}`)
    } catch (failure) {
      setValidation(failure?.friendlyMessage || 'Không lưu được lộ trình lên server. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleLesson(lessonId, nextDone) {
    if (!active || !lessonId) return
    const snapshot = serverRows
    setServerRows(rows => (Array.isArray(rows) ? rows : []).map(row => row.id === active.id ? {
      ...row, lessons: (row.lessons || []).map(lesson => lesson.id === lessonId ? { ...lesson, done: nextDone } : lesson),
    } : row))
    try {
      const updated = await patchRoadmapLesson(lessonId, { done: nextDone })
      setServerRows(rows => (Array.isArray(rows) ? rows : []).map(row => row.id === active.id ? {
        ...row, lessons: (row.lessons || []).map(lesson => lesson.id === lessonId ? { ...lesson, done: !!updated?.done } : lesson),
      } : row))
    } catch (failure) {
      setServerRows(snapshot)
      setSyncError(failure?.friendlyMessage || 'Không cập nhật được buổi học trên server. Đã hoàn tác.')
    }
  }

  async function removeRoadmap() {
    if (!deleting?.id || saving) return
    const snapshot = serverRows
    const removedId = deleting.id
    setSaving(true)
    setServerRows(rows => (Array.isArray(rows) ? rows : []).filter(item => item.id !== removedId))
    setDeleting(null)
    try {
      await deleteRoadmap(removedId)
      // Nếu đang ở trang chi tiết của lộ trình vừa xóa -> về danh sách.
      if (detailId && String(detailId) === String(removedId)) onNavigate('roadmap')
    } catch (failure) {
      setServerRows(snapshot)
      setSyncError(failure?.friendlyMessage || 'Không xóa được lộ trình trên server. Đã hoàn tác.')
    } finally {
      setSaving(false)
    }
  }

  const syncStatus = !loggedIn
    ? 'Hãy đăng nhập để lưu lộ trình học lên server.'
    : loadingRoadmaps
      ? 'Đang tải lộ trình từ server…'
      : syncError
        ? syncError
        : serverRows
          ? `Đã lưu lộ trình lên server ✓ (${roadmaps.length} lộ trình)`
          : ''

  // ---------- DETAIL VIEW: hero + curriculum accordion ----------
  if (detailId) {
    if (!loggedIn) {
      return <>
        <PageIntro eyebrow="LỘ TRÌNH HỌC" title="Chi tiết lộ trình" subtitle="Hãy đăng nhập để xem nội dung chi tiết." />
        <SectionCard><h2>Cần đăng nhập để xem lộ trình 🔒</h2><p>Lộ trình học được lưu trên server theo tài khoản. Hãy đăng nhập để tiếp tục.</p><button className="primary-button" onClick={() => onNavigate('login')}>Đăng nhập</button></SectionCard>
      </>
    }
    if (loadingRoadmaps) return <><PageIntro eyebrow="LỘ TRÌNH HỌC" title="Đang tải…" subtitle="Đang lấy nội dung khóa học từ server." /><p role="status">Đang tải lộ trình…</p></>
    if (!active) {
      return <>
        <button className="ghost-button course-back" onClick={() => onNavigate('roadmap')}>← Tất cả lộ trình</button>
        <SectionCard className="not-found"><span aria-hidden="true">🧭</span><h2>Không tìm thấy lộ trình</h2><p>Lộ trình này có thể đã bị xóa hoặc bạn không có quyền xem.</p><button className="primary-button" onClick={() => onNavigate('roadmap')}>Về danh sách</button></SectionCard>
      </>
    }

    const nextLesson = activeLessons.find(item => !item.done)

    return <>
      <nav className="course-breadcrumb" aria-label="Điều hướng lộ trình">
        <button className="link-button" onClick={() => onNavigate('roadmap')}>Lộ trình học</button>
        <span aria-hidden="true">/</span>
        <span className="current">{active.title}</span>
      </nav>

      <section className="course-hero">
        <div className={'course-hero-cover ' + coverTone(active.subject)}>
          <span className="course-hero-icon" aria-hidden="true">{subjectIcon(active.subject)}</span>
          <div className="course-hero-tags">
            <span className="tag blue">{active.subject || 'Chưa chọn môn'}</span>
            {active.aiGenerated && <span className="tag violet">✨ AI soạn</span>}
            {active.goalTitle && <span className="tag mint">🎯 {active.goalTitle}</span>}
          </div>
        </div>
        <div className="course-hero-body">
          <h1>{active.title}</h1>
          <p className="course-hero-meta">
            {formatDate(active.startDate)} – {formatDate(active.endDate)}
            {(active.duration || active.sessionsPerWeek) ? ` · ⏱ ${active.duration || 60} phút/buổi · 📅 ${active.sessionsPerWeek || 5} buổi/tuần` : ''}
          </p>
          {active.context && <p className="course-hero-desc">🧭 {active.context}</p>}
          {active.notes && <p className="course-hero-desc muted">📝 {active.notes}</p>}

          <div className="course-hero-progress">
            <div className="course-hero-progress-top">
              <b>{activeProgress.done} / {activeProgress.total} buổi hoàn thành</b>
              <strong>{activeProgress.percent}%</strong>
            </div>
            <ProgressBar value={activeProgress.percent} />
            {nextLesson
              ? <p className="course-next">Tiếp theo: <b>{nextLesson.title}</b> · {formatDate(nextLesson.date)} · {nextLesson.start}–{nextLesson.end}</p>
              : <p className="course-next done">🎉 Bạn đã hoàn thành toàn bộ lộ trình!</p>}
          </div>

          <div className="course-hero-actions">
            <button className="primary-button" onClick={() => document.getElementById('curriculum')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {activeProgress.done > 0 ? 'Tiếp tục học →' : 'Bắt đầu học →'}
            </button>
            <button className="ghost-button" onClick={() => onNavigate('schedule')}>Xem trong lịch</button>
            <button className="delete-button" disabled={saving} onClick={() => setDeleting(active)}>Xóa</button>
          </div>
        </div>
        <aside className="course-hero-side">
          <div className="course-stat-grid">
            <div><b>{activeProgress.total}</b><span>Tổng buổi</span></div>
            <div><b>{activeProgress.done}</b><span>Đã xong</span></div>
            <div><b>{activeProgress.left}</b><span>Còn lại</span></div>
            <div><b>{activeStages.length}</b><span>Chặng</span></div>
          </div>
          <div className="course-side-note">
            <b>⏱ Tổng thời lượng</b>
            <p>{Math.round(activeProgress.total * (active.duration || 60) / 60 * 10) / 10} giờ học dự kiến</p>
          </div>
        </aside>
      </section>

      {syncError && <p role="alert" className="repeat-hint">{syncError}</p>}

      <div className="section-heading course-curriculum-head" id="curriculum">
        <h2>📚 Nội dung khóa học</h2>
        <span className="muted-label">{activeStages.length} chặng · {activeProgress.total} buổi</span>
      </div>

      <div className="curriculum">
        {activeStages.map((stage, index) => {
          const lessons = activeLessons.filter(item => item.stage === index)
          const done = lessons.filter(item => item.done).length
          const percent = lessons.length ? Math.round(done / lessons.length * 100) : 0
          const open = !!openStages[index]
          return (
            <section key={stage.title + index} className={'stage-accordion ' + stage.tone + (open ? ' open' : '')}>
              <button
                className="stage-accordion-head"
                aria-expanded={open}
                onClick={() => setOpenStages(prev => ({ ...prev, [index]: !prev[index] }))}
              >
                <span className="stage-accordion-icon" aria-hidden="true">{stage.icon}</span>
                <span className="stage-accordion-titles">
                  <small>Chặng {index + 1} · {done}/{lessons.length} buổi · {percent}%</small>
                  <b>{stage.title}</b>
                </span>
                <span className="stage-accordion-progress"><i style={{ width: percent + '%' }} /></span>
                <span className="stage-accordion-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="stage-accordion-body">
                  {stage.goal && <p className="stage-goal">🎯 Mục tiêu chặng: {stage.goal}</p>}
                  {lessons.length === 0 && <p className="muted-label">Chặng này chưa có buổi học.</p>}
                  <ol className="lesson-list">
                    {lessons.map((lesson, lessonIndex) => (
                      <li key={lesson.id || lessonIndex} className={lesson.done ? 'done' : ''}>
                        <label className="lesson-row">
                          <input
                            type="checkbox"
                            checked={!!lesson.done}
                            onChange={() => toggleLesson(lesson.id, !lesson.done)}
                            aria-label={'Đánh dấu ' + lesson.title}
                          />
                          <span className="lesson-check" aria-hidden="true">{lesson.done ? '✓' : `${lessonIndex + 1}`}</span>
                          <span className="lesson-main">
                            <b>{lesson.title}</b>
                            {lesson.focus && <small className="lesson-focus">🎯 {lesson.focus}</small>}
                            <small className="lesson-meta">{formatDate(lesson.date)} · {lesson.start}–{lesson.end}</small>
                            {safeMaterialUrl(lesson.materialUrl) && (
                              <small className="lesson-link">📎 <a href={safeMaterialUrl(lesson.materialUrl)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{lesson.materialLabel || lesson.materialUrl}</a></small>
                            )}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ol>
                  {stage.materials?.length > 0 && (
                    <div className="stage-materials">
                      <b>📚 Tài liệu chặng:</b>
                      <ul>{stage.materials.map(item => <li key={item.url}><a href={safeMaterialUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.label || item.url}</a></li>)}</ul>
                    </div>
                  )}
                  {stage.checkpoint && <p className="stage-checkpoint">✅ Checkpoint: {stage.checkpoint}</p>}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {showModal && <ComposerModal
        draft={draft} update={update} mode={mode} setMode={setMode}
        goals={goals} loadingGoals={loadingGoals} goalSyncError={goalSyncError} selectedGoal={selectedGoal}
        subjects={subjects} slots={slots} previewCount={previewCount}
        aiLoading={aiLoading} aiError={aiError} aiReady={aiReady} aiPlan={aiPlan} aiResult={aiResult}
        validation={validation} syncError={syncError} saving={saving}
        create={create} closeComposer={closeComposer} generateWithAi={generateWithAi} cancelGeneration={cancelGeneration}
      />}
      {deleting && <Modal title="Xóa lộ trình" onClose={() => setDeleting(null)}><p>Xóa “{deleting.title}” và toàn bộ chặng + buổi học trên server?</p>{syncError && <p role="alert">{syncError}</p>}<div className="composer-actions"><button className="ghost-button" onClick={() => setDeleting(null)}>Hủy</button><button className="primary-button" disabled={saving} onClick={removeRoadmap}>{saving ? 'Đang xóa…' : 'Xóa lộ trình'}</button></div></Modal>}
    </>
  }

  // ---------- LIST VIEW: grid card chuẩn course ----------
  return <>
    <PageIntro eyebrow="CHIA NHỎ ĐỂ DỄ HỌC" title="Lộ trình học" subtitle="Chọn một khóa học để xem chi tiết từng chặng và từng buổi — như một course chuyên nghiệp.">
      <button className="primary-button" disabled={!loggedIn} onClick={() => openComposer()} title={loggedIn ? '' : 'Hãy đăng nhập để tạo lộ trình'}>＋ Tạo lộ trình</button>
    </PageIntro>
    {syncStatus && <p className="repeat-hint" role="status">{syncStatus}{!loggedIn && <button className="ghost-button" onClick={() => onNavigate('login')}>Đăng nhập</button>}</p>}
    {goalSyncError && <p role="alert">{goalSyncError}</p>}
    {!loggedIn ? <SectionCard><h2>Cần đăng nhập để lưu lộ trình 🔒</h2><p>Lộ trình học được lưu trên server theo tài khoản (3 bảng roadmaps + stages + lessons), không còn lưu local. Hãy đăng nhập để tạo, xem tiến độ và tick từng buổi học.</p><button className="primary-button" onClick={() => onNavigate('login')}>Đăng nhập</button></SectionCard> : <>
    {loadingRoadmaps ? <p role="status">Đang tải lộ trình…</p> : <>
    {roadmaps.length === 0 ? (
      <EmptyState icon="🗺️" title="Chưa có lộ trình nào. Tạo lộ trình đầu tiên để bắt đầu nhé!" button="Tạo lộ trình" onAction={() => openComposer()} />
    ) : (
      <>
        <div className="section-heading course-count"><h2>📚 Khóa học của bạn ({roadmaps.length})</h2></div>
        <div className="course-grid">
          {roadmaps.map(item => {
            const stats = progressOf(item.lessons)
            return (
              <article
                key={item.id}
                className="course-card"
                onClick={() => onNavigate(`roadmap/${item.id}`)}
                onKeyDown={event => { if (event.key === 'Enter') onNavigate(`roadmap/${item.id}`) }}
                tabIndex={0}
                aria-label={'Mở lộ trình ' + item.title}
              >
                <div className={'course-cover ' + coverTone(item.subject)}>
                  <span className="course-cover-icon" aria-hidden="true">{subjectIcon(item.subject)}</span>
                  <div className="course-cover-tags">
                    <span className="tag blue">{item.subject || 'Chưa chọn môn'}</span>
                    {item.aiGenerated && <span className="tag violet">✨ AI</span>}
                  </div>
                  <span className="course-cover-progress">{stats.percent}%</span>
                </div>
                <div className="course-body">
                  <h3>{item.title}</h3>
                  {item.goalTitle && <p className="course-goal">🎯 {item.goalTitle}</p>}
                  <p className="course-meta">{formatDate(item.startDate)} – {formatDate(item.endDate)} · {stats.total} buổi</p>
                  <ProgressBar value={stats.percent} />
                  <div className="course-foot">
                    <span>{stats.done}/{stats.total} buổi xong</span>
                    <span className="course-cta">Vào học →</span>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </>
    )}
    </>}
    </>}
    {showModal && <ComposerModal
      draft={draft} update={update} mode={mode} setMode={setMode}
      goals={goals} loadingGoals={loadingGoals} goalSyncError={goalSyncError} selectedGoal={selectedGoal}
      subjects={subjects} slots={slots} previewCount={previewCount}
      aiLoading={aiLoading} aiError={aiError} aiReady={aiReady} aiPlan={aiPlan} aiResult={aiResult}
      validation={validation} syncError={syncError} saving={saving}
      create={create} closeComposer={closeComposer} generateWithAi={generateWithAi} cancelGeneration={cancelGeneration}
    />}
    {deleting && <Modal title="Xóa lộ trình" onClose={() => setDeleting(null)}><p>Xóa “{deleting.title}” và toàn bộ chặng + buổi học trên server?</p>{syncError && <p role="alert">{syncError}</p>}<div className="composer-actions"><button className="ghost-button" onClick={() => setDeleting(null)}>Hủy</button><button className="primary-button" disabled={saving} onClick={removeRoadmap}>{saving ? 'Đang xóa…' : 'Xóa lộ trình'}</button></div></Modal>}
  </>
}

function ComposerModal({ draft, update, mode, setMode, goals, loadingGoals, goalSyncError, selectedGoal, subjects, slots, previewCount, aiLoading, aiError, aiReady, aiPlan, aiResult, validation, syncError, saving, create, closeComposer, generateWithAi, cancelGeneration }) {
  return (
    <Modal title="Thiết lập lộ trình" onClose={closeComposer}>
      <form onSubmit={create}>
        <label>Mục tiêu liên kết<select disabled={loadingGoals} value={draft.goalId} onChange={event => update('goalId', event.target.value)}>
          <option value="">{loadingGoals ? 'Đang tải mục tiêu…' : 'Không liên kết mục tiêu'}</option>
          {goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select></label>
        {goalSyncError && <p role="alert">{goalSyncError}</p>}
        {selectedGoal && <p>Mục tiêu: {selectedGoal.title}{selectedGoal.targetScore != null ? ` · ${selectedGoal.targetScore}/10 điểm` : ''}{selectedGoal.date ? ` · Hạn ${selectedGoal.date.split('-').reverse().join('/')}` : ''}</p>}
        <label>Tên lộ trình<input autoFocus required maxLength={160} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="Ví dụ: Ôn thi Toán học kỳ I" /></label>
        <div className="composer-times">
          <label>Môn học<input required maxLength={80} list="roadmap-subjects" value={draft.subject} onChange={event => update('subject', event.target.value)} /><datalist id="roadmap-subjects">{[...new Set([...subjects, ...SCHOOL_SUBJECTS])].map(subject => <option key={subject} value={subject} />)}</datalist></label>
          <label>Lớp<select value={draft.grade} onChange={event => update('grade', event.target.value)}><option value="">Chưa chọn</option>{grades.map(grade => <option key={grade} value={grade}>Lớp {grade}</option>)}</select></label>
        </div>
        <label>Trình độ hiện tại<select value={draft.level} onChange={event => update('level', event.target.value)}>
          <option value="">Chưa rõ — cần đánh giá ban đầu</option><option value="foundation">Mất gốc / mới bắt đầu</option><option value="basic">Biết cơ bản, vận dụng còn khó</option><option value="confident">Khá vững, cần luyện thêm</option><option value="advanced">Nâng cao / luyện thi điểm cao</option>
        </select></label>
        <div className="composer-times">
          <label>Điểm hiện tại (0–10)<input type="number" min="0" max="10" step="0.1" value={draft.currentScore} onChange={event => update('currentScore', event.target.value)} placeholder="Không bắt buộc" /></label>
          <label>Điểm mong muốn (0–10)<input type="number" min="0" max="10" step="0.1" value={draft.targetScore} onChange={event => update('targetScore', event.target.value)} placeholder={selectedGoal?.targetScore != null ? String(selectedGoal.targetScore) : 'Không bắt buộc'} /></label>
        </div>
        <label>Nội dung cần học và kết quả mong muốn<textarea required rows={4} maxLength={2000} value={draft.context} onChange={event => update('context', event.target.value)} placeholder="Ví dụ: Ôn phương trình bậc hai và hệ thức Viète để thi học kỳ. Đã biết giải phương trình bậc nhất." /></label>
        <label>Phần còn yếu<textarea rows={2} maxLength={600} value={draft.weakTopics} onChange={event => update('weakTopics', event.target.value)} placeholder="Ví dụ: Biến đổi biểu thức, nhận diện dạng bài" /></label>
        <label>Cách học và tài liệu đang dùng<input maxLength={300} value={draft.learningStyle} onChange={event => update('learningStyle', event.target.value)} placeholder="Ví dụ: Ví dụ trực quan rồi tự luyện; SGK Kết nối tri thức" /></label>
        <div className="composer-times">
          <label>Ngày bắt đầu<input required type="date" value={draft.startDate} onChange={event => update('startDate', event.target.value)} /></label>
          <label>Ngày kết thúc<input required type="date" min={draft.startDate} value={draft.endDate} onChange={event => update('endDate', event.target.value)} /></label>
        </div>
        {selectedGoal?.date && draft.endDate > selectedGoal.date && <p role="status">Lộ trình kết thúc sau hạn mục tiêu. Hãy điều chỉnh nếu bạn cần hoàn thành trước hạn.</p>}
        <div className="composer-times">
          <label>Giờ bắt đầu<input required type="time" value={draft.time} onChange={event => update('time', event.target.value)} /></label>
          <label>Phút mỗi buổi<input required type="number" min="5" max="240" step="1" value={draft.duration} onChange={event => update('duration', event.target.value)} /></label>
        </div>
        <fieldset className="roadmap-days"><legend>Những ngày có thể học</legend>{WEEKDAYS.map(([day, label]) => <label key={day}><input type="checkbox" checked={draft.studyDays.includes(day)} onChange={() => update('studyDays', draft.studyDays.includes(day) ? draft.studyDays.filter(item => item !== day) : [...draft.studyDays, day])} />{label}</label>)}</fieldset>
        <label>Số buổi mỗi tuần<input required type="number" min="1" max={Math.max(1, draft.studyDays.length)} step="1" value={draft.sessionsPerWeek} onChange={event => update('sessionsPerWeek', event.target.value)} /></label>
        <label>Lưu ý và giới hạn thời gian<textarea rows={2} maxLength={2000} value={draft.notes} onChange={event => update('notes', event.target.value)} placeholder="Ví dụ: Dễ mất tập trung, cần nghỉ ngắn trong buổi học" /></label>
        <p role="status">{previewCount > MAX_LESSONS ? `Vượt giới hạn ${MAX_LESSONS} buổi — hãy rút ngắn thời hạn.` : previewCount ? `${previewCount} buổi · ${Math.round(previewCount * Number(draft.duration) / 60 * 10) / 10} giờ học · rải đều vào các ngày đã chọn.` : 'Chọn ngày học và số buổi phù hợp để xem lịch dự kiến.'}</p>
        <label>Cách tạo<select value={mode} onChange={event => { cancelGeneration(); setMode(event.target.value); setAiError('') }}><option value="ai">AI cá nhân hóa theo hồ sơ học tập</option><option value="basic">Khung cơ bản — tự điều chỉnh nội dung</option></select></label>
        {mode === 'ai' ? <div className="ai-roadmap-box" aria-busy={aiLoading}>
          <div className="ai-roadmap-head"><b>AI soạn lộ trình</b><span role="status">{aiLoading ? 'Đang tìm tài liệu và soạn từng chặng…' : aiReady ? `Đã soạn ${previewCount} buổi` : 'Chưa soạn'}</span></div>
          <p>AI dựa trên trình độ, điểm yếu, mục tiêu và thời lượng để chia kiến thức, ôn tập, luyện tập và kiểm tra. Lộ trình dài có thể mất vài phút.</p>
          <button type="button" className="ghost-button" disabled={aiLoading || loadingGoals || !previewCount || previewCount > MAX_LESSONS} onClick={generateWithAi}>{aiLoading ? 'Đang soạn…' : aiReady ? 'Soạn lại bằng AI' : 'Soạn và xem trước'}</button>
          {aiLoading && <button type="button" className="goal-action" onClick={cancelGeneration}>Dừng chờ kết quả</button>}
          {aiError && <p role="alert">{aiError}</p>}
          {aiReady && <div className="ai-roadmap-preview">
            {aiResult.warnings.map((warning, index) => <p key={index} role="status">{warning}</p>)}
            <p>Xem từng buổi trước khi lưu vào lịch. Link được lấy từ tìm kiếm; hãy kiểm tra nội dung phù hợp.</p>
            {aiPlan.map((stage, index) => <details key={index} className="ai-stage-preview" open={index === 0}>
              <summary>Chặng {index + 1}: {stage.title} ({stage.lessons.length} buổi)</summary>
              <p>{stage.goal}</p>
              <ol>{stage.lessons.map((lesson, lessonIndex) => {
                const offset = aiPlan.slice(0, index).reduce((sum, item) => sum + item.lessons.length, 0) + lessonIndex
                return <li key={lessonIndex}><b>{lesson.title}</b><small>{dateKey(slots[offset])} · {draft.time} · {draft.duration} phút</small><p>{lesson.focus}</p>{lesson.material_url && <a href={lesson.material_url} target="_blank" rel="noopener noreferrer">{stage.materials.find(item => item.url === lesson.material_url)?.label || 'Mở tài liệu'}</a>}</li>
              })}</ol>
              <p className="stage-checkpoint">{stage.checkpoint}</p>
            </details>)}
          </div>}
        </div> : <p>Khung cơ bản chia việc học theo mẫu, chưa đánh giá trình độ và chưa có tài liệu cá nhân hóa.</p>}
        {(validation || syncError) && <p role="alert">{validation || syncError}</p>}
        <div className="composer-actions"><button type="button" className="ghost-button" onClick={closeComposer}>Hủy</button><button className="primary-button" disabled={aiLoading || loadingGoals || saving}>{saving ? 'Đang lưu…' : mode === 'basic' ? 'Lưu khung cơ bản' : aiReady ? 'Lưu lộ trình vào lịch' : 'Soạn lộ trình bằng AI'}</button></div>
      </form>
    </Modal>
  )
}
