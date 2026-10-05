import { useEffect, useState } from 'react'
import { CardHeader, PageIntro, ProgressBar, SectionCard, SegmentedControl } from '../components/PageComponents'
import { fetchPomodoroSessions, getSession, onSessionChange } from '../backendApi'

const keyOf = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

// Ngày local của 1 phiên Pomodoro (dùng started_at, khớp keyOf/range ở dưới).
const dayOf = row => {
  const date = new Date(row?.started_at)
  return Number.isNaN(date.getTime()) ? '' : keyOf(date)
}
const minutesOfRow = row => Math.max(0, Number(row?.focus_minutes ?? 0) || 0)
const hourOf = row => {
  const date = new Date(row?.started_at)
  return Number.isNaN(date.getTime()) ? -1 : date.getHours() + date.getMinutes() / 60
}

// Số local của hôm nay (chưa đăng nhập): chỉ có tổng phiên + tổng phút, không có giờ/môn.
function readFocusLengthFallback() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-durations'))
    if (Array.isArray(saved) && Number.isInteger(saved[0]) && saved[0] >= 1 && saved[0] <= 180) return saved[0]
  } catch { /* Chưa có durations: dùng mặc định Pomodoro. */ }
  return 25
}
function readLocalFocus() {
  try {
    const saved = JSON.parse(localStorage.getItem('nhip-hoc-focus'))
    const todayKey = keyOf(new Date())
    if (saved?.date === todayKey && Number.isInteger(saved?.sessions) && saved.sessions > 0) {
      const minutes = Number.isInteger(saved?.minutes) && saved.minutes >= 0 ? saved.minutes : saved.sessions * readFocusLengthFallback()
      return { date: todayKey, sessions: saved.sessions, minutes }
    }
  } catch { /* Chưa có số local: coi như 0. */ }
  return null
}

const formatTotal = total => {
  const value = Math.max(0, Math.round(Number(total) || 0))
  if (value <= 0) return '0 phút'
  if (value < 60) return value + ' phút'
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest ? hours + ' giờ ' + rest + ' phút' : hours + ' giờ'
}
const formatShort = total => {
  const value = Math.max(0, Math.round(Number(total) || 0))
  if (value <= 0) return '—'
  if (value < 60) return value + 'p'
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest ? hours + 'h' + rest + 'p' : hours + 'h'
}

const WINDOWS = [
  { key: 'morning', icon: '🌅', title: 'Sáng', hint: 'Trước 12:00' },
  { key: 'afternoon', icon: '☀️', title: 'Chiều', hint: '12:00 – 18:00' },
  { key: 'evening', icon: '🌙', title: 'Tối', hint: 'Sau 18:00' },
]
const inWindow = (row, key) => {
  const hour = hourOf(row)
  if (hour < 0) return false
  if (key === 'morning') return hour < 12
  if (key === 'afternoon') return hour >= 12 && hour < 18
  return hour >= 18
}

