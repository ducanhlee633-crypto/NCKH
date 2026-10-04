import { useState } from 'react'
import { PageIntro, ProgressBar, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import { defaultSubjects } from '../data/subjects'

const stages = [
  { tone: 'blue', icon: '📖', title: 'Nền tảng' },
  { tone: 'mint', icon: '⚡', title: 'Vận dụng' },
  { tone: 'violet', icon: '🚀', title: 'Bứt phá' },
  { tone: 'gold', icon: '🏆', title: 'Về đích' },
]
const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
export default function RoadmapPage({ onNavigate }) {
  const [roadmaps, saveRoadmaps, error] = useStoredState('nhip-hoc-roadmaps', [])
  const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects)
  const [activeId, setActiveId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [validation, setValidation] = useState('')
  const [draft, setDraft] = useState({ title: '', subject: '', startDate: '', endDate: '', time: '19:00', duration: 60, lessons: '' })
  const active = roadmaps.find(item => item.id === activeId) || roadmaps[0]
  const completed = active?.lessons.filter(item => item.done).length || 0
  const progress = active ? Math.round(completed / active.lessons.length * 100) : 0
  const update = (key, value) => setDraft(old => ({ ...old, [key]: value }))
  function openComposer() {
    const today = new Date(); const end = new Date(today); end.setDate(end.getDate() + 27)
    setDraft({ title: '', subject: subjects[0] || '', startDate: dateKey(today), endDate: dateKey(end), time: '19:00', duration: 60, lessons: '' })
    setValidation(''); setShowModal(true)
  }
  function create(event) {
    event.preventDefault()
    const titles = draft.lessons.split('\n').map(title => title.trim()).filter(Boolean)
    const start = new Date(draft.startDate + 'T00:00:00'); const end = new Date(draft.endDate + 'T00:00:00')
    const days = Math.round((end - start) / 86400000) + 1
    const [hour, minute] = draft.time.split(':').map(Number)
    const endMinute = hour * 60 + minute + Number(draft.duration)
    if (!draft.title.trim() || !draft.subject.trim() || !titles.length || !Number.isFinite(days) || days < 1) { setValidation('Điền mục tiêu, môn học, bài học và ngày kết thúc không trước ngày bắt đầu.'); return }
    if (titles.length > days) { setValidation('Cần ít nhất một ngày cho mỗi bài học. Hãy tăng thời hạn hoặc giảm số bài.'); return }
    if (endMinute >= 1440) { setValidation('Buổi học phải kết thúc trước nửa đêm.'); return }
    const lessons = titles.map((title, index) => {
      const date = new Date(start); date.setDate(date.getDate() + (titles.length === 1 ? 0 : Math.floor(index * (days - 1) / (titles.length - 1))))
      return { id: crypto.randomUUID(), title, stage: Math.min(3, Math.floor(index * 4 / titles.length)), date: dateKey(date), start: draft.time, end: String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0'), done: false }
    })
    const item = { id: crypto.randomUUID(), title: draft.title.trim(), subject: draft.subject.trim(), startDate: draft.startDate, endDate: draft.endDate, lessons }
    if (saveRoadmaps(old => [...old, item])) { setActiveId(item.id); setShowModal(false) }
  }
  function toggleLesson(id) { saveRoadmaps(old => old.map(item => item.id === active.id ? { ...item, lessons: item.lessons.map(lesson => lesson.id === id ? { ...lesson, done: !lesson.done } : lesson) } : item)) }
  return <>
    <PageIntro eyebrow="CHIA NHỎ ĐỂ DỄ HỌC" title="Lộ trình học" subtitle="Chia nội dung cần ôn thành từng bài, rồi xếp vào lịch học." action="Tạo lộ trình" onAction={openComposer} />
    {error && <p role="alert">{error}</p>}
    {roadmaps.length > 0 && <div className="roadmap-picker"><label>Lộ trình đang xem<select value={active.id} onChange={event => setActiveId(event.target.value)}>{roadmaps.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button className="delete-button" onClick={() => setDeleting(active)}>Xóa lộ trình</button></div>}
    <SectionCard className="roadmap-hero"><div className="roadmap-copy"><div className="badge-row"><span className="tag gold">{active ? 'ĐÃ THIẾT LẬP' : 'CHƯA KÍCH HOẠT'}</span><span className="tag blue">{active?.subject || 'Chưa chọn môn học'}</span></div><h2>{active?.title || 'Chưa có lộ trình'}</h2><div className="chapter-progress"><div><b>{completed} / {active?.lessons.length || 0} bài học hoàn thành</b><strong>{progress}%</strong></div><ProgressBar value={progress} /></div><div className="roadmap-bottom"><span>{active ? active.startDate.split('-').reverse().join('/') + ' – ' + active.endDate.split('-').reverse().join('/') : 'Thêm mục tiêu và các bài học để bắt đầu.'}</span><button className="primary-button" onClick={active ? () => onNavigate('schedule') : openComposer}>{active ? 'Xem trong lịch' : '+ Tạo lộ trình'}</button></div></div><div className="roadmap-score"><div className="score-ring"><strong>{progress}%</strong><span>🎯<br />Tiến độ mục tiêu</span></div></div></SectionCard>
    <div className="section-heading"><h2>🗺️ Cấu trúc 4 chặng lộ trình</h2></div>
    <div className="stage-grid">{stages.map((stage, index) => {
      const lessons = active?.lessons.filter(item => item.stage === index) || []
      const done = lessons.filter(item => item.done).length
      return <SectionCard className={'stage-card ' + stage.tone} key={stage.title}><div className="stage-top"><span>Chặng {index + 1}</span><small>{lessons.length && done === lessons.length ? 'Hoàn thành' : 'Chưa hoàn thành'}</small></div><div className="stage-icon">{stage.icon}</div><h3>{stage.title}</h3><ProgressBar value={lessons.length ? done / lessons.length * 100 : 0} tone={stage.tone} /><p>{done}/{lessons.length} bài học</p><div className="roadmap-lessons">{lessons.map(lesson => <label key={lesson.id}><input type="checkbox" checked={lesson.done} onChange={() => toggleLesson(lesson.id)} /><span>{lesson.title}<small>{lesson.date.split('-').reverse().join('/')} · {lesson.start}–{lesson.end}</small></span></label>)}</div></SectionCard>
    })}</div>
    {showModal && <Modal title="Thiết lập lộ trình" onClose={() => setShowModal(false)}><form onSubmit={create}><label>Tên mục tiêu<input autoFocus required maxLength={160} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="Ví dụ: Ôn thi Toán học kỳ I" /></label><label>Môn học<input required maxLength={80} list="roadmap-subjects" value={draft.subject} onChange={event => update('subject', event.target.value)} placeholder="Ví dụ: Toán, Ngữ văn, Tiếng Anh" /><datalist id="roadmap-subjects">{[...new Set([...subjects, 'Toán', 'Ngữ văn', 'Tiếng Anh'])].map(subject => <option key={subject} value={subject} />)}</datalist></label><div className="composer-times"><label>Ngày bắt đầu<input required type="date" value={draft.startDate} onChange={event => update('startDate', event.target.value)} /></label><label>Ngày kết thúc<input required type="date" min={draft.startDate} value={draft.endDate} onChange={event => update('endDate', event.target.value)} /></label></div><div className="composer-times"><label>Giờ học<input required type="time" value={draft.time} onChange={event => update('time', event.target.value)} /></label><label>Số phút mỗi bài<input required type="number" min="5" max="240" value={draft.duration} onChange={event => update('duration', event.target.value)} /></label></div><label>Các bài học theo thứ tự (mỗi dòng một bài)<textarea required rows={6} maxLength={10000} value={draft.lessons} onChange={event => update('lessons', event.target.value)} placeholder={'Ôn kiến thức nền tảng\nLuyện bài tập cơ bản\nGiải đề tổng hợp\nÔn tập cuối kỳ'} /></label><p>Các bài được chia theo thứ tự vào 4 chặng và phân bố đều từ ngày bắt đầu đến ngày kết thúc, mỗi ngày tối đa một bài.</p>{(validation || error) && <p role="alert">{validation || error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={() => setShowModal(false)}>Hủy</button><button className="primary-button">Tạo và xếp lộ trình</button></div></form></Modal>}
    {deleting && <Modal title="Xóa lộ trình" onClose={() => setDeleting(null)}><p>Xóa “{deleting.title}” và các buổi học tương ứng trong lịch?</p>{error && <p role="alert">{error}</p>}<div className="composer-actions"><button className="ghost-button" onClick={() => setDeleting(null)}>Hủy</button><button className="primary-button" onClick={() => { if (saveRoadmaps(old => old.filter(item => item.id !== deleting.id))) setDeleting(null) }}>Xóa lộ trình</button></div></Modal>}
  </>
}
