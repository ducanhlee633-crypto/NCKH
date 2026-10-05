import { useEffect, useMemo, useState } from 'react'
import { completeOnboarding, fetchGoals, fetchOnboardingStatus, getSession, syncProfile, updateSessionProfile } from '../backendApi'
import { AI_TONES, grades, normalizeAiTone } from '../data/settings'
import '../styles/onboarding.css'

const STEPS = ['Lớp', 'Mục tiêu', 'Giọng AI', 'Giờ học']
const GOAL_ICONS = ['🌱', '📚', '🎯', '💪', '⭐', '🚀', '🧠', '✨']

function schoolYearDefaults() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (month >= 9) return { startDate: `${year}-09-01`, endDate: `${year + 1}-08-31` }
  return { startDate: `${year - 1}-09-01`, endDate: `${year}-08-31` }
}

function blankGoal(defaults) {
  return { title: '', targetScore: '', icon: '🌱', startDate: defaults.startDate, endDate: defaults.endDate }
}

function draftKey(userId) {
  return `nhip-hoc-onboarding-draft-${userId || 'guest'}`
}

function normalizeTargetScore(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10))
}

export default function OnboardingPage({ initialStatus, onDone, onLogout }) {
  const session = getSession()
  const userId = session?.user?.id
  const defaults = useMemo(() => schoolYearDefaults(), [])
  const [_status, setStatus] = useState(initialStatus || null)
  const [statusLoading, setStatusLoading] = useState(!initialStatus)
  const [step, setStep] = useState(0)
  const [grade, setGrade] = useState(initialStatus?.grade || session?.profile?.grade || '')
  const [serverGoalsCount, setServerGoalsCount] = useState(initialStatus?.goalsCount ?? 0)
  const [goals, setGoals] = useState(() => {
    try {
      const raw = localStorage.getItem(draftKey(userId))
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.goals) && parsed.goals.length) return parsed.goals
      }
    } catch { /* bỏ qua */ }
    return [blankGoal(defaults), blankGoal(defaults), blankGoal(defaults)]
  })
  const [aiTone, setAiTone] = useState(() => normalizeAiTone(initialStatus?.aiTone || 'cute'))
  const [weeklyHours, setWeeklyHours] = useState(Number(initialStatus?.weeklyHours || 12))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Tải status + số goals server để resume đúng bước dở khi vào lại.
  useEffect(() => {
    let mounted = true
    async function load() {
      if (initialStatus) return
      setStatusLoading(true)
      try {
        const fresh = await fetchOnboardingStatus()
        if (!mounted) return
        setStatus(fresh)
        setServerGoalsCount(fresh.goalsCount || 0)
        if (fresh.grade) setGrade(fresh.grade)
        if (fresh.aiTone) setAiTone(normalizeAiTone(fresh.aiTone))
        if (fresh.weeklyHours) setWeeklyHours(Number(fresh.weeklyHours) || 12)
        const map = { grade: 0, goals: 1, preferences: fresh.missing?.includes('goals') ? 1 : 2 }
        setStep(map[fresh.nextStep] ?? 0)
        if (fresh.completed) onDone?.(fresh)
      } catch {
        if (mounted) setError('Không tải được tiến độ onboarding. Kiểm tra kết nối rồi thử lại.')
      } finally {
        if (mounted) setStatusLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Khi có initialStatus từ App (đã fetch sẵn), nhảy đúng bước dở.
  useEffect(() => {
    if (!initialStatus) return
    setServerGoalsCount(initialStatus.goalsCount || 0)
    if (initialStatus.grade) setGrade(initialStatus.grade)
    if (initialStatus.aiTone) setAiTone(normalizeAiTone(initialStatus.aiTone))
    if (initialStatus.weeklyHours) setWeeklyHours(Number(initialStatus.weeklyHours) || 12)
    const map = { grade: 0, goals: 1, preferences: initialStatus.missing?.includes('goals') ? 1 : 2, done: 0 }
    setStep(map[initialStatus.nextStep] ?? 0)
  }, [initialStatus])

  // Đếm goals server (để biết đã đủ 3 chưa khi resume).
  useEffect(() => {
    let mounted = true
    fetchGoals().then(rows => {
      if (mounted) setServerGoalsCount(Array.isArray(rows) ? rows.length : 0)
    }).catch(() => { /* giữ giá trị từ status */ })
    return () => { mounted = false }
  }, [])

  // Nháp goals theo user để thoát giữa chừng vẫn còn khi vào lại.
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(userId), JSON.stringify({ goals, aiTone, weeklyHours, grade }))
    } catch { /* bỏ qua */ }
  }, [goals, aiTone, weeklyHours, grade, userId])

  function updateGoal(index, patch) {
    setGoals(old => old.map((goal, i) => (i === index ? { ...goal, ...patch } : goal)))
    setError('')
  }

  function addGoal() {
    if (goals.length >= 5) return
    setGoals(old => [...old, blankGoal(defaults)])
  }

  function removeGoal(index) {
    if (goals.length <= 3) return
    setGoals(old => old.filter((_, i) => i !== index))
  }

  function validateGrade() {
    if (!grades.includes(String(grade))) {
      setError('Hãy chọn lớp của bạn từ 6 đến 12.')
      return false
    }
    return true
  }

  function validateGoals() {
    if (serverGoalsCount >= 3) return true
    const need = Math.max(0, 3 - serverGoalsCount)
    const active = goals.slice(0, Math.max(3, need))
    if (active.length < need) {
      setError(`Hãy viết ít nhất ${need} mục tiêu cho năm học (hiện có ${serverGoalsCount} mục tiêu đã lưu).`)
      return false
    }
    for (let i = 0; i < active.length; i += 1) {
      const goal = active[i]
      if (!String(goal.title || '').trim()) { setError(`Mục tiêu ${i + 1}: hãy nhập tên mục tiêu.`); return false }
      if (String(goal.title).trim().length > 160) { setError(`Mục tiêu ${i + 1}: tên tối đa 160 ký tự.`); return false }
      if (!goal.startDate || !goal.endDate) { setError(`Mục tiêu ${i + 1}: hãy chọn ngày bắt đầu và ngày hoàn thành.`); return false }
      if (goal.startDate > goal.endDate) { setError(`Mục tiêu ${i + 1}: ngày hoàn thành phải từ ngày bắt đầu trở đi.`); return false }
      if (String(goal.targetScore ?? '').trim() !== '' && normalizeTargetScore(goal.targetScore) === null) {
        setError(`Mục tiêu ${i + 1}: điểm mong muốn phải là số từ 0 đến 10.`)
        return false
      }
    }
    return true
  }

  async function nextFromGrade() {
    if (!validateGrade()) return
    setBusy(true)
    setError('')
    try {
      const updated = await syncProfile({ grade: String(grade) })
      updateSessionProfile(updated)
      setStatus(prev => (prev ? { ...prev, grade: String(grade), missing: (prev.missing || []).filter(k => k !== 'grade') } : prev))
      setStep(1)
    } catch (failure) {
      setError(failure.friendlyMessage || failure.response?.data?.detail || 'Không lưu được lớp. Hãy thử lại.')
    } finally {
      setBusy(false)
    }
  }

  function nextFromGoals() {
    if (!validateGoals()) return
    setError('')
    setStep(2)
  }

  async function finish() {
    if (!validateGrade() || !validateGoals()) {
      setStep(!grades.includes(String(grade)) ? 0 : 1)
      return
    }
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70].includes(Number(weeklyHours))) {
      setError('Hãy chọn khả năng học từ 1 đến 70 giờ mỗi tuần.')
      setStep(3)
      return
    }
    setBusy(true)
    setError('')
    try {
      // Gửi đủ 3 mục tiêu chi tiết khi server chưa đủ; đã đủ thì backend tự bỏ qua để không nhân bản.
      const need = Math.max(0, 3 - serverGoalsCount)
      const payloadGoals = goals.slice(0, Math.max(3, need)).map(goal => ({
        title: String(goal.title || '').trim(),
        targetScore: normalizeTargetScore(goal.targetScore),
        icon: goal.icon || '🌱',
        startDate: goal.startDate,
        endDate: goal.endDate,
      }))
      const next = await completeOnboarding({ grade: String(grade), aiTone, weeklyHours: Number(weeklyHours), goals: payloadGoals })
      try { localStorage.removeItem(draftKey(userId)) } catch { /* bỏ qua */ }
      try {
        const stored = JSON.parse(localStorage.getItem('nhip-hoc-settings')) || {}
        localStorage.setItem('nhip-hoc-settings', JSON.stringify({ ...stored, aiTone, weeklyHours: Number(weeklyHours), grade: String(grade) }))
      } catch { /* bỏ qua */ }
      onDone?.(next)
    } catch (failure) {
      setError(failure.friendlyMessage || 'Không lưu được onboarding. Hãy thử lại.')
    } finally {
      setBusy(false)
    }
  }

  if (statusLoading) return <div className="auth-page"><main className="auth-card"><p role="status">Đang tải onboarding…</p></main></div>

  const needCount = Math.max(0, 3 - serverGoalsCount)
  return <div className="onboarding-page">
    <main className="onboarding-card" aria-busy={busy}>
      <p className="eyebrow">✦ LÀM QUEN VỚI NHỊP HỌC</p>
      <h1>Để Nhịp Học đồng hành đúng nhịp với bạn</h1>
      <p className="onboarding-sub">Trả lời 4 bước ngắn. Xong là vào học ngay — thoát giữa chừng thì lần sau vào lại vẫn tiếp tục từ bước dở.</p>
      <ol className="onboarding-progress" aria-label="Tiến độ onboarding">
        {STEPS.map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? '✓' : index + 1}</span>{label}</li>)}
      </ol>
      {serverGoalsCount > 0 && <p className="onboarding-saved" role="status">Đã lưu trên server: {serverGoalsCount} mục tiêu{grade ? ` · Lớp ${grade}` : ''}.</p>}
      {error && <div className="auth-message auth-error" role="alert">{error}</div>}

      {step === 0 && <section aria-label="Chọn lớp">
        <h2>Bạn đang học lớp mấy?</h2>
        <p className="card-description">Lớp lưu vào hồ sơ để gợi ý nội dung phù hợp.</p>
        <div className="onboarding-grades" role="radiogroup" aria-label="Lớp đang học">
          <p><b>THCS</b></p>
          <div>{['6', '7', '8', '9'].map(value => <button key={value} type="button" role="radio" aria-checked={String(grade) === value} className={String(grade) === value ? 'selected' : ''} onClick={() => { setGrade(value); setError('') }}>Lớp {value}</button>)}</div>
          <p><b>THPT</b></p>
          <div>{['10', '11', '12'].map(value => <button key={value} type="button" role="radio" aria-checked={String(grade) === value} className={String(grade) === value ? 'selected' : ''} onClick={() => { setGrade(value); setError('') }}>Lớp {value}</button>)}</div>
        </div>
        <div className="composer-actions">
          <button className="primary-button" disabled={busy} onClick={nextFromGrade}>{busy ? 'Đang lưu…' : 'Tiếp tục →'}</button>
        </div>
      </section>}

      {step === 1 && <section aria-label="Mục tiêu năm học">
        <h2>Viết ít nhất 3 mục tiêu cho năm học</h2>
        <p className="card-description">
          {serverGoalsCount >= 3
            ? `Bạn đã có ${serverGoalsCount} mục tiêu trên server — có thể xem lại rồi bấm Tiếp tục.`
            : `Mỗi mục tiêu gồm tên, điểm mong muốn, biểu tượng và thời gian. Còn thiếu ${needCount} mục tiêu.`}
        </p>
        {goals.slice(0, Math.max(3, needCount)).map((goal, index) => <fieldset key={index} className="onboarding-goal">
          <legend>Mục tiêu {index + 1}</legend>
          <label>Tên mục tiêu<input value={goal.title} maxLength={160} onChange={event => updateGoal(index, { title: event.target.value })} placeholder="Ví dụ: Đạt 8.5 môn Toán học kỳ 1" /></label>
          <div className="onboarding-grid">
            <label>Điểm mong muốn<input value={goal.targetScore} type="number" min="0" max="10" step="0.1" onChange={event => updateGoal(index, { targetScore: event.target.value })} placeholder="VD: 8.5" /></label>
            <label>Biểu tượng<select value={goal.icon} onChange={event => updateGoal(index, { icon: event.target.value })}>{GOAL_ICONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}</select></label>
          </div>
          <div className="onboarding-grid">
            <label>Ngày bắt đầu<input value={goal.startDate} type="date" onChange={event => updateGoal(index, { startDate: event.target.value })} /></label>
            <label>Ngày hoàn thành<input value={goal.endDate} type="date" min={goal.startDate} onChange={event => updateGoal(index, { endDate: event.target.value })} /></label>
          </div>
          {goals.length > 3 && <button type="button" className="delete-button" onClick={() => removeGoal(index)}>Xóa mục tiêu này</button>}
        </fieldset>)}
        {goals.length < 5 && serverGoalsCount < 3 && <button type="button" className="ghost-button" onClick={addGoal}>＋ Thêm mục tiêu</button>}
        <div className="composer-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(0)}>← Lớp</button>
          <button className="primary-button" disabled={busy} onClick={nextFromGoals}>Tiếp tục →</button>
        </div>
      </section>}

      {step === 2 && <section aria-label="Cách AI nói chuyện">
        <h2>Bạn thích AI nói chuyện kiểu nào?</h2>
        <p className="card-description">Lưu vào giọng AI để trợ lý học tập trò chuyện hợp với bạn.</p>
        <div className="tone-options" role="radiogroup" aria-label="Chất giọng AI">
          {Object.entries(AI_TONES).map(([key, [label, emoji, desc]]) => <button key={key} type="button" role="radio" aria-checked={aiTone === key} className={aiTone === key ? 'selected' : ''} onClick={() => { setAiTone(key); setError('') }}><span aria-hidden="true">{emoji}</span><p><b>{label}</b><small>{desc}</small></p><i aria-hidden="true">{aiTone === key ? '✓' : ''}</i></button>)}
        </div>
        <div className="composer-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(1)}>← Mục tiêu</button>
          <button className="primary-button" disabled={busy} onClick={() => setStep(3)}>Tiếp tục →</button>
        </div>
      </section>}

      {step === 3 && <section aria-label="Khả năng học mỗi tuần">
        <h2>Mỗi tuần bạn học được khoảng bao nhiêu tiếng?</h2>
        <p className="card-description">Lưu vào mục tiêu tuần để gợi ý lịch vừa sức. Có thể đổi lại trong Cài đặt.</p>
        <label className="onboarding-hours">Số giờ mỗi tuần: <b>{weeklyHours} giờ</b><input type="range" min="1" max="70" value={weeklyHours} onChange={event => setWeeklyHours(Number(event.target.value))} aria-label="Số giờ học mỗi tuần" /></label>
        <label>Hoặc chọn nhanh<select value={weeklyHours} onChange={event => setWeeklyHours(Number(event.target.value))} aria-label="Chọn nhanh số giờ mỗi tuần">{Array.from({ length: 70 }, (_, i) => i + 1).map(value => <option key={value} value={value}>{value} giờ / tuần</option>)}</select></label>
        <div className="onboarding-review">
          <p><b>Xem lại:</b> Lớp {grade || '—'} · {serverGoalsCount >= 3 ? `${serverGoalsCount} mục tiêu đã lưu` : `${Math.max(3, needCount)} mục tiêu mới`} · {AI_TONES[aiTone]?.[0]} · {weeklyHours} giờ/tuần</p>
        </div>
        <div className="composer-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={() => setStep(2)}>← Giọng AI</button>
          <button className="primary-button" disabled={busy} onClick={finish}>{busy ? 'Đang lưu…' : 'Hoàn thành 🎉'}</button>
        </div>
      </section>}

      <button type="button" className="auth-password-toggle" disabled={busy} onClick={onLogout}>Đăng xuất</button>
    </main>
  </div>
}
