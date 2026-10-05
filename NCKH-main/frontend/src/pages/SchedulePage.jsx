import { useState } from 'react'
import { CardHeader, PageIntro, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import useScheduleBlocks from '../data/useScheduleBlocks'
import useDeadlines from '../data/useDeadlines'
import useRoadmaps from '../data/useRoadmaps'
import { SCHOOL_SUBJECTS, defaultSubjects } from '../data/subjects'
import { calendarEvents, layoutEvents, minutes } from '../data/calendar'
import { createDeadline, createScheduleBlock, deleteDeadline, deleteScheduleBlock, updateDeadline, updateScheduleBlock } from '../backendApi'
import { defaultRepeatUntil, draftToCreatePayload, expandRepeatDates, keyOf, parseKey, repeatOptions, repeatSummary, shortDateLabel, weekdayOptions } from '../data/scheduleRepeat'

const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const palette = ['mint', 'pink', 'cyan', 'yellow', 'orange', 'blue']
const viewOptions = [['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng'], ['year', 'Năm']]

const PRIORITY_OPTIONS = [['high', 'Cao'], ['medium', 'Trung bình'], ['low', 'Thấp']]
const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS)
const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 }

const deadlineTime = item => String(item?.time || item?.due_time || item?.end || item?.start || '23:59').slice(0, 5)
const deadlineDate = item => item?.date || item?.due_date || ''
const deadlinePriority = item => (item?.priority === 'high' || item?.priority === 'low' ? item.priority : 'medium')
const deadlineStatus = item => !!item?.status
const deadlineDateTime = item => deadlineDate(item) + 'T' + deadlineTime(item)
const formatDay = key => (key || '').split('-').reverse().join('/')

const startOfWeek = date => { const copy = new Date(date); copy.setDate(copy.getDate() - (copy.getDay() + 6) % 7); copy.setHours(0, 0, 0, 0); return copy }
const fullDateLabel = date => date.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function groupDeadlinesByDate(deadlines) {
  const map = {}
  for (const item of deadlines || []) {
    const day = deadlineDate(item)
    if (!day) continue
    map[day] = [...(map[day] || []), item]
  }
  Object.values(map).forEach(items => items.sort((a, b) => {
    const doneCmp = Number(deadlineStatus(a)) - Number(deadlineStatus(b))
    if (doneCmp !== 0) return doneCmp
    const timeCmp = deadlineTime(a).localeCompare(deadlineTime(b))
    if (timeCmp !== 0) return timeCmp
    return (PRIORITY_WEIGHT[deadlinePriority(a)] ?? 1) - (PRIORITY_WEIGHT[deadlinePriority(b)] ?? 1)
  }))
  return map
}

function EventPill({ event, onRemove, onOpen }) {
  const repeated = Boolean(event.repeatId && event.repeat && event.repeat !== 'none')
  return (
    <div
      className={'event-pill ' + event.tone + (onOpen ? ' clickable' : '')}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      title={event.title + ' ' + event.start + '–' + event.end + (repeated ? ' • ' + repeatSummary(event) : '')}
      onClick={onOpen ? e => { e.stopPropagation(); onOpen() } : undefined}
      onKeyDown={onOpen ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } : undefined}
    >
      <b>{repeated ? '🔁 ' : ''}{event.title}</b>
      <span>{event.start}–{event.end}</span>
      {onRemove && <button className="event-remove" aria-label={'Xóa ' + event.title} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>}
    </div>
  )
}

