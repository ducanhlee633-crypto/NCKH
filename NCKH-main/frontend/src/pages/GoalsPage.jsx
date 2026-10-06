import { useState } from 'react'
import { PageIntro, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import EmojiPicker from '../components/EmojiPicker'
import useGoals from '../data/useGoals'
import { createGoal, deleteGoal, GOAL_STATUS_LABEL, patchGoal, updateGoal } from '../backendApi'

function formatDate(value) {
  if (!value) return 'Chưa chọn ngày'
  const date = new Date(value + 'T00:00:00')
  return Number.isNaN(date.getTime()) ? 'Chưa chọn ngày' : new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatShortDate(value) {
  if (!value) return '—'
  const date = new Date(value + 'T00:00:00')
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function getDaysLeft(endDate, status) {
  if (status === 'completed' || !endDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(endDate + 'T00:00:00')
  if (Number.isNaN(end.getTime())) return null
  return Math.round((end - today) / 86400000)
}

function formatTargetScore(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : '—'
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
            status: 'in_progress',
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
            ...goal, title, startDate, date: endDate, icon: pickedIcon, targetScore,
          } : goal)
          if (setLocalGoals(next)) { setShowModal(false); setEditing(null); setError('') }
        } else {
          const next = [...list, {
            id: crypto.randomUUID(), title, startDate, date: endDate, icon: pickedIcon, targetScore, status: 'in_progress',
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
    if (loggedIn && serverRows) {
      if (String(goal.id).startsWith('temp-')) {
        setServerRows(rows => (rows || []).map(row => row.id === goal.id ? { ...row, status: nextStatus } : row))
        return
      }
      const snapshot = serverRows
      setServerRows(rows => (rows || []).map(row => row.id === goal.id ? { ...row, status: nextStatus } : row))
      setSyncError('')
      try {
        const updated = await patchGoal(goal.id, { status: nextStatus })
        setServerRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
      } catch (failure) {
        setServerRows(snapshot)
        setSyncError(failure.friendlyMessage || 'Không đổi được trạng thái mục tiêu trên server. Đã hoàn tác.')
      }
      return
    }
    setLocalGoals((Array.isArray(storedGoals) ? storedGoals : []).map(item => item.id === goal.id ? {
      ...item, status: nextStatus, ...(nextStatus === 'completed' ? { completedAt: item.date } : { completedAt: undefined }),
    } : item))
  }

  const goals = (storedGoals || []).map((goal) => {
    const completed = goal.status === 'completed'
    const targetScore = goal.targetScore ?? goal.target_score ?? null
    const daysLeft = getDaysLeft(goal.date || goal.endDate, goal.status)
    return {
      ...goal,
      status: completed ? 'completed' : 'in_progress',
      icon: goal.icon || '🌱',
      targetScore,
      hasTargetScore: targetScore !== null && targetScore !== '' && Number.isFinite(Number(targetScore)),
      daysLeft,
      deadlineHint: completed
        ? 'Đã hoàn thành'
        : daysLeft === null ? formatDate(goal.date || goal.endDate)
        : daysLeft < 0 ? `Quá hạn ${Math.abs(daysLeft)} ngày`
        : daysLeft === 0 ? 'Đến hạn hôm nay'
        : `Còn ${daysLeft} ngày`,
    }
  })
  const totalCount = goals.length
  const doingCount = goals.filter(goal => goal.status !== 'completed').length
  const doneCount = goals.filter(goal => goal.status === 'completed').length
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
        <div className="goals-hero-copy"><span className="goals-kicker">MỖI BƯỚC NHỎ ĐỀU ĐÁNG GHI NHẬN</span><h2>Không cần nhanh.<br /><em>Chỉ cần tiếp tục.</em></h2><p>Đặt mục tiêu rõ ràng về điểm số và thời hạn, rồi để lộ trình học dẫn đường cho bạn.</p><button className="outline-button" onClick={() => onNavigate('schedule')}>Bắt đầu một bước nhỏ →</button></div>
        <div className="goals-overview goals-stats" aria-label="Tổng quan mục tiêu">
          <div className="goals-stat"><b>{totalCount}</b><span>Tổng mục tiêu</span></div>
          <div className="goals-stat is-doing"><b>{doingCount}</b><span>Đang thực hiện</span></div>
          <div className="goals-stat is-done"><b>{doneCount}</b><span>Đã hoàn thành</span></div>
        </div>
      </section>
      <div className="goals-heading"><div><h2>Những điều bạn đang hướng tới</h2><p>Đích đến để truyền cảm hứng, không phải áp lực.</p></div><span className="goals-count">{goals.length} mục tiêu</span></div>
      {localError ? <p role="alert">{localError}</p> : loadingGoals ? <p role="status">Đang tải mục tiêu…</p> : goals.length === 0 && <SectionCard><h2>Gieo mục tiêu đầu tiên của bạn 🌱</h2><p>Bạn muốn tự tin hơn ở điều gì? Hãy bắt đầu từ đó.</p><button className="primary-button" onClick={openCreate}>Thiết lập mục tiêu</button></SectionCard>}
      <div className="goals-grid">{goals.map((goal) => {
        const completed = goal.status === 'completed'
        return (
          <SectionCard className={'goal-card' + (completed ? ' is-completed' : '')} key={goal.id}>
            <div className="goal-card-top">
              <span className="goal-icon" aria-hidden="true">{goal.icon}</span>
              <span className={'goal-status ' + (completed ? 'is-done' : 'is-doing')}>
                {completed ? '✓ ' : ''}{GOAL_STATUS_LABEL[goal.status] || 'Đang thực hiện'}
              </span>
            </div>
            <h3>{goal.title}</h3>
            <dl className="goal-meta">
              <div>
                <dt>Bắt đầu</dt>
                <dd>{formatShortDate(goal.startDate)}</dd>
              </div>
              <div>
                <dt>{completed ? 'Đã hoàn thành' : 'Hoàn thành dự kiến'}</dt>
                <dd>{formatShortDate(goal.completedAt || goal.date || goal.endDate)}</dd>
              </div>
              <div>
                <dt>Điểm mong muốn</dt>
                <dd>{goal.hasTargetScore ? `${formatTargetScore(goal.targetScore)} / 10` : '—'}</dd>
              </div>
              <div>
                <dt>Thời hạn</dt>
                <dd className={goal.daysLeft !== null && goal.daysLeft < 0 && !completed ? 'is-overdue' : ''}>{goal.deadlineHint}</dd>
              </div>
            </dl>
            <div className="goal-foot">
              <div className="goal-actions">
                <button className="ghost-button" onClick={() => openEdit(goal)}>Sửa</button>
                <button className="outline-button" onClick={() => toggleGoalStatus(goal)}>{completed ? 'Mở lại' : 'Hoàn thành ✓'}</button>
              </div>
              <button className="goal-action" onClick={() => { try { localStorage.setItem('nhip-hoc-roadmap-prefill-goal', goal.id) } catch { /* bỏ qua */ } onNavigate('roadmap') }}>Xem hành trình <span>→</span></button>
              <button className="goal-delete" aria-label={'Xóa mục tiêu ' + goal.title} onClick={() => removeGoal(goal.id)}>Xóa mục tiêu</button>
            </div>
          </SectionCard>
        )
      })}</div>
      <section className="goals-encouragement"><span>✦</span><div><b>Một lời nhắc cho hôm nay</b><p>Chọn một việc chỉ mất 10 phút. Bạn không cần hoàn thành cả hành trình trong một ngày.</p></div><span>🌤️</span></section>
      {error && <p role="alert">{error}</p>}
      {showModal && <Modal title={editing ? 'Sửa mục tiêu' : 'Thêm mục tiêu'} onClose={() => { setShowModal(false); setEditing(null) }}><form onSubmit={saveGoal}><label>Tên mục tiêu<input autoFocus name="title" required maxLength={160} defaultValue={editing?.title || ''} placeholder="Ví dụ: Học 100 từ vựng" /></label><label>Điểm mong muốn (không bắt buộc)<input name="targetScore" type="number" min="0" max="10" step="0.1" defaultValue={editing?.targetScore ?? editing?.target_score ?? ''} /></label><EmojiPicker value={icon} onChange={setIcon} /><label>Ngày bắt đầu dự kiến<input name="startDate" type="date" required defaultValue={editing?.startDate || ''} /></label><label>Ngày hoàn thành dự kiến<input name="date" type="date" required defaultValue={editing?.date || editing?.endDate || ''} /></label><p>Chọn ngày hoàn thành phù hợp với lịch học của bạn.</p>{error && <p role="alert">{error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => { setShowModal(false); setEditing(null) }}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu mục tiêu'}</button></div></form></Modal>}
    </>
  )
}