export default function StatsPage() {
  const [today] = useState(() => new Date())
  const schoolYear = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1
  const schoolYearLabel = `Năm học ${schoolYear}–${schoolYear + 1}`
  const [selected, setSelected] = useState('')
  const [period, setPeriod] = useState('Tuần này')
  const [loggedIn, setLoggedIn] = useState(() => !!getSession())
  const [serverSessions, setServerSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [refetchKey, setRefetchKey] = useState(0)

  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (period === 'Tuần này') rangeStart.setDate(rangeStart.getDate() - (rangeStart.getDay() + 6) % 7)
  else if (period === 'Tháng này') rangeStart.setDate(1)
  else rangeStart.setFullYear(schoolYear, 8, 1)
  const rangeEnd = new Date(rangeStart)
  if (period === 'Tuần này') rangeEnd.setDate(rangeEnd.getDate() + 7)
  else if (period === 'Tháng này') rangeEnd.setMonth(rangeEnd.getMonth() + 1)
  else rangeEnd.setFullYear(schoolYear + 1, 8, 1)
  const fromKey = keyOf(rangeStart)
  const toExclusiveKey = keyOf(rangeEnd)
  const endInclusive = new Date(rangeEnd)
  endInclusive.setDate(endInclusive.getDate() - 1)
  const toKey = keyOf(endInclusive)

  useEffect(() => onSessionChange(() => setRefetchKey(count => count + 1)), [])

  // Nguồn sự thật duy nhất: phiên focus đã hoàn thành trên server (PomodoroPage tự POST khi hết giờ).
  useEffect(() => {
    let cancelled = false
    const session = getSession()
    setLoggedIn(!!session)
    if (!session) {
      setServerSessions([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    fetchPomodoroSessions(fromKey, toKey)
      .then(rows => {
        if (cancelled) return
        setServerSessions(Array.isArray(rows) ? rows : [])
        setSyncError('')
      })
      .catch(failure => {
        if (cancelled) return
        setSyncError(failure?.friendlyMessage || 'Không tải được dữ liệu tập trung.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [fromKey, toKey, refetchKey])

  // Lọc lại theo ngày local (server lọc theo UTC nên có thể lệch 1 ngày với giờ VN).
  const sessions = serverSessions.filter(row => {
    const day = dayOf(row)
    return day && day >= fromKey && day < toExclusiveKey
  })

  // Số local của hôm nay khi chưa đăng nhập (tính trực tiếp mỗi lần render cho luôn mới).
  const localFocus = (() => {
    if (loggedIn) return null
    const local = readLocalFocus()
    if (!local) return null
    if (local.date < fromKey || local.date >= toExclusiveKey) return null
    return local
  })()

  const totalSessions = sessions.length + (localFocus?.sessions ?? 0)
  const totalMinutes = sessions.reduce((sum, row) => sum + minutesOfRow(row), 0) + (localFocus?.minutes ?? 0)
  const studyDays = new Set(sessions.map(dayOf).filter(Boolean))
  if (localFocus) studyDays.add(localFocus.date)

  const minutesByDay = new Map()
  sessions.forEach(row => {
    const day = dayOf(row)
    if (day) minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + minutesOfRow(row))
  })
  if (localFocus) minutesByDay.set(localFocus.date, (minutesByDay.get(localFocus.date) ?? 0) + localFocus.minutes)
  const minutesOfDay = day => minutesByDay.get(day) ?? 0

  const sessionsOfDay = day => sessions.filter(row => dayOf(row) === day)
  const windowMinutes = key => sessions.reduce((sum, row) => sum + (inWindow(row, key) ? minutesOfRow(row) : 0), 0)

  const subjectTotals = new Map()
  sessions.forEach(row => {
    const name = String(row?.subject || '').trim() || 'Chưa chọn môn'
    subjectTotals.set(name, (subjectTotals.get(name) ?? 0) + minutesOfRow(row))
  })
  const bySubject = [...subjectTotals.entries()].sort((a, b) => b[1] - a[1])

  const start = new Date(rangeStart)
  start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  const heatmap = Array.from({ length: Math.ceil((rangeEnd - start) / 86400000) }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date })
  const selectedRows = selected ? sessionsOfDay(selected) : []
  const selectedMinutes = selected ? minutesOfDay(selected) : 0

  return (
    <>
      <PageIntro eyebrow={'NHÌN LẠI VIỆC HỌC · ' + today.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }).toLocaleUpperCase('vi')} title="Tiến bộ của bạn" subtitle="Số liệu từ các phiên tập trung Pomodoro đã hoàn thành.">
        <div className="intro-actions"><SegmentedControl items={['Tuần này', 'Tháng này', schoolYearLabel]} value={period} onChange={setPeriod} /><button className="ghost-button" onClick={() => window.print()}>⇩ Xuất báo cáo PDF</button></div>
      </PageIntro>
      <p className="report-period">Báo cáo: {period} · {fromKey} đến trước {toExclusiveKey}. Chọn “Lưu dưới dạng PDF” trong hộp thoại in.</p>
      {loading && <p className="duration-hint">Đang tải dữ liệu tập trung…</p>}
      {syncError && <p role="alert">{syncError}</p>}
      {!loggedIn && <p className="duration-hint">Bạn chưa đăng nhập — đang hiện số local của hôm nay (nếu có). Đăng nhập và hoàn thành phiên focus để xem đầy đủ theo tuần/tháng.</p>}
      <div className="metric-grid">
        <div className="metric-card gold"><span>🔥</span><div><small>Ngày đã học</small><b>{studyDays.size} ngày</b></div></div>
        <div className="metric-card blue"><span>⌛</span><div><small>Thời gian tập trung</small><b>{formatTotal(totalMinutes)}</b></div></div>
        <div className="metric-card mint"><span>♧</span><div><small>Phiên tập trung</small><b>{totalSessions} phiên</b></div></div>
      </div>
      <SectionCard className="heatmap-card"><div className="heatmap-heading"><CardHeader icon="▣" title="Những ngày bạn đã học" tone="orange" /><span className="muted-label">Phút tập trung theo ngày (Pomodoro)</span></div><div className="heatmap-grid"><div className="heat-days">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => <b key={day}>{day}</b>)}</div><div className="heat-cells">{heatmap.map((date, index) => <button type="button" onClick={() => setSelected(keyOf(date))} aria-pressed={selected === keyOf(date)} aria-current={keyOf(date) === keyOf(today) ? 'date' : undefined} className={'heat-cell' + (keyOf(date) === keyOf(today) ? ' current' : '') + (selected === keyOf(date) ? ' selected' : '') + ((date < rangeStart || date >= rangeEnd) ? ' outside-month' : '')} key={index} aria-label={date.getDate() + '/' + (date.getMonth() + 1) + ': ' + formatTotal(minutesOfDay(keyOf(date)))}><b>{date.getDate()}/{date.getMonth() + 1}</b><span>{formatShort(minutesOfDay(keyOf(date)))}</span></button>)}</div></div>{selected && <div className="empty-strip">Ngày {selected}: {selectedRows.length} phiên · {formatTotal(selectedMinutes)}{selectedRows.length ? ' · ' + selectedRows.map(row => (row.subject || 'Chưa chọn môn') + ' ' + minutesOfRow(row) + 'p').join(', ') : ''}</div>}</SectionCard>
      <div className="stats-grid"><SectionCard><CardHeader icon="ϟ" title="Khung giờ học tập" tone="blue" /><div className="study-windows">{WINDOWS.map(window => <div className="study-window" key={window.key}><span>{window.icon}</span><b>{window.title}</b><strong>{formatTotal(windowMinutes(window.key))}</strong><small>{window.hint}</small></div>)}</div><div className="empty-strip">Tính từ giờ bắt đầu các phiên focus đã hoàn thành</div></SectionCard><SectionCard><CardHeader icon="▤" title="Thời lượng theo môn" tone="mint" /><div className="subject-list">{bySubject.length ? bySubject.map(([subject, minutes]) => <div key={subject}><div><b>{subject}</b><span>{formatTotal(minutes)}</span></div><ProgressBar value={totalMinutes ? minutes / totalMinutes * 100 : 0} /></div>) : <p className="duration-hint">Chưa có phiên nào trong khoảng này. Vào phòng tập trung, chọn môn rồi hoàn thành 1 phiên nhé.</p>}</div></SectionCard></div>
      <SectionCard className="stats-reflection"><CardHeader icon="◎" title="Bước tiếp theo của bạn" tone="mint" /><p>{totalSessions ? `Bạn đã hoàn thành ${totalSessions} phiên với ${formatTotal(totalMinutes)} trong khoảng thời gian này. Giữ nhịp — thêm một phiên vừa sức nữa nhé.` : 'Hoàn thành một phiên focus để nhìn lại tiến bộ tại đây. Bắt đầu từ một phiên ngắn vừa sức.'}</p><a className="outline-button" href="#pomodoro">Mở phòng tập trung →</a></SectionCard>
    </>
  )
}
