import { CardHeader, PageIntro, ProgressBar, SectionCard, SegmentedControl } from '../components/PageComponents'

import { useState } from 'react'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import { defaultSubjects } from '../data/subjects'
import { minutes } from '../data/calendar'
const keyOf = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

export default function StatsPage({ onNavigate }) {
  const [today] = useState(() => new Date())
  const [selected, setSelected] = useState('')
  const [period, setPeriod] = useState('Tuần này')
  const [roadmaps] = useStoredState('nhip-hoc-roadmaps', [])
  const allLessons = roadmaps.flatMap(roadmap => roadmap.lessons.map(lesson => ({ ...lesson, subject: roadmap.subject })))
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (period === 'Tuần này') rangeStart.setDate(rangeStart.getDate() - (rangeStart.getDay() + 6) % 7)
  else if (period === 'Tháng này') rangeStart.setDate(1)
  else rangeStart.setFullYear(2026, 8, 1)
  const rangeEnd = new Date(rangeStart)
  if (period === 'Tuần này') rangeEnd.setDate(rangeEnd.getDate() + 7)
  else if (period === 'Tháng này') rangeEnd.setMonth(rangeEnd.getMonth() + 1)
  else rangeEnd.setFullYear(2027, 8, 1)
  const lessons = allLessons.filter(item => item.date >= keyOf(rangeStart) && item.date < keyOf(rangeEnd))
  const done = lessons.filter(lesson => lesson.done)
  const hours = items => items.reduce((total, item) => total + Math.max(0, minutes(item.end) - minutes(item.start)) / 60, 0)
  const displayHours = items => hours(items).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'h'
  const subjectHours = subject => hours(done.filter(item => item.subject === subject))
  const [subjects, saveSubjects, error] = useStoredState('nhip-hoc-subjects', defaultSubjects)
  const [showSubject, setShowSubject] = useState(false)
  const [subjectName, setSubjectName] = useState('')
  const [validation, setValidation] = useState('')
  const start = new Date(rangeStart)
  start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  const heatmap = Array.from({ length: Math.ceil((rangeEnd - start) / 86400000) }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date })
  function addSubject(event) {
    event.preventDefault()
    const name = subjectName.trim()
    if (!name) { setValidation('Nhập tên môn học.'); return }
    if (subjects.some(subject => subject.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) { setValidation('Môn học này đã có trong danh sách.'); return }
    if (saveSubjects([...subjects, name])) { setShowSubject(false); setSubjectName(''); setValidation('') }
  }
  return (
    <>
      <PageIntro eyebrow={'✨ NHỊP HỌC CÁ NHÂN · ' + today.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }).toLocaleUpperCase('vi')} title="Thống kê học tập" subtitle="Nhìn lại tiến bộ để biết hôm nay nên học gì tiếp theo.">
        <div className="intro-actions"><SegmentedControl items={['Tuần này', 'Tháng này', 'Kỳ 2026–2027']} value={period} onChange={setPeriod} /><button className="ghost-button" onClick={() => window.print()}>⇩ Xuất báo cáo PDF</button></div>
      </PageIntro>
      <p className="report-period">Báo cáo: {period} · {keyOf(rangeStart)} đến trước {keyOf(rangeEnd)}. Chọn “Lưu dưới dạng PDF” trong hộp thoại in.</p>
      <div className="metric-grid">{[['🔥', 'Ngày đã học', new Set(done.map(item => item.date)).size + ' ngày', 'gold'], ['◷', 'Đã học theo lộ trình', displayHours(done), 'blue'], ['✅', 'Hoàn thành lộ trình', (lessons.length ? Math.round(done.length / lessons.length * 100) : 0) + '%', 'mint']].map(([icon, label, value, tone]) => <div className={'metric-card ' + tone} key={label}><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>)}</div>
      <SectionCard className="heatmap-card"><div className="heatmap-heading"><CardHeader icon="▣" title="Lịch chuỗi học tập & Nhiệt kế kỷ luật 🔥" tone="orange" /><div className="heat-legend"><span>Ít</span><i /><i /><i /><i /><span>Nhiều (&gt;4h)</span></div></div><div className="heatmap-grid"><div className="heat-days">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => <b key={day}>{day}</b>)}</div><div className="heat-cells">{heatmap.map((date, index) => <button type="button" onClick={() => setSelected(keyOf(date))} aria-pressed={selected === keyOf(date)} aria-current={keyOf(date) === keyOf(today) ? 'date' : undefined} className={'heat-cell' + (keyOf(date) === keyOf(today) ? ' current' : '') + (selected === keyOf(date) ? ' selected' : '') + ((date < rangeStart || date >= rangeEnd) ? ' outside-month' : '')} key={index} aria-label={date.getDate() + '/' + (date.getMonth() + 1) + ': ' + displayHours(done.filter(item => item.date === keyOf(date)))}><b>{date.getDate()}/{date.getMonth() + 1}</b><span>{displayHours(done.filter(item => item.date === keyOf(date)))}</span></button>)}</div><aside className="milestones"><h3>🏅 Cột mốc chuỗi học <span>0 / 3 đạt</span></h3>{['Huy hiệu 7 ngày', 'Huy hiệu 14 ngày', '21 Ngày: Kỷ luật'].map((label, index) => <div className="milestone" key={label}><span>♙</span><b>{label} ...</b><small>Chưa mở khóa • 0 / {(index + 1) * 7} ngày</small><em>🔒</em></div>)}</aside></div></SectionCard>
      <div className="stats-grid"><SectionCard><CardHeader icon="ϟ" title="Khung giờ học tập" tone="blue" /><div className="study-windows">{[['🌅', 'Sáng', '0h', '07:30 – 11:30'], ['☀️', 'Chiều', '0h', '13:30 – 17:00'], ['🌙', 'Tối', '0h', '19:30 – 22:30']].map(([icon, title, , time]) => <div className="study-window" key={title}><span>{icon}</span><b>{title}</b><strong>{displayHours(done.filter(item => { const hour = minutes(item.start) / 60; return title === 'Sáng' ? hour < 12 : title === 'Chiều' ? hour >= 12 && hour < 18 : hour >= 18 }))}</strong><small>{time}</small></div>)}</div><div className="empty-strip">Thời lượng được cộng từ các bài học đã đánh dấu hoàn thành trong lộ trình</div></SectionCard><SectionCard><CardHeader icon="▤" title="Thời lượng theo môn" tone="mint" action="Thêm môn" onAction={() => { setValidation(''); setShowSubject(true) }} /><div className="subject-list">{subjects.map((subject) => <div key={subject}><div><b>{subject}</b><span>{displayHours(done.filter(item => item.subject === subject))}</span><button className="delete-button" onClick={() => saveSubjects(subjects.filter(item => item !== subject))}>Xóa</button></div><ProgressBar value={hours(done) ? subjectHours(subject) / hours(done) * 100 : 0} /></div>)}</div></SectionCard></div>
      <div className="stats-grid"><SectionCard><CardHeader icon="🎯" title="Thử thách tuần" /><div className="challenge"><div><b>Học đều cả sáng (5 ngày)</b><span>0/5 ngày</span></div><div className="challenge-days">{['T2', 'T3', 'T4', 'Hôm nay', 'Mai'].map((day, index) => <span className={index === 3 ? 'current' : ''} key={day}>{day}<small>0p</small></span>)}</div><footer>Thưởng: +500 điểm rèn luyện <button className="small-action" onClick={() => onNavigate('schedule')}>Bắt đầu</button></footer></div></SectionCard><div className="blue-callout"><h2>Nhắc học tập</h2><p>Duy trì thói quen mỗi ngày để tăng tiến độ.</p><button className="gold-button" onClick={() => onNavigate('settings/notifications')}>Thiết lập nhắc nhở 🔥</button></div></div>
      {showSubject && <Modal title="Thêm môn học" onClose={() => setShowSubject(false)}><form onSubmit={addSubject}><label>Tên môn học<input autoFocus required maxLength={80} value={subjectName} onChange={event => setSubjectName(event.target.value)} /></label>{(validation || error) && <p role="alert">{validation || error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => setShowSubject(false)}>Hủy</button><button className="primary-button">Thêm môn</button></div></form></Modal>}
    </>
  )
}
