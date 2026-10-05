import { useState } from 'react'
import { PageIntro, ProgressBar, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import EmojiPicker from '../components/EmojiPicker'
import useGoals from '../data/useGoals'
import { createGoal, deleteGoal, GOAL_STATUS_LABEL, patchGoal, updateGoal } from '../backendApi'

function formatDate(value) {
  if (!value) return 'Chưa chọn ngày'
  const date = new Date(value + 'T00:00:00')
  return Number.isNaN(date.getTime()) ? 'Chưa chọn ngày' : new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

const normalizeProgress = value => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, Math.round(num)))
}

const normalizeTargetScore = value => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10))
}

export default function GoalsPage({ onNavigate }) {
  const {
    loggedIn, loadingGoals, goals: storedGoals,
    serverRows, setServerRows, setLocalGoals, localError, syncError, setSyncError,
  } = useGoals()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [icon, setIcon] = useState('🌱')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function openCreate() {
    setEditing(null)
    setIcon('🌱')
    setError('')
    setShowModal(true)
  }

  function openEdit(goal) {
    setEditing(goal)
    setIcon(goal?.icon || '🌱')
    setError('')
    setShowModal(true)
  }

  async function saveGoal(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') || '').trim()
    const startDate = String(data.get('startDate') || '')
    const endDate = String(data.get('date') || '')
    const pickedIcon = String(data.get('emoji') || '').trim() || '🌱'
    const targetScore = normalizeTargetScore(data.get('targetScore'))
    if (!title) { setError('Hãy nhập tên mục tiêu.'); return }
    if (title.length > 160) { setError('Tên mục tiêu tối đa 160 ký tự.'); return }
    if ([...pickedIcon].length > 16) { setError('Biểu tượng tối đa 16 ký tự.'); return }
    if (!startDate || !endDate) { setError('Hãy chọn ngày bắt đầu và ngày hoàn thành.'); return }
    if (startDate > endDate) { setError('Ngày hoàn thành phải từ ngày bắt đầu trở đi.'); return }
    if (String(data.get('targetScore') || '').trim() !== '' && targetScore === null) { setError('Điểm mong muốn phải là số từ 0 đến 10.'); return }

    const uiInput = {
      title,
      startDate,
      date: endDate,
      icon: pickedIcon,
      targetScore,
      status: editing?.status || 'in_progress',
      progress: editing?.progress ?? 0,
    }

    setSaving(true)
    try {
      if (loggedIn) {
        if (serverRows === null) { setError('Đang tải mục tiêu từ server, thử lại sau giây lát.'); return }
        if (editing) {
          const snapshot = serverRows
          setServerRows(rows => (rows || []).map(row => row.id === editing.id ? {
            ...row, title, target_score: targetScore, icon: pickedIcon, start_date: startDate, end_date: endDate,
          } : row))
          setSyncError(''); setShowModal(false); setEditing(null); setError('')
          try {
            const updated = await updateGoal(editing.id, uiInput)
            setServerRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
          } catch (failure) {
            setServerRows(snapshot)
            setSyncError(failure.friendlyMessage || 'Không sửa được mục tiêu trên server. Đã hoàn tác.')
          }
        } else {
          const tempId = 'temp-' + Date.now()
          const optimisticRow = {
            id: tempId, user_id: 'local', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            title, target_score: targetScore, icon: pickedIcon, start_date: startDate, end_date: endDate,
            status: 'in_progress', progress: 0,
          }
          setServerRows(rows => [...(rows || []), optimisticRow])
          setSyncError(''); setShowModal(false); setError('')
          try {
            const created = await createGoal(uiInput)
            setServerRows(rows => (rows || []).map(row => row.id === tempId ? created : row))
          } catch (failure) {
            setServerRows(rows => (rows || []).filter(row => row.id !== tempId))
            setSyncError(failure.friendlyMessage || 'Không lưu được mục tiêu lên server. Đã hoàn tác.')
          }
        }
      } else {
        const list = Array.isArray(storedGoals) ? storedGoals : []
        if (editing) {
          const next = list.map(goal => goal.id === editing.id ? {
            ...goal, title, startDate, date: endDate, icon: pickedIcon, targetScore, progress: normalizeProgress(goal.progress),
          } : goal)
          if (setLocalGoals(next)) { setShowModal(false); setEditing(null); setError('') }
        } else {
          const next = [...list, {
            id: crypto.randomUUID(), title, startDate, date: endDate, icon: pickedIcon, targetScore, progress: 0, status: 'in_progress',
          }]
          if (setLocalGoals(next)) { setShowModal(false); setError('') }
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function removeGoal(id) {
    if (!id) return
    if (loggedIn && serverRows) {
      if (String(id).startsWith('temp-')) {
        setServerRows(rows => (rows || []).filter(row => row.id !== id))
        return
      }
      const snapshot = serverRows
      setServerRows(rows => (rows || []).filter(row => row.id !== id))
      try { await deleteGoal(id) }
      catch (failure) { setServerRows(snapshot); setSyncError(failure.friendlyMessage || 'Không xóa được mục tiêu trên server.') }
      return
    }
    try {
      const next = (Array.isArray(storedGoals) ? storedGoals : []).filter(goal => goal.id !== id)
      setLocalGoals(next)
      setError('')
    } catch { setError('Chưa xóa được mục tiêu. Hãy thử lại.') }
  }

  async function toggleGoalStatus(goal) {
    if (!goal?.id) return
    const nextStatus = goal.status === 'completed' ? 'in_progress' : 'completed'
    const nextProgress = nextStatus === 'completed' ? 100 : (normalizeProgress(goal.progress) === 100 ? 0 : normalizeProgress(goal.progress))
    if (loggedIn && serverRows) {
      if (String(goal.id).startsWith('temp-')) {
        setServerRows(rows => (rows || []).map(row => row.id === goal.id ? { ...row, status: nextStatus, progress: nextProgress } : row))
        return
      }
      const snapshot = serverRows
      setServerRows(rows => (rows || []).map(row => row.id === goal.id ? { ...row, status: nextStatus, progress: nextProgress } : row))
      setSyncError('')
      try {
        const updated = await patchGoal(goal.id, { status: nextStatus, progress: nextProgress })
        setServerRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
      } catch (failure) {
        setServerRows(snapshot)
        setSyncError(failure.friendlyMessage || 'Không đổi được trạng thái mục tiêu trên server. Đã hoàn tác.')
      }
      return
    }
    setLocalGoals((Array.isArray(storedGoals) ? storedGoals : []).map(item => item.id === goal.id ? {
      ...item, status: nextStatus, progress: nextProgress, ...(nextStatus === 'completed' ? { completedAt: item.date } : { completedAt: undefined }),
    } : item))
  }

  const goals = (storedGoals || []).map((goal) => {
    const completed = goal.status === 'completed'
    const progress = completed ? 100 : normalizeProgress(goal.progress)
    return {
      ...goal,
      tone: 'mint',
      icon: goal.icon || '🌱',
      progress,
      subject: goal.targetScore ?? goal.target_score ? `Điểm mong muốn: ${goal.targetScore ?? goal.target_score}` : 'Mục tiêu cá nhân',
      note: completed ? 'Bạn đã làm được! Hãy dành một chút thời gian tự hào về mình.' : 'Mỗi bước nhỏ đều đưa bạn đến gần hơn.',
    }
  })
  const average = goals.length ? Math.round(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length) : 0
  const nextGoal = [...goals].sort((a, b) => b.progress - a.progress)[0]
  const syncStatus = !loggedIn
    ? 'Chưa đăng nhập — mục tiêu chỉ lưu trên trình duyệt này.'
    : loadingGoals
      ? 'Đang đồng bộ mục tiêu với server…'
      : syncError
        ? syncError
        : serverRows
          ? `Đã lưu mục tiêu lên server ✓ (${serverRows.length} mục tiêu)`
          : ''

  return (
    <>
      <PageIntro eyebrow="TỪNG BƯỚC TIẾN BỘ" title="Mục tiêu của bạn" subtitle="Từ một chương cần hiểu đến kỳ thi sắp tới. Chọn mục tiêu vừa sức với bạn.">
        <button className="primary-button" onClick={openCreate}>＋ Thêm mục tiêu</button>
      </PageIntro>
      {syncStatus && <p className="repeat-hint" role="status">{syncStatus}</p>}
      <section className="goals-hero">
        <div className="goals-hero-copy"><span className="goals-kicker">MỖI BƯỚC NHỎ ĐỀU ĐÁNG GHI NHẬN</span><h2>Không cần nhanh.<br /><em>Chỉ cần tiếp tục.</em></h2><p>{nextGoal ? nextGoal.note : 'Chọn một mục tiêu nhỏ để bắt đầu hành trình của bạn.'}</p><button className="outline-button" onClick={() => onNavigate('schedule')}>Bắt đầu một bước nhỏ →</button></div>
        <div className="goals-overview"><div className="goals-ring" style={{ '--goal-progress': `${average * 3.6}deg` }}><strong>{average}%</strong><span>tiến độ chung</span></div><div className="goals-overview-copy"><b>{goals.length} mục tiêu</b><span>đang được bạn vun đắp</span><small>✨ Tiến bộ nhỏ vẫn là tiến bộ</small></div></div>
      </section>
      <div className="goals-heading"><div><h2>Những điều bạn đang hướng tới</h2><p>Đích đến để truyền cảm hứng, không phải áp lực.</p></div><span className="goals-count">{goals.length} mục tiêu</span></div>
      {localError ? <p role="alert">{localError}</p> : loadingGoals ? <p role="status">Đang tải mục tiêu…</p> : goals.length === 0 && <SectionCard><h2>Gieo mục tiêu đầu tiên của bạn 🌱</h2><p>Bạn muốn tự tin hơn ở điều gì? Hãy bắt đầu từ đó.</p><button className="primary-button" onClick={openCreate}>Thiết lập mục tiêu</button></SectionCard>}
      <div className="goals-grid">{goals.map((goal) => <SectionCard className={'goal-card ' + goal.tone} key={goal.id}><div className="goal-card-top"><span className="goal-icon">{goal.icon}</span><span className="goal-subject">{goal.subject}</span></div><h3>{goal.title}</h3><p><small>{GOAL_STATUS_LABEL[goal.status] || 'Đang thực hiện'}</small></p>{goal.startDate && <p>Bắt đầu dự kiến: {formatDate(goal.startDate)}</p>}<div className="goal-date"><span>🏁</span><div><small>{goal.status === 'completed' ? 'Ngày đã hoàn thành' : 'Ngày hoàn thành dự kiến'}</small><b>{formatDate(goal.completedAt || goal.date)}</b></div></div><div className="goal-progress-label"><span>Tiến độ hiện tại</span><strong>{goal.progress}%</strong></div><div role="progressbar" aria-label={goal.title} aria-valuenow={goal.progress} aria-valuemin={0} aria-valuemax={100}><ProgressBar value={goal.progress} tone={goal.tone} /></div><p className="goal-note">{goal.note}</p><div className="composer-actions"><button className="ghost-button" onClick={() => openEdit(goal)}>Sửa</button><button className="outline-button" onClick={() => toggleGoalStatus(goal)}>{goal.status === 'completed' ? 'Mở lại' : 'Hoàn thành ✓'}</button></div><button className="delete-button" aria-label={'Xóa mục tiêu ' + goal.title} onClick={() => removeGoal(goal.id)}>Xóa mục tiêu</button><button className="goal-action" onClick={() => { try { localStorage.setItem('nhip-hoc-roadmap-prefill-goal', goal.id) } catch { /* bỏ qua */ } onNavigate('roadmap') }}>Xem hành trình <span>→</span></button></SectionCard>)}</div>
      <section className="goals-encouragement"><span>✦</span><div><b>Một lời nhắc cho hôm nay</b><p>Chọn một việc chỉ mất 10 phút. Bạn không cần hoàn thành cả hành trình trong một ngày.</p></div><span>🌤️</span></section>
      {error && <p role="alert">{error}</p>}
      {showModal && <Modal title={editing ? 'Sửa mục tiêu' : 'Thêm mục tiêu'} onClose={() => { setShowModal(false); setEditing(null) }}><form onSubmit={saveGoal}><label>Tên mục tiêu<input autoFocus name="title" required maxLength={160} defaultValue={editing?.title || ''} placeholder="Ví dụ: Học 100 từ vựng" /></label><label>Điểm mong muốn (không bắt buộc)<input name="targetScore" type="number" min="0" max="10" step="0.1" defaultValue={editing?.targetScore ?? editing?.target_score ?? ''} /></label><EmojiPicker value={icon} onChange={setIcon} /><label>Ngày bắt đầu dự kiến<input name="startDate" type="date" required defaultValue={editing?.startDate || ''} /></label><label>Ngày hoàn thành dự kiến<input name="date" type="date" required defaultValue={editing?.date || editing?.endDate || ''} /></label><p>Chọn ngày hoàn thành phù hợp với lịch học của bạn.</p>{error && <p role="alert">{error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => { setShowModal(false); setEditing(null) }}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu mục tiêu'}</button></div></form></Modal>}
    </>
  )
}