function DeadlineStripItem({ item, onOpen, onRemove, onToggle }) {
  const priority = deadlinePriority(item)
  const done = deadlineStatus(item)
  return (
    <div className={'deadline-strip-item priority-' + priority + (done ? ' is-done' : '')}>
      <button
        type="button"
        className="deadline-toggle"
        aria-label={(done ? 'Mở lại hạn nộp ' : 'Hoàn thành hạn nộp ') + item.title}
        aria-pressed={done}
        title={done ? 'Mở lại' : 'Hoàn thành'}
        onClick={e => { e.stopPropagation(); onToggle?.(item.id) }}
      >
        {done ? '✓' : ''}
      </button>
      <button
        type="button"
        className="deadline-strip-main"
        onClick={e => { e.stopPropagation(); onOpen?.(item) }}
        title={item.title + ' • Hạn ' + deadlineTime(item) + ' • ' + (PRIORITY_LABEL[priority] || priority) + (done ? ' • Đã hoàn thành' : '')}
      >
        <i className="priority-dot" aria-hidden="true" />
        <b>{item.title}</b>
        <span>{deadlineTime(item)}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="deadline-strip-remove"
          aria-label={'Xóa hạn nộp ' + item.title}
          onClick={e => { e.stopPropagation(); onRemove(item.id) }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function DeadlineDayHead({ items, onOpen, onRemove, onToggle }) {
  if (!items?.length) return null
  return (
    <div className="day-deadlines" onClick={e => e.stopPropagation()}>
      <div className="day-deadlines-title">⚑ Deadline</div>
      {items.map(item => (
        <DeadlineStripItem key={item.id} item={item} onOpen={onOpen} onRemove={onRemove} onToggle={onToggle} />
      ))}
    </div>
  )
}

export default function SchedulePage() {
  // Lộ trình hiển thị trong lịch: login -> server, chưa login -> local cũ.
  const { roadmaps } = useRoadmaps()
  const [view, setView] = useState('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [composer, setComposer] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [detailEvent, setDetailEvent] = useState(null)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ title: '', date: keyOf(anchor), start: '14:00', end: '15:30', tone: 'blue', repeat: 'none', repeatDays: [], repeatUntil: '' })
  const [error, setError] = useState('')

  // Deadline: đã đăng nhập -> server, chưa đăng nhập -> local (migrate 1 lần).
  const {
    deadlines, serverRows: deadlineRows, setServerRows: setDeadlineRows,
    setLocalDeadlines, localError: deadlineLocalError,
    loadingDeadlines, syncError: deadlineSyncError, setSyncError: setDeadlineSyncError,
  } = useDeadlines()
  const [deadlineComposer, setDeadlineComposer] = useState(false)
  const [deadlineDraft, setDeadlineDraft] = useState({ id: null, title: '', date: keyOf(new Date()), time: '23:59', priority: 'medium', status: false })
  const [deadlineFormError, setDeadlineFormError] = useState('')
  const [deadlineDetail, setDeadlineDetail] = useState(null)
  const [deadlineSaving, setDeadlineSaving] = useState(false)

  // Nguồn sự thật duy nhất cho BLOCK lịch học: đã đăng nhập -> server, chưa đăng nhập -> local.
  const { loggedIn, loadingSchedule, serverRows, setServerRows, localEventMap, setLocalEventMap, localError, eventMap, syncError, setSyncError } = useScheduleBlocks()

  // calendarMap chỉ chứa block học + roadmap. Deadline hiển thị riêng trên đầu ngày.
  const calendarMap = calendarEvents(eventMap, roadmaps, [])
  const deadlineMap = groupDeadlinesByDate(deadlines)
  const sortedDeadlines = [...(deadlines || [])].sort((a, b) => (Number(deadlineStatus(a)) - Number(deadlineStatus(b))) || deadlineDateTime(a).localeCompare(deadlineDateTime(b)))
  const upcoming = sortedDeadlines.filter(item => !deadlineStatus(item) && new Date(deadlineDateTime(item)) >= new Date())
  const doneCount = (deadlines || []).filter(deadlineStatus).length
  const sessions = Object.values(calendarMap).flat()
  const totalHours = sessions.reduce((sum, item) => sum + Math.max(0, minutes(item.end) - minutes(item.start)) / 60, 0)
  const weekEnd = startOfWeek(anchor); weekEnd.setDate(weekEnd.getDate() + 6)
  const visibleTitle = view === 'year' ? String(anchor.getFullYear()) : view === 'day' ? fullDateLabel(anchor) : view === 'week' ? fullDateLabel(startOfWeek(anchor)) + ' – ' + fullDateLabel(weekEnd) : anchor.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })

  function freshDraft(date = anchor, hour = '14:00') {
    const endMinutes = Math.min(minutes(hour) + 90, 1439)
    const dateKey = keyOf(date instanceof Date ? date : new Date(date + 'T00:00:00'))
    const dow = parseKey(dateKey).getDay()
    return { title: '', date: dateKey, start: hour, end: String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0'), tone: 'blue', repeat: 'none', repeatDays: [dow], repeatUntil: defaultRepeatUntil(dateKey) }
  }

  function openComposer(date = anchor, hour = '14:00') {
    const base = date instanceof Date ? date : new Date(date + 'T00:00:00')
    setDraft(freshDraft(base, hour))
    setError('')
    setComposer(true)
  }

  function openDeadlineComposer(date = anchor, existing = null) {
    const base = date instanceof Date ? date : (typeof date === 'string' ? new Date(date + 'T00:00:00') : anchor)
    if (existing) {
      setDeadlineDraft({ id: existing.id, title: existing.title || '', date: deadlineDate(existing), time: deadlineTime(existing), priority: deadlinePriority(existing), status: deadlineStatus(existing) })
    } else {
      setDeadlineDraft({ id: null, title: '', date: keyOf(base instanceof Date ? base : new Date()), time: '23:59', priority: 'medium', status: false })
    }
    setDeadlineFormError('')
    setDeadlineComposer(true)
  }

  async function saveDeadline() {
    const title = (deadlineDraft.title || '').trim()
    if (!title || !deadlineDraft.date || !deadlineDraft.time) { setDeadlineFormError('Hãy điền tên, ngày và giờ nộp.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDraft.date)) { setDeadlineFormError('Ngày nộp chưa hợp lệ.'); return }
    if (!/^\d{2}:\d{2}$/.test(deadlineDraft.time)) { setDeadlineFormError('Giờ nộp chưa hợp lệ.'); return }
    if (title.length > 160) { setDeadlineFormError('Tên deadline tối đa 160 ký tự.'); return }
    const priority = deadlinePriority(deadlineDraft)
    const status = !!deadlineDraft.status
    const payload = { title, due_date: deadlineDraft.date, due_time: deadlineDraft.time, priority, status }
    setDeadlineSaving(true)
    try {
      if (loggedIn) {
        if (deadlineRows === null) { setDeadlineFormError('Đang tải hạn nộp từ server, thử lại sau giây lát.'); return }
        if (deadlineDraft.id) {
          const snapshot = deadlineRows
          const optimistic = snapshot.map(row => row.id === deadlineDraft.id ? { ...row, ...payload } : row)
          setDeadlineRows(optimistic)
          setDeadlineSyncError(''); setDeadlineComposer(false); setDeadlineDetail(null)
          setAnchor(new Date(deadlineDraft.date + 'T00:00:00'))
          try {
            const updated = await updateDeadline(deadlineDraft.id, payload)
            setDeadlineRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
          } catch (failure) {
            setDeadlineRows(snapshot)
            setDeadlineSyncError(failure.friendlyMessage || 'Không sửa được hạn nộp trên server. Đã hoàn tác.')
          }
        } else {
          const tempId = 'temp-' + Date.now()
          const optimisticRow = { id: tempId, user_id: 'local', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload }
          setDeadlineRows(rows => [...(rows || []), optimisticRow])
          setDeadlineSyncError(''); setDeadlineComposer(false); setDeadlineDetail(null)
          setAnchor(new Date(deadlineDraft.date + 'T00:00:00'))
          try {
            const created = await createDeadline(payload)
            setDeadlineRows(rows => (rows || []).map(row => row.id === tempId ? created : row))
          } catch (failure) {
            setDeadlineRows(rows => (rows || []).filter(row => row.id !== tempId))
            setDeadlineSyncError(failure.friendlyMessage || 'Không lưu được hạn nộp lên server. Đã hoàn tác.')
          }
        }
      } else {
        const nextItem = {
          id: deadlineDraft.id || crypto.randomUUID(),
          title,
          date: deadlineDraft.date,
          time: deadlineDraft.time,
          // Giữ `end` để Dashboard cũ vẫn đọc được (tương thích ngược).
          end: deadlineDraft.time,
          priority,
          status,
        }
        const list = Array.isArray(deadlines) ? deadlines : []
        const next = deadlineDraft.id ? list.map(item => item.id === deadlineDraft.id ? nextItem : item) : [...list, nextItem]
        if (setLocalDeadlines(next)) {
          setDeadlineComposer(false)
          setDeadlineDetail(null)
          setAnchor(new Date(deadlineDraft.date + 'T00:00:00'))
        }
      }
    } finally {
      setDeadlineSaving(false)
    }
  }

  async function removeDeadline(id) {
    if (!id) return
    if (deadlineDetail?.id === id) setDeadlineDetail(null)
    if (loggedIn && deadlineRows) {
      const snapshot = deadlineRows
      // Bỏ qua temp-row chưa lên server (chỉ xóa optimistic).
      if (String(id).startsWith('temp-')) {
        setDeadlineRows(rows => (rows || []).filter(row => row.id !== id))
        return
      }
      setDeadlineRows(rows => (rows || []).filter(row => row.id !== id))
      try { await deleteDeadline(id) }
      catch (failure) { setDeadlineRows(snapshot); setDeadlineSyncError(failure.friendlyMessage || 'Không xóa được hạn nộp trên server.') }
      return
    }
    setLocalDeadlines((Array.isArray(deadlines) ? deadlines : []).filter(item => item.id !== id))
  }

  async function toggleDeadlineStatus(id) {
    if (!id) return
    const target = (deadlines || []).find(item => item.id === id)
    if (!target) return
    const nextStatus = !deadlineStatus(target)
    if (deadlineDetail?.id === id) setDeadlineDetail({ ...deadlineDetail, status: nextStatus })
    if (loggedIn && deadlineRows) {
      if (String(id).startsWith('temp-')) {
        setDeadlineRows(rows => (rows || []).map(row => row.id === id ? { ...row, status: nextStatus } : row))
        return
      }
      const snapshot = deadlineRows
      setDeadlineRows(rows => (rows || []).map(row => row.id === id ? { ...row, status: nextStatus } : row))
      setDeadlineSyncError('')
      try {
        const updated = await updateDeadline(id, { status: nextStatus })
        setDeadlineRows(rows => (rows || []).map(row => row.id === updated.id ? updated : row))
      } catch (failure) {
        setDeadlineRows(snapshot)
        if (deadlineDetail?.id === id) setDeadlineDetail(target)
        setDeadlineSyncError(failure.friendlyMessage || 'Không đổi được trạng thái hạn nộp trên server. Đã hoàn tác.')
      }
      return
    }
    setLocalDeadlines((Array.isArray(deadlines) ? deadlines : []).map(item => item.id === id ? { ...item, status: nextStatus } : item))
  }

  function move(amount) { const next = new Date(anchor); if (view === 'day') next.setDate(next.getDate() + amount); else if (view === 'week') next.setDate(next.getDate() + amount * 7); else if (view === 'month') { next.setDate(1); next.setMonth(next.getMonth() + amount) } else { next.setDate(1); next.setFullYear(next.getFullYear() + amount) } setAnchor(next) }

  function directRemove(date, id) {
    setLocalEventMap({ ...localEventMap, [date]: (localEventMap[date] || []).filter(item => item.id !== id) })
  }

  function scrubLocalGhost(target, singleDateOnly) {
    if (!target || !loggedIn) return
    let changed = false
    const next = {}
    Object.entries(localEventMap).forEach(([date, items]) => {
      const kept = (items || []).filter(item => {
        if (item.title !== target.title || item.start !== target.start || item.end !== target.end) return true
        if (singleDateOnly) return date !== target.date
        return false
      })
      if (kept.length !== (items || []).length) changed = true
      if (kept.length) next[date] = kept
    })
    if (changed) setLocalEventMap(next)
  }

  function findEvent(date, eventOrId) {
    const id = typeof eventOrId === 'object' && eventOrId !== null ? eventOrId.id : eventOrId
    if (typeof eventOrId === 'object' && eventOrId !== null && eventOrId.id) return eventOrId
    return (eventMap[date] || []).find(item => item.id === id) || (calendarMap[date] || []).find(item => item.id === id) || null
  }

  async function requestRemove(date, eventOrId) {
    const target = findEvent(date, eventOrId)
    if (!target || target.roadmap) { const id = typeof eventOrId === 'object' && eventOrId !== null ? eventOrId.id : eventOrId; if (id) directRemove(date, id); return }
    if (target.serverId && loggedIn && serverRows) {
      if (!target.repeatId) {
        const snapshot = serverRows
        setServerRows(rows => rows.filter(row => row.id !== target.serverId))
        scrubLocalGhost(target, true)
        try { await deleteScheduleBlock(target.serverId) }
        catch (failure) { setServerRows(snapshot); setSyncError(failure.friendlyMessage || 'Không xóa được buổi học trên server.') }
        return
      }
      setPendingDelete({ date, event: target, server: true }); return
    }
    if (!target.repeatId) { directRemove(date, target.id); return }
    setPendingDelete({ date, event: target, server: false })
  }

  function removeEvent(date, eventOrId) { requestRemove(date, eventOrId) }

  async function removeSingle() {
    if (!pendingDelete) return
    if (pendingDelete.server) {
      const target = pendingDelete.event
      const snapshot = serverRows
      setServerRows(rows => rows.map(row => row.id === target.serverId ? { ...row, exdates: [...(row.exdates || []), target.date] } : row)); setPendingDelete(null)
      scrubLocalGhost(target, true)
      try {
        const updated = await deleteScheduleBlock(target.serverId, { scope: 'single', day: target.date })
        setServerRows(rows => rows.map(row => row.id === updated.id ? updated : row))
      } catch (failure) { setServerRows(snapshot); setSyncError(failure.friendlyMessage || 'Không xóa được buổi học trên server.') }
      return
    }
    directRemove(pendingDelete.date, pendingDelete.event.id); setPendingDelete(null)
  }

  async function removeSeries() {
    if (!pendingDelete) return
    if (pendingDelete.server) {
      const target = pendingDelete.event
      const seriesId = target.serverId
      const snapshot = serverRows
      setServerRows(rows => rows.filter(row => row.id !== seriesId)); setPendingDelete(null)
      scrubLocalGhost(target, false)
      try { await deleteScheduleBlock(seriesId) }
      catch (failure) { setServerRows(snapshot); setSyncError(failure.friendlyMessage || 'Không xóa được chuỗi trên server.') }
      return
    }
    const rid = pendingDelete.event.repeatId
    const next = {}
    Object.entries(localEventMap).forEach(([date, items]) => { const kept = items.filter(item => item.repeatId !== rid); if (kept.length) next[date] = kept })
    setLocalEventMap(next)
    setPendingDelete(null)
  }

  function openDetail(event) { if (!event) return; setError(''); setDetailEvent(event) }
  function countSeries(repeatId) { if (!repeatId) return 1; return Object.values(calendarMap).flat().filter(item => item.repeatId === repeatId).length }
  function deleteFromDetail() { const target = detailEvent; setDetailEvent(null); if (!target || target.roadmap) return; removeEvent(target.date, target) }
  function toEditorDraft(event) { return { title: event.title || '', subject: event.subject || '', date: event.date, start: event.start, end: event.end, tone: event.tone || 'blue', repeat: event.repeat || 'none', repeatDays: [...(event.repeatDays || [])], repeatUntil: event.repeatUntil || '' } }

  const seriesCount = pendingDelete ? Object.values(calendarMap).flat().filter(item => item.repeatId && item.repeatId === pendingDelete.event.repeatId).length : 0

  async function saveEvent() {
    if (!draft.title.trim() || !draft.date || !draft.start || !draft.end) { setError('Hãy điền tên, ngày và giờ.'); return }
    if (minutes(draft.end) <= minutes(draft.start)) { setError('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.'); return }
    const repeat = draft.repeat || 'none'
    if (repeat !== 'none') {
      if (repeat === 'custom' && (!draft.repeatDays || draft.repeatDays.length === 0)) { setError('Hãy chọn ít nhất một ngày trong tuần để lặp lại.'); return }
      const until = draft.repeatUntil || defaultRepeatUntil(draft.date)
      if (until < draft.date) { setError('Ngày kết thúc lặp lại phải sau ngày bắt đầu.'); return }
    }
    if (loggedIn) {
      if (!serverRows) { setError('Đang tải lịch từ server, thử lại sau giây lát.'); return }
      const payload = draftToCreatePayload(draft)
      const tempId = 'temp-' + Date.now()
      const optimisticRow = { id: tempId, subject: null, kind: 'study', repeat_days: [], exdates: [], ...payload }
      if (!optimisticRow.repeat_until) optimisticRow.repeat_until = payload.repeat !== 'none' ? defaultRepeatUntil(payload.date) : null
      setServerRows(rows => [...(rows || []), optimisticRow])
      setSyncError(''); setAnchor(new Date(draft.date + 'T00:00:00')); setComposer(false)
      try {
        const created = await createScheduleBlock(payload)
        setServerRows(rows => (rows || []).map(row => row.id === tempId ? created : row))
      } catch (failure) {
        setServerRows(rows => (rows || []).filter(row => row.id !== tempId))
        setSyncError(failure.friendlyMessage || 'Không lưu được buổi học lên server. Đã hoàn tác.')
      }
      return
    }
    const untilRaw = repeat === 'none' ? null : (draft.repeatUntil || defaultRepeatUntil(draft.date))
    const until = untilRaw && untilRaw > defaultRepeatUntil(draft.date) ? defaultRepeatUntil(draft.date) : untilRaw
    const dates = expandRepeatDates(draft.date, repeat, draft.repeatDays, until)
    if (dates.length > 366) { setError('Chuỗi lặp lại quá dài (tối đa 366 buổi trong năm).'); return }
    const repeatId = dates.length > 1 ? crypto.randomUUID() : undefined
    const { repeatDays: pickedDays, ...base } = draft
    const items = dates.map(date => ({ ...base, title: draft.title.trim(), date, id: crypto.randomUUID(), ...(repeatId ? { repeatId, repeat, repeatUntil: until, ...(repeat === 'custom' ? { repeatDays: [...pickedDays] } : {}) } : { repeat: 'none' }) }))
    const next = { ...localEventMap }; items.forEach(item => { next[item.date] = [...(next[item.date] || []), item] })
    if (setLocalEventMap(next)) { setAnchor(new Date(draft.date + 'T00:00:00')); setComposer(false) }
  }

  async function saveEdit(draftValue, scope) {
    const target = editing?.event
    if (!target) throw { friendlyMessage: 'Không tìm thấy buổi cần sửa.' }
    if (!draftValue.title.trim() || !draftValue.date || !draftValue.start || !draftValue.end) throw { friendlyMessage: 'Hãy điền tên, ngày và giờ.' }
    if (minutes(draftValue.end) <= minutes(draftValue.start)) throw { friendlyMessage: 'Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.' }
    const inSeries = !!target.repeatId
    const effectiveScope = inSeries ? scope : 'series'
    if (effectiveScope === 'series' && target.serverId && (draftValue.repeat || 'none') === 'custom' && (!draftValue.repeatDays || !draftValue.repeatDays.length)) throw { friendlyMessage: 'Hãy chọn ít nhất một ngày trong tuần để lặp lại.' }
    if (target.serverId && loggedIn && serverRows) {
      if (effectiveScope === 'single' && inSeries) {
        const payload = { title: draftValue.title.trim(), subject: draftValue.subject?.trim() || null, date: draftValue.date, start_time: draftValue.start, end_time: draftValue.end, tone: draftValue.tone }
        const child = await updateScheduleBlock(target.serverId, payload, { scope: 'single', day: target.date })
        setServerRows(rows => rows.map(row => row.id === target.serverId ? { ...row, exdates: [...(row.exdates || []), target.date] } : row).concat([child]))
      } else {
        const updated = await updateScheduleBlock(target.serverId, draftToCreatePayload(draftValue), { scope: 'series' })
        setServerRows(rows => rows.map(row => row.id === updated.id ? updated : row))
      }
      setSyncError(''); setEditing(null); setDetailEvent(null); return
    }
    const next = { ...localEventMap }
    const originKey = Object.keys(next).find(key => (next[key] || []).some(item => item.id === target.id))
    if (originKey === undefined) throw { friendlyMessage: 'Không tìm thấy buổi cần sửa.' }
    if (effectiveScope === 'series' && inSeries) {
      Object.keys(next).forEach(key => { next[key] = (next[key] || []).map(item => item.repeatId === target.repeatId ? { ...item, title: draftValue.title.trim(), subject: draftValue.subject || '', start: draftValue.start, end: draftValue.end, tone: draftValue.tone } : item) })
    } else {
      const updatedItem = { ...target, title: draftValue.title.trim(), subject: draftValue.subject || '', date: draftValue.date, start: draftValue.start, end: draftValue.end, tone: draftValue.tone }
      next[originKey] = (next[originKey] || []).filter(item => item.id !== target.id)
      if (!next[originKey].length) delete next[originKey]
      next[draftValue.date] = [...(next[draftValue.date] || []), updatedItem]
    }
    if (setLocalEventMap(next)) { setEditing(null); setDetailEvent(null) }
  }

  const syncStatus = !loggedIn ? 'Chưa đăng nhập — lịch chỉ lưu trên trình duyệt này.' : loadingSchedule ? 'Đang đồng bộ lịch với server…' : syncError ? syncError : serverRows ? 'Đã lưu lên server ✓ (' + serverRows.length + ' chuỗi)' : ''
  const deadlineSyncStatus = !loggedIn ? 'Chưa đăng nhập — hạn nộp chỉ lưu trên trình duyệt này.' : loadingDeadlines ? 'Đang đồng bộ hạn nộp với server…' : deadlineSyncError ? deadlineSyncError : deadlineRows ? 'Đã lưu hạn nộp lên server ✓ (' + deadlineRows.length + ' hạn)' : ''

  return (
    <>
      <PageIntro eyebrow="SẮP XẾP TUẦN HỌC" title="Lịch học của bạn" subtitle="Lịch ở trường, buổi học thêm và hạn nộp bài — xem cùng một chỗ.">
        <div className="intro-actions">
          <button className="primary-button" onClick={() => openComposer()}>＋ Thêm lịch</button>
          <button className="success-button" onClick={() => openDeadlineComposer()}>＋ Hạn nộp</button>
        </div>
      </PageIntro>

      <div className="summary-grid schedule-stats">
        <div className="summary-chip blue"><span>TỔNG BUỔI</span><b>{sessions.length}</b></div>
        <div className="summary-chip mint"><span>TỔNG GIỜ</span><b>{totalHours.toFixed(1)}</b></div>
        <div className="summary-chip gold"><span>DEADLINE</span><b>{upcoming.length} sắp tới / {(deadlines || []).length} hạn{doneCount ? ' · ' + doneCount + ' xong' : ''}</b></div>
      </div>

      {syncStatus && <p className="repeat-hint" role="status">{syncStatus}</p>}
      {deadlineSyncStatus && <p className="repeat-hint" role="status">⚑ {deadlineSyncStatus}</p>}

      <SectionCard className="calendar-card">
        <div className="calendar-toolbar">
          <div className="calendar-nav">
            <button className="today-button" onClick={() => setAnchor(new Date())}>Hôm nay</button>
            <button className="round-button" aria-label="Lùi thời gian" onClick={() => move(-1)}>‹</button>
            <button className="round-button" aria-label="Tiến thời gian" onClick={() => move(1)}>›</button>
            <strong>{visibleTitle}</strong>
          </div>
          <div className="view-switcher" role="tablist">
            {viewOptions.map(([value, label]) => <button key={value} role="tab" aria-selected={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}
          </div>
        </div>
        {(loadingSchedule || loadingDeadlines) ? <p className="repeat-hint" role="status">Đang đồng bộ lịch với server…</p> : (
          <>
            {view === 'month' && <MonthView anchor={anchor} eventMap={calendarMap} deadlineMap={deadlineMap} onSelect={setSelectedDate} onOpen={openDetail} onOpenDeadline={setDeadlineDetail} onRemoveDeadline={removeDeadline} onToggleDeadline={toggleDeadlineStatus} />}
            {view === 'week' && <WeekView anchor={anchor} eventMap={calendarMap} deadlineMap={deadlineMap} onAdd={openComposer} onRemove={removeEvent} onOpen={openDetail} onOpenDeadline={setDeadlineDetail} onRemoveDeadline={removeDeadline} onToggleDeadline={toggleDeadlineStatus} />}
            {view === 'day' && <DayView anchor={anchor} eventMap={calendarMap} deadlineMap={deadlineMap} onAdd={openComposer} onRemove={removeEvent} onOpen={openDetail} onOpenDeadline={setDeadlineDetail} onRemoveDeadline={removeDeadline} onToggleDeadline={toggleDeadlineStatus} />}
            {view === 'year' && <YearView anchor={anchor} eventMap={calendarMap} deadlineMap={deadlineMap} onSelect={date => { setAnchor(date); setView('month') }} />}
          </>
        )}
      </SectionCard>

      <div className="schedule-bottom">
        <SectionCard className="deadline-card">
          <CardHeader icon="⚑" title="Hạn nộp bài" tone="orange" action="Thêm" onAction={() => openDeadlineComposer()} />
          <p>{upcoming.length} hạn sắp tới / {(deadlines || []).length} hạn tổng cộng{doneCount ? ' · ' + doneCount + ' đã xong ✓' : ''}</p>
          <DeadlineList items={sortedDeadlines} onOpen={setDeadlineDetail} onRemove={removeDeadline} onToggle={toggleDeadlineStatus} />
        </SectionCard>
      </div>

      {(localError || deadlineLocalError) && <p role="alert">{localError || deadlineLocalError}</p>}

      {selectedDate && (
        <Modal title={fullDateLabel(selectedDate)} onClose={() => setSelectedDate(null)}>
          <DayView
            anchor={selectedDate}
            eventMap={calendarMap}
            deadlineMap={deadlineMap}
            onAdd={(date, hour) => { setSelectedDate(null); openComposer(date, hour) }}
            onRemove={removeEvent}
            onOpen={openDetail}
            onOpenDeadline={item => { setSelectedDate(null); setDeadlineDetail(item) }}
            onRemoveDeadline={removeDeadline}
            onToggleDeadline={toggleDeadlineStatus}
          />
          <div className="composer-actions">
            <button className="primary-button" onClick={() => { setSelectedDate(null); openComposer(selectedDate) }}>＋ Thêm lịch</button>
            <button className="success-button" onClick={() => { const d = selectedDate; setSelectedDate(null); openDeadlineComposer(d) }}>＋ Hạn nộp</button>
          </div>
        </Modal>
      )}

      {composer && <EventComposer draft={draft} setDraft={setDraft} error={error || localError} onClose={() => setComposer(false)} onSave={saveEvent} />}

      {deadlineComposer && (
        <DeadlineComposer
          draft={deadlineDraft}
          setDraft={setDeadlineDraft}
          error={deadlineFormError || deadlineLocalError || deadlineSyncError}
          saving={deadlineSaving}
          loggedIn={loggedIn}
          onClose={() => setDeadlineComposer(false)}
          onSave={saveDeadline}
        />
      )}

      {deadlineDetail && (
        <DeadlineDetail
          item={deadlineDetail}
          loggedIn={loggedIn}
          onClose={() => setDeadlineDetail(null)}
          onEdit={() => openDeadlineComposer(deadlineDate(deadlineDetail), deadlineDetail)}
          onDelete={() => removeDeadline(deadlineDetail.id)}
          onToggle={() => toggleDeadlineStatus(deadlineDetail.id)}
        />
      )}

      {detailEvent && !editing && <EventDetail event={detailEvent} seriesCount={countSeries(detailEvent.repeatId)} onClose={() => setDetailEvent(null)} onEdit={() => setEditing({ event: detailEvent, scope: detailEvent.repeatId ? 'single' : 'series' })} onDelete={deleteFromDetail} />}
      {editing && <EventEditor key={editing.event.id} event={editing.event} initial={toEditorDraft(editing.event)} scope={editing.scope} setScope={scope => setEditing({ ...editing, scope })} seriesCount={countSeries(editing.event.repeatId)} canEditRule={!!(editing.event.serverId && loggedIn && serverRows)} onClose={() => setEditing(null)} onSave={saveEdit} />}

      {pendingDelete && (
        <Modal title="Xóa lịch lặp lại" onClose={() => setPendingDelete(null)}>
          <p><b>{pendingDelete.event.title}</b> thuộc chuỗi <b>{repeatSummary(pendingDelete.event)}</b> ({seriesCount} buổi). Bạn muốn xóa thế nào?</p>
          <p className="repeat-hint">{formatDay(pendingDelete.event.date)} · {pendingDelete.event.start}–{pendingDelete.event.end}</p>
          <div className="composer-actions repeat-delete-actions">
            <button type="button" className="ghost-button" onClick={() => setPendingDelete(null)}>Giữ lại</button>
            <button type="button" className="outline-button" onClick={removeSingle}>Chỉ xóa buổi này</button>
            <button type="button" className="delete-button" onClick={removeSeries}>Xóa toàn bộ chuỗi</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function MonthView({ anchor, eventMap, deadlineMap, onSelect, onOpen, onOpenDeadline, onRemoveDeadline, onToggleDeadline }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first)
  const dates = Array.from({ length: 42 }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); return date })
  const all = dates.flatMap(date => eventMap[keyOf(date)] || [])
  const startHour = Math.min(1, ...all.map(event => Math.floor(minutes(event.start) / 60)))
  const endHour = Math.max(24, ...all.map(event => Math.ceil(minutes(event.end) / 60)))
  return (
    <div className="month-calendar month-timed">
      <div className="weekday-row">{dayNames.map(day => <b key={day}>{day}</b>)}</div>
      <div className="month-grid">
        {dates.map(date => {
          const key = keyOf(date)
          const dayDeadlines = (deadlineMap || {})[key] || []
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              className={'month-cell ' + (date.getMonth() === anchor.getMonth() ? '' : 'muted-cell ') + (key === keyOf(new Date()) ? 'selected-date' : '')}
              onClick={() => onSelect(date)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(date) } }}
              aria-label={'Xem lịch ' + fullDateLabel(date)}
            >
              <div className="date-number">{date.getDate()}</div>
              <DeadlineDayHead items={dayDeadlines} onOpen={onOpenDeadline} onRemove={onRemoveDeadline} onToggle={onToggleDeadline} />
              <div className="month-timeline" style={{ height: (endHour - startHour) * 24 }}>
                {Array.from({ length: endHour - startHour }, (_, i) => <span className="month-hour" style={{ top: i * 24 }} key={i}>{String(i + startHour).padStart(2, '0')}</span>)}
                {layoutEvents(eventMap[key] || []).map(({ event, lane, lanes }) => (
                  <div
                    className="month-timed-event"
                    key={event.id}
                    style={{ top: (minutes(event.start) - startHour * 60) * 0.4, height: (minutes(event.end) - minutes(event.start)) * 0.4, left: 'calc(18px + (100% - 18px) * ' + lane / lanes + ')', width: 'calc((100% - 18px) / ' + lanes + ')' }}
                  >
                    <EventPill event={event} onOpen={onOpen ? () => onOpen(event) : undefined} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ anchor, ...props }) {
  const start = startOfWeek(anchor)
  const dates = Array.from({ length: 7 }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); return date })
  return <TimeCalendar dates={dates} {...props} />
}

function DayView({ anchor, ...props }) {
  const base = anchor instanceof Date ? anchor : new Date(anchor + 'T00:00:00')
  return <TimeCalendar dates={[base]} {...props} />
}

function TimeCalendar({ dates, eventMap, deadlineMap, onAdd, onRemove, onOpen, onOpenDeadline, onRemoveDeadline, onToggleDeadline }) {
  const all = dates.flatMap(date => eventMap[keyOf(date)] || [])
  const startHour = Math.min(1, ...all.map(event => Math.floor(minutes(event.start) / 60)))
  const endHour = Math.max(24, ...all.map(event => Math.ceil(minutes(event.end) / 60)))
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  return (
    <div className="timeline-scroll">
      <div className={'timeline ' + (dates.length > 1 ? 'timeline-week' : '')} style={{ '--days': dates.length }}>
        <div className="timeline-heading">
          <span />
          {dates.map(date => <b key={keyOf(date)}>{dayNames[(date.getDay() + 6) % 7]} {date.getDate()}/{date.getMonth() + 1}</b>)}
        </div>
        <div className="timeline-deadline-row">
          <span />
          {dates.map(date => {
            const key = keyOf(date)
            const items = (deadlineMap || {})[key] || []
            return (
              <div key={key} className="timeline-deadline-cell">
                {items.length > 0 && (
                  <>
                    <div className="day-deadlines-title">⚑ Deadline</div>
                    {items.map(item => (
                      <DeadlineStripItem key={item.id} item={item} onOpen={onOpenDeadline} onRemove={onRemoveDeadline} onToggle={onToggleDeadline} />
                    ))}
                  </>
                )}
              </div>
            )
          })}
        </div>
        <div className="timeline-body">
          <div className="timeline-labels">{hours.map(hour => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>
          {dates.map(date => (
            <div className="timeline-column" key={keyOf(date)} style={{ height: hours.length * 72 }}>
              {hours.map(hour => <button key={hour} className="timeline-slot" aria-label={'Thêm lịch ' + keyOf(date) + ' lúc ' + hour + ':00'} onClick={() => onAdd(date, String(hour).padStart(2, '0') + ':00')} />)}
              {layoutEvents(eventMap[keyOf(date)] || []).map(({ event, lane, lanes }) => (
                <div
                  className="timeline-event"
                  key={event.id}
                  style={{ top: (minutes(event.start) - startHour * 60) * 1.2, height: (minutes(event.end) - minutes(event.start)) * 1.2, left: 'calc(' + (lane / lanes * 100) + '% + 2px)', width: 'calc(' + (100 / lanes) + '% - 4px)' }}
                >
                  <EventPill event={event} onOpen={onOpen ? () => onOpen(event) : undefined} onRemove={event.roadmap ? undefined : () => onRemove(keyOf(date), event)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DeadlineList({ items, onOpen, onRemove, onToggle }) {
  if (!items?.length) return <p>Chưa có hạn nộp. Thêm deadline để theo dõi ngày cần hoàn thành.</p>
  return (
    <div className="deadline-list">
      {items.map(item => {
        const priority = deadlinePriority(item)
        const done = deadlineStatus(item)
        return (
          <div className={'deadline-item' + (done ? ' is-done' : '')} key={item.id}>
            <button
              type="button"
              className="deadline-toggle"
              aria-label={(done ? 'Mở lại hạn nộp ' : 'Hoàn thành hạn nộp ') + item.title}
              aria-pressed={done}
              title={done ? 'Mở lại' : 'Hoàn thành'}
              onClick={() => onToggle?.(item.id)}
            >
              {done ? '✓' : ''}
            </button>
            <span className={'priority-dot priority-' + priority} aria-hidden="true" title={'Mức độ: ' + (PRIORITY_LABEL[priority] || priority)} />
            <div>
              <b>
                <button type="button" className="link-button" onClick={() => onOpen?.(item)}>{item.title}</button>
              </b>
              <small>{formatDay(deadlineDate(item))} · Hạn {deadlineTime(item)} · {PRIORITY_LABEL[priority] || priority}{done ? ' · Đã xong ✓' : ''}</small>
            </div>
            <button className="deadline-remove" aria-label={'Xóa hạn nộp ' + item.title} onClick={() => onRemove(item.id)}>×</button>
          </div>
        )
      })}
    </div>
  )
}

function YearView({ anchor, eventMap, deadlineMap, onSelect }) {
  return (
    <div className="year-grid">
      {Array.from({ length: 12 }, (_, month) => {
        const date = new Date(anchor.getFullYear(), month, 1)
        const days = new Date(anchor.getFullYear(), month + 1, 0).getDate()
        return (
          <button className="year-month" key={month} onClick={() => onSelect(date)}>
            <b>{date.toLocaleDateString('vi-VN', { month: 'long' })}</b>
            <div className="mini-week">{dayNames.map(day => <span key={day}>{day.slice(1)}</span>)}</div>
            <div className="mini-days">
              {Array.from({ length: days }, (_, day) => {
                const key = keyOf(new Date(anchor.getFullYear(), month, day + 1))
                const hasSomething = ((eventMap || {})[key] || []).length > 0 || ((deadlineMap || {})[key] || []).length > 0
                return <i className={hasSomething ? 'has-events' : ''} key={day}>{day + 1}</i>
              })}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function RepeatFields({ draft, setDraft }) {
  const repeat = draft.repeat || 'none'
  const preview = expandRepeatDates(draft.date, repeat, draft.repeatDays, draft.repeatUntil || defaultRepeatUntil(draft.date || keyOf(new Date())))
  function toggleDay(value) {
    const days = Array.isArray(draft.repeatDays) ? draft.repeatDays : []
    setDraft({ ...draft, repeatDays: days.includes(value) ? days.filter(v => v !== value) : [...days, value].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)) })
  }
  return (
    <>
      <label>Lặp lại
        <select
          value={repeat}
          onChange={event => {
            const value = event.target.value
            const dow = draft.date ? parseKey(draft.date).getDay() : 1
            setDraft({ ...draft, repeat: value, repeatDays: value === 'custom' ? ((draft.repeatDays && draft.repeatDays.length) ? draft.repeatDays : [dow]) : draft.repeatDays, repeatUntil: value === 'none' ? '' : (draft.repeatUntil || defaultRepeatUntil(draft.date || keyOf(new Date()))) })
          }}
        >
          {repeatOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {repeat !== 'none' && (
        <div className="repeat-box">
          {repeat === 'custom' && (
            <div>
              <span className="repeat-hint">Lặp vào các ngày:</span>
              <div className="repeat-days">
                {weekdayOptions.map(([value, label]) => (
                  <button type="button" key={value} aria-pressed={(draft.repeatDays || []).includes(value)} className={'repeat-day' + ((draft.repeatDays || []).includes(value) ? ' active' : '')} onClick={() => toggleDay(value)}>{label}</button>
                ))}
              </div>
            </div>
          )}
          <label>Lặp đến ngày (mặc định hết năm)
            <input required={repeat !== 'none'} type="date" min={draft.date} max={draft.date ? defaultRepeatUntil(draft.date) : undefined} value={draft.repeatUntil || (draft.date ? defaultRepeatUntil(draft.date) : '')} onChange={event => setDraft({ ...draft, repeatUntil: event.target.value })} />
          </label>
          <span className="repeat-hint">Tự động lặp liên tục đến 31/12{draft.date ? ' (' + draft.date.slice(0, 4) + ')' : ''} — bạn có thể chọn ngày sớm hơn nếu muốn dừng trước.</span>
          <p className="repeat-preview">Sẽ tạo <b>{preview.length} buổi</b>{preview.length > 0 && <> đến 31/12: {preview.slice(0, 6).map(shortDateLabel).join(', ')}{preview.length > 6 ? ' … đến ' + shortDateLabel(preview[preview.length - 1]) : ''}</>}</p>
        </div>
      )}
    </>
  )
}

function EventDetail({ event, seriesCount, onClose, onEdit, onDelete }) {
  const inSeries = !!event.repeatId
  const duration = Math.max(0, minutes(event.end) - minutes(event.start))
  const durationLabel = duration >= 60 ? Math.floor(duration / 60) + ' giờ' + (duration % 60 ? ' ' + (duration % 60) + ' phút' : '') : duration + ' phút'
  return (
    <Modal title="Chi tiết buổi học" onClose={onClose}>
      <div className="detail-rows">
        <div><span>Tên</span><b>{event.title}</b></div>
        {event.subject && <div><span>Môn học</span><b>{event.subject}</b></div>}
        <div><span>Ngày</span><b>{formatDay(event.date)}</b></div>
        <div><span>Giờ</span><b>{event.start}–{event.end} ({durationLabel})</b></div>
        <div><span>Lặp lại</span><b>{inSeries ? '🔁 ' + repeatSummary(event) + ' · ' + seriesCount + ' buổi' : 'Không lặp lại'}</b></div>
        {!event.roadmap && <div><span>Lưu trữ</span><b>{event.serverId ? 'Đã lưu lên server ✓' : 'Chỉ trên trình duyệt'}</b></div>}
      </div>
      <div className="composer-actions repeat-delete-actions">
        <button type="button" className="ghost-button" onClick={onClose}>Đóng</button>
        {!event.roadmap && <button type="button" className="delete-button" onClick={onDelete}>Xóa</button>}
        {!event.roadmap && <button type="button" className="primary-button" onClick={onEdit}>Sửa</button>}
      </div>
    </Modal>
  )
}

function EventEditor({ event, initial, scope, setScope, seriesCount, canEditRule, onClose, onSave }) {
  const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects)
  const [draftValue, setDraftValue] = useState(initial)
  const [errorMessage, setErrorMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const inSeries = !!event.repeatId
  async function submit(formEvent) {
    formEvent.preventDefault(); setSaving(true); setErrorMessage('')
    try { await onSave(draftValue, scope) } catch (failure) { setErrorMessage(failure.friendlyMessage || 'Không lưu được thay đổi. Vui lòng thử lại.'); setSaving(false) }
  }
  return (
    <Modal title="Sửa buổi học" onClose={onClose}>
      <form onSubmit={submit}>
        {inSeries && <div className="scope-switch" role="radiogroup" aria-label="Phạm vi sửa"><button type="button" aria-pressed={scope === 'single'} className={scope === 'single' ? 'active' : ''} onClick={() => setScope('single')}>Chỉ buổi này ({shortDateLabel(event.date)})</button><button type="button" aria-pressed={scope === 'series'} className={scope === 'series' ? 'active' : ''} onClick={() => setScope('series')}>Cả chuỗi ({seriesCount} buổi)</button></div>}
        <label>Tên buổi học<input autoFocus required maxLength={160} value={draftValue.title} onChange={e => setDraftValue({ ...draftValue, title: e.target.value })} /></label>
        <label>Môn học<input maxLength={80} list="schedule-subjects-edit" value={draftValue.subject || ''} onChange={e => setDraftValue({ ...draftValue, subject: e.target.value })} placeholder="Ví dụ: Toán, Ngữ văn, Tiếng Anh" /><datalist id="schedule-subjects-edit">{[...new Set([...subjects, ...SCHOOL_SUBJECTS])].map(subject => <option key={subject} value={subject} />)}</datalist></label>
        <label>Ngày<input required type="date" value={draftValue.date} disabled={scope === 'series' && !canEditRule} onChange={e => setDraftValue({ ...draftValue, date: e.target.value })} /></label>
        <div className="composer-times"><label>Bắt đầu<input required type="time" value={draftValue.start} onChange={e => setDraftValue({ ...draftValue, start: e.target.value })} /></label><label>Kết thúc<input required type="time" value={draftValue.end} onChange={e => setDraftValue({ ...draftValue, end: e.target.value })} /></label></div>
        <label>Màu lịch<select value={draftValue.tone} onChange={e => setDraftValue({ ...draftValue, tone: e.target.value })}>{palette.map(tone => <option key={tone}>{tone}</option>)}</select></label>
        {scope === 'series' && canEditRule && <RepeatFields draft={draftValue} setDraft={setDraftValue} />}
        {scope === 'series' && !canEditRule && inSeries && <p className="repeat-hint">🔁 {repeatSummary(event)} — chưa đăng nhập nên chỉ sửa nội dung chung, giữ nguyên ngày và rule lặp lại.</p>}
        {scope === 'single' && inSeries && <p className="repeat-hint">Buổi này sẽ tách khỏi chuỗi thành block riêng, chuỗi gốc giữ nguyên.</p>}
        {errorMessage && <p role="alert">{errorMessage}</p>}
        <div className="composer-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
      </form>
    </Modal>
  )
}

function EventComposer({ draft, setDraft, onClose, onSave, error }) {
  const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects)
  const repeat = draft.repeat || 'none'
  const preview = expandRepeatDates(draft.date, repeat, draft.repeatDays, draft.repeatUntil || defaultRepeatUntil(draft.date || keyOf(new Date())))
  return (
    <Modal title="Thêm lịch" onClose={onClose}>
      <form onSubmit={event => { event.preventDefault(); onSave() }}>
        <label>Tên buổi học<input autoFocus required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Môn học
          <input maxLength={80} list="schedule-subjects" value={draft.subject || ''} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="Ví dụ: Toán, Ngữ văn, Tiếng Anh" />
          <datalist id="schedule-subjects">{[...new Set([...subjects, ...SCHOOL_SUBJECTS])].map(subject => <option key={subject} value={subject} />)}</datalist>
        </label>
        <label>Ngày
          <input
            required
            type="date"
            value={draft.date}
            onChange={event => {
              const nextDate = event.target.value
              const dow = nextDate ? parseKey(nextDate).getDay() : null
              setDraft(prev => {
                const eoy = nextDate ? defaultRepeatUntil(nextDate) : prev.repeatUntil
                const keepUntil = prev.repeat && prev.repeat !== 'none' && nextDate ? (prev.repeatUntil && prev.repeatUntil >= nextDate && prev.repeatUntil.slice(0, 4) === nextDate.slice(0, 4) ? prev.repeatUntil : eoy) : prev.repeatUntil
                return { ...prev, date: nextDate, repeatDays: prev.repeat === 'custom' && dow !== null && (!prev.repeatDays || prev.repeatDays.length === 0) ? [dow] : prev.repeatDays, repeatUntil: keepUntil }
              })
            }}
          />
        </label>
        <div className="composer-times">
          <label>Bắt đầu<input required type="time" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
          <label>Kết thúc<input required type="time" value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>
        </div>
        <label>Màu lịch<select value={draft.tone} onChange={event => setDraft({ ...draft, tone: event.target.value })}>{palette.map(tone => <option key={tone}>{tone}</option>)}</select></label>
        <RepeatFields draft={draft} setDraft={setDraft} />
        {error && <p role="alert">{error}</p>}
        <div className="composer-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Hủy</button>
          <button className="primary-button">Lưu lịch{repeat !== 'none' && preview.length > 1 ? ' (' + preview.length + ' buổi)' : ''}</button>
        </div>
      </form>
    </Modal>
  )
}

function DeadlineComposer({ draft, setDraft, error, saving, loggedIn, onClose, onSave }) {
  const isEdit = Boolean(draft.id)
  return (
    <Modal title={isEdit ? 'Sửa hạn nộp' : 'Thêm hạn nộp'} onClose={onClose}>
      <form onSubmit={event => { event.preventDefault(); onSave() }}>
        <label>Tên deadline<input autoFocus required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Ví dụ: Nộp bài văn thuyết minh" /></label>
        <div className="composer-times">
          <label>Ngày nộp<input required type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
          <label>Giờ nộp<input required type="time" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} /></label>
        </div>
        <label>Mức độ quan trọng
          <select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>
            {PRIORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="check-row"><input type="checkbox" checked={!!draft.status} onChange={event => setDraft({ ...draft, status: event.target.checked })} /> Đã hoàn thành</label>
        <p className="repeat-hint">{loggedIn ? 'Hạn nộp sẽ lưu lên server ✓, không tạo block giờ học và không lặp lại. Nó sẽ hiện trên đầu ngày nộp.' : 'Chưa đăng nhập — hạn nộp chỉ lưu trên trình duyệt này. Đăng nhập để đồng bộ lên server.'}</p>
        {error && <p role="alert">{error}</p>}
        <div className="composer-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Hủy</button>
          <button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Lưu hạn nộp'}</button>
        </div>
      </form>
    </Modal>
  )
}

function DeadlineDetail({ item, loggedIn, onClose, onEdit, onDelete, onToggle }) {
  const priority = deadlinePriority(item)
  const done = deadlineStatus(item)
  return (
    <Modal title="Chi tiết hạn nộp" onClose={onClose}>
      <div className="detail-rows">
        <div><span>Tên</span><b>{item.title}</b></div>
        <div><span>Ngày nộp</span><b>{formatDay(deadlineDate(item))}</b></div>
        <div><span>Giờ nộp</span><b>{deadlineTime(item)}</b></div>
        <div><span>Mức độ</span><b>{PRIORITY_LABEL[priority] || priority}</b></div>
        <div><span>Trạng thái</span><b>{done ? 'Đã hoàn thành ✓' : 'Chưa xong'}</b></div>
        <div><span>Lưu trữ</span><b>{loggedIn ? 'Đã lưu lên server ✓' : 'Chỉ trên trình duyệt'}</b></div>
      </div>
      <div className="composer-actions repeat-delete-actions">
        <button type="button" className="ghost-button" onClick={onClose}>Đóng</button>
        <button type="button" className="delete-button" onClick={onDelete}>Xóa</button>
        <button type="button" className="outline-button" onClick={onToggle}>{done ? 'Mở lại' : 'Hoàn thành'}</button>
        <button type="button" className="primary-button" onClick={onEdit}>Sửa</button>
      </div>
    </Modal>
  )
}
