import { useState } from 'react'
import { CardHeader, PageIntro, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import { defaultSubjects } from '../data/subjects'
import { layoutEvents, minutes } from '../data/calendar'
const dayNames = ['T2','T3','T4','T5','T6','T7','CN']
const palette = ['mint','pink','cyan','yellow','orange','blue']
const viewOptions = [['day','Ngày'],['week','Tuần'],['month','Tháng'],['year','Năm']]
const keyOf = date => date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0')
const startOfWeek = date => { const copy=new Date(date);copy.setDate(copy.getDate()-(copy.getDay()+6)%7);copy.setHours(0,0,0,0);return copy }
const fullDateLabel = date => date.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
function EventPill({event,onRemove}) { return <div className={'event-pill '+event.tone} title={event.title+' '+event.start+'–'+event.end}><b>{event.deadline ? '⚑ ' : ''}{event.title}</b><span>{event.start}–{event.end}</span>{onRemove && <button className="event-remove" aria-label={'Xóa '+event.title} onClick={onRemove}>×</button>}</div> }
export default function SchedulePage() {
 const [roadmaps] = useStoredState('nhip-hoc-roadmaps', [])
 const [view,setView]=useState('month')
 const [anchor,setAnchor]=useState(() => new Date())
 const [eventMap,setEventMap,eventError]=useStoredState('nhip-hoc-events',{})
 const [deadlines,setDeadlines,deadlineError]=useStoredState('nhip-hoc-deadlines',[])
 const [composer,setComposer]=useState(false)
 const [deadlineMode,setDeadlineMode]=useState(false)
 const [selectedDate,setSelectedDate]=useState(null)
 const [draft,setDraft]=useState({title:'',date:keyOf(anchor),start:'14:00',end:'15:30',tone:'blue'})
 const [error,setError]=useState('')
 const calendarMap=Object.fromEntries(Object.entries(eventMap).map(([date,items])=>[date,[...items]]))
 roadmaps.forEach(roadmap => roadmap.lessons.forEach(lesson => { calendarMap[lesson.date] = [...(calendarMap[lesson.date] || []), { ...lesson, title: roadmap.subject + ': ' + lesson.title, roadmap: true, tone: 'violet' }] }))
 deadlines.forEach(item=>{calendarMap[item.date]=[...(calendarMap[item.date]||[]),{...item,deadline:true}]})
 Object.values(calendarMap).forEach(items=>items.sort((a,b)=>a.start.localeCompare(b.start)))
 const sortedDeadlines=[...deadlines].sort((a,b)=>(a.date+a.end).localeCompare(b.date+b.end))
 const upcoming=sortedDeadlines.filter(item=>new Date(item.date+'T'+item.end)>=new Date())
 const sessions=Object.values(calendarMap).flat().filter(item => !item.deadline)
 const totalHours=sessions.reduce((sum,item)=>sum+Math.max(0,minutes(item.end)-minutes(item.start))/60,0)
 const weekEnd=startOfWeek(anchor);weekEnd.setDate(weekEnd.getDate()+6)
 const visibleTitle=view==='year' ? String(anchor.getFullYear()) : view==='day' ? fullDateLabel(anchor) : view==='week' ? fullDateLabel(startOfWeek(anchor))+' – '+fullDateLabel(weekEnd) : anchor.toLocaleDateString('vi-VN',{month:'long',year:'numeric'})
 function openComposer(date=anchor,hour='14:00',deadline=false) {
  const endMinutes=Math.min(minutes(hour)+90,1439)
  setDraft({title:'',date:keyOf(date),start:hour,end:String(Math.floor(endMinutes/60)).padStart(2,'0')+':'+String(endMinutes%60).padStart(2,'0'),tone:deadline?'orange':'blue'})
  setError('');setDeadlineMode(deadline);setComposer(true)
 }
 function move(amount) { const next=new Date(anchor); if(view==='day')next.setDate(next.getDate()+amount);else if(view==='week')next.setDate(next.getDate()+amount*7);else if(view==='month'){next.setDate(1);next.setMonth(next.getMonth()+amount)}else{next.setDate(1);next.setFullYear(next.getFullYear()+amount)}setAnchor(next) }
 function removeEvent(date,id) { if(deadlines.some(item=>item.id===id))setDeadlines(deadlines.filter(item=>item.id!==id));else setEventMap({...eventMap,[date]:(eventMap[date]||[]).filter(item=>item.id!==id)}) }
 function saveEvent() {
  if(!draft.title.trim() || !draft.date || !draft.start || !draft.end){setError('Hãy điền tên, ngày và giờ.');return}
  if(minutes(draft.end)<=minutes(draft.start)){setError('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');return}
  const item={...draft,title:draft.title.trim(),id:crypto.randomUUID()}
  const saved=deadlineMode ? setDeadlines([...deadlines,item]) : setEventMap({...eventMap,[draft.date]:[...(eventMap[draft.date]||[]),item]})
  if(saved){setAnchor(new Date(draft.date+'T00:00:00'));setComposer(false)}
 }
 return <>
  <PageIntro eyebrow="LỊCH HỌC & DEADLINE" title="Lịch học của bạn" subtitle="Chọn ngày, tuần, tháng hoặc năm để sắp xếp việc học theo nhịp của bạn."><div className="intro-actions"><button className="primary-button" onClick={()=>openComposer()}>＋ Thêm lịch</button><button className="success-button" onClick={()=>openComposer(anchor,'14:00',true)}>＋ Deadline</button></div></PageIntro>
  <div className="summary-grid schedule-stats"><div className="summary-chip blue"><span>TỔNG BUỔI</span><b>{sessions.length}</b></div><div className="summary-chip mint"><span>TỔNG GIỜ</span><b>{totalHours.toFixed(1)}</b></div><div className="summary-chip gold"><span>DEADLINE</span><b>{upcoming.length} sắp tới / {deadlines.length} hạn</b></div></div>
  <SectionCard className="calendar-card"><div className="calendar-toolbar"><div className="calendar-nav"><button className="today-button" onClick={()=>setAnchor(new Date())}>Hôm nay</button><button className="round-button" aria-label="Lùi thời gian" onClick={()=>move(-1)}>‹</button><button className="round-button" aria-label="Tiến thời gian" onClick={()=>move(1)}>›</button><strong>{visibleTitle}</strong></div><div className="view-switcher" role="tablist">{viewOptions.map(([value,label])=><button key={value} role="tab" aria-selected={view===value} className={view===value?'active':''} onClick={()=>setView(value)}>{label}</button>)}</div></div>
  {view==='month' && <MonthView anchor={anchor} eventMap={calendarMap} onSelect={setSelectedDate} />}
  {view==='week' && <WeekView anchor={anchor} eventMap={calendarMap} onAdd={openComposer} onRemove={removeEvent} />}
  {view==='day' && <DayView anchor={anchor} eventMap={calendarMap} onAdd={openComposer} onRemove={removeEvent} />}
  {view==='year' && <YearView anchor={anchor} eventMap={calendarMap} onSelect={date=>{setAnchor(date);setView('month')}} />}</SectionCard>
  <div className="schedule-bottom"><SectionCard className="deadline-card"><CardHeader icon="⚑" title="Deadline" tone="orange" action="Thêm" onAction={()=>openComposer(anchor,'14:00',true)} /><p>{upcoming.length} hạn sắp tới / {deadlines.length} hạn tổng cộng</p><DeadlineList items={sortedDeadlines} onRemove={removeEvent} /></SectionCard></div>
  {(eventError || deadlineError) && <p role="alert">{eventError || deadlineError}</p>}
  {selectedDate && <Modal title={fullDateLabel(selectedDate)} onClose={()=>setSelectedDate(null)}><DayView anchor={selectedDate} eventMap={calendarMap} onAdd={(date,hour)=>{setSelectedDate(null);openComposer(date,hour)}} onRemove={removeEvent} /><button className="primary-button" onClick={()=>{setSelectedDate(null);openComposer(selectedDate)}}>＋ Thêm lịch</button></Modal>}
  {composer && <EventComposer draft={draft} setDraft={setDraft} deadlineMode={deadlineMode} error={error || eventError || deadlineError} onClose={()=>setComposer(false)} onSave={saveEvent} />}
 </>
}
function MonthView({anchor,eventMap,onSelect}) {
 const first=new Date(anchor.getFullYear(),anchor.getMonth(),1);const start=startOfWeek(first)
 const dates=Array.from({length:42},(_,i)=>{const date=new Date(start);date.setDate(start.getDate()+i);return date})
 const all=dates.flatMap(date=>eventMap[keyOf(date)]||[])
 const startHour=Math.min(7,...all.map(event=>Math.floor(minutes(event.start)/60)))
 const endHour=Math.max(22,...all.map(event=>Math.ceil(minutes(event.end)/60)))
 return <div className="month-calendar month-timed"><div className="weekday-row">{dayNames.map(day=><b key={day}>{day}</b>)}</div><div className="month-grid">{dates.map(date=><button className={'month-cell '+(date.getMonth()===anchor.getMonth()?'':'muted-cell ')+(keyOf(date)===keyOf(new Date())?'selected-date':'')} key={keyOf(date)} onClick={()=>onSelect(date)} aria-label={'Xem lịch '+fullDateLabel(date)}><div className="date-number">{date.getDate()}</div><div className="month-timeline" style={{height:(endHour-startHour)*24}}>{Array.from({length:endHour-startHour},(_,i)=><span className="month-hour" style={{top:i*24}} key={i}>{String(i+startHour).padStart(2,'0')}</span>)}{layoutEvents(eventMap[keyOf(date)]||[]).map(({event,lane,lanes})=><div className="month-timed-event" key={event.id} style={{top:(minutes(event.start)-startHour*60)*0.4,height:(minutes(event.end)-minutes(event.start))*0.4,left:'calc(18px + (100% - 18px) * '+lane/lanes+')',width:'calc((100% - 18px) / '+lanes+')'}}><EventPill event={event} /></div>)}</div></button>)}</div></div>
}
function WeekView({anchor,...props}) {const start=startOfWeek(anchor);const dates=Array.from({length:7},(_,i)=>{const date=new Date(start);date.setDate(start.getDate()+i);return date});return <TimeCalendar dates={dates} {...props} />}
function DayView({anchor,...props}) {return <TimeCalendar dates={[anchor]} {...props} />}
function TimeCalendar({dates,eventMap,onAdd,onRemove}) {
 const all=dates.flatMap(date=>eventMap[keyOf(date)]||[])
 const startHour=Math.min(7,...all.map(event=>Math.floor(minutes(event.start)/60)))
 const endHour=Math.max(22,...all.map(event=>Math.ceil(minutes(event.end)/60)))
 const hours=Array.from({length:endHour-startHour},(_,i)=>startHour+i)
 return <div className="timeline-scroll"><div className={'timeline '+(dates.length>1?'timeline-week':'')} style={{'--days':dates.length}}><div className="timeline-heading"><span />{dates.map(date=><b key={keyOf(date)}>{dayNames[(date.getDay()+6)%7]} {date.getDate()}/{date.getMonth()+1}</b>)}</div><div className="timeline-body"><div className="timeline-labels">{hours.map(hour=><span key={hour}>{String(hour).padStart(2,'0')}:00</span>)}</div>{dates.map(date=><div className="timeline-column" key={keyOf(date)} style={{height:hours.length*72}}>{hours.map(hour=><button key={hour} className="timeline-slot" aria-label={'Thêm lịch '+keyOf(date)+' lúc '+hour+':00'} onClick={()=>onAdd(date,String(hour).padStart(2,'0')+':00')} />)}{layoutEvents(eventMap[keyOf(date)]||[]).map(({event,lane,lanes})=><div className="timeline-event" key={event.id} style={{top:(minutes(event.start)-startHour*60)*1.2,height:(minutes(event.end)-minutes(event.start))*1.2,left:'calc('+(lane/lanes*100)+'% + 2px)',width:'calc('+(100/lanes)+'% - 4px)'}}><EventPill event={event} onRemove={event.roadmap ? undefined : ()=>onRemove(keyOf(date),event.id)} /></div>)}</div>)}</div></div></div>
}
function DeadlineList({items,onRemove}) {return <div className="deadline-list">{items.length?items.map(item=><div className="deadline-item" key={item.id}><div><b>{item.title}</b><small>{item.date.split('-').reverse().join('/')} · {item.start}–{item.end}</small></div><button className="deadline-remove" aria-label={'Xóa deadline '+item.title} onClick={()=>onRemove(item.date,item.id)}>×</button></div>):<p>Chưa có deadline nào.</p>}</div>}
function YearView({ anchor, eventMap, onSelect }) { return <div className="year-grid">{Array.from({ length: 12 }, (_, month) => { const date = new Date(anchor.getFullYear(), month, 1); const days = new Date(anchor.getFullYear(), month + 1, 0).getDate(); return <button className="year-month" key={month} onClick={() => onSelect(date)}><b>{date.toLocaleDateString('vi-VN', { month: 'long' })}</b><div className="mini-week">{dayNames.map((day) => <span key={day}>{day.slice(1)}</span>)}</div><div className="mini-days">{Array.from({ length: days }, (_, day) => { const key = keyOf(new Date(anchor.getFullYear(), month, day + 1)); return <i className={(eventMap[key] || []).length ? 'has-events' : ''} key={day}>{day + 1}</i> })}</div></button> })}</div> }

function EventComposer({draft,setDraft,onClose,onSave,deadlineMode,error}) {const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects); return <Modal title={deadlineMode?'Thêm deadline':'Thêm lịch'} onClose={onClose}><form onSubmit={event=>{event.preventDefault();onSave()}}><label>Tên {deadlineMode?'deadline':'sự kiện'}<input autoFocus required maxLength={160} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} /></label><label>Môn học{deadlineMode ? <input maxLength={80} value={draft.subject || ''} onChange={event=>setDraft({...draft,subject:event.target.value})} placeholder="Nhập tên môn học" /> : <select value={draft.subject || ''} onChange={event=>setDraft({...draft,subject:event.target.value})}><option value="">Chưa chọn môn</option>{subjects.map(subject=><option key={subject}>{subject}</option>)}</select>}</label><label>Ngày<input required type="date" value={draft.date} onChange={event=>setDraft({...draft,date:event.target.value})} /></label><div className="composer-times"><label>Bắt đầu<input required type="time" value={draft.start} onChange={event=>setDraft({...draft,start:event.target.value})} /></label><label>{deadlineMode?'Hạn chót':'Kết thúc'}<input required type="time" value={draft.end} onChange={event=>setDraft({...draft,end:event.target.value})} /></label></div><label>Màu lịch<select value={draft.tone} onChange={event=>setDraft({...draft,tone:event.target.value})}>{palette.map(tone=><option key={tone}>{tone}</option>)}</select></label>{error && <p role="alert">{error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button">{deadlineMode?'Lưu deadline':'Lưu lịch'}</button></div></form></Modal>}
