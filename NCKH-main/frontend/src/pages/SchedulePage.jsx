import { useEffect, useMemo, useState } from 'react'
import { CardHeader, PageIntro, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import useStoredState from '../data/useStoredState'
import { defaultSubjects } from '../data/subjects'
import { calendarEvents, layoutEvents, minutes } from '../data/calendar'
import { createScheduleBlock, deleteScheduleBlock, fetchScheduleBlocks, getSession, onSessionChange, updateScheduleBlock } from '../backendApi'
import { defaultRepeatUntil, draftToCreatePayload, expandRepeatDates, groupLocalForMigration, keyOf, parseKey, repeatOptions, repeatSummary, serverRowsToEventMap, shortDateLabel, weekdayOptions } from '../data/scheduleRepeat'
const dayNames = ['T2','T3','T4','T5','T6','T7','CN']
const palette = ['mint','pink','cyan','yellow','orange','blue']
const viewOptions = [['day','Ngày'],['week','Tuần'],['month','Tháng'],['year','Năm']]
const MIGRATED_KEY = 'nhip-hoc-schedule-migrated'
const startOfWeek = date => { const copy=new Date(date);copy.setDate(copy.getDate()-(copy.getDay()+6)%7);copy.setHours(0,0,0,0);return copy }
const fullDateLabel = date => date.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
const readLocalMap = () => { try { return JSON.parse(localStorage.getItem('nhip-hoc-events')) ?? {} } catch { return {} } }
function EventPill({event,onRemove,onOpen}) { const repeated=Boolean(event.repeatId && event.repeat && event.repeat!=='none'); return <div className={'event-pill '+event.tone+(onOpen?' clickable':'')} role={onOpen?'button':undefined} tabIndex={onOpen?0:undefined} title={event.title+' '+event.start+'–'+event.end+(repeated?' • '+repeatSummary(event):'')} onClick={onOpen?event=>{event.stopPropagation();onOpen()}:undefined} onKeyDown={onOpen?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen()}}:undefined}>{event.deadline ? '⚑ ' : ''}<b>{repeated ? '🔁 ' : ''}{event.title}</b><span>{event.start}–{event.end}</span>{onRemove && <button className="event-remove" aria-label={'Xóa '+event.title} onClick={event=>{event.stopPropagation();onRemove()}}>×</button>}</div> }
export default function SchedulePage() {
 const [roadmaps] = useStoredState('nhip-hoc-roadmaps', [])
 const [view,setView]=useState('month')
 const [anchor,setAnchor]=useState(() => new Date())
 const [localEventMap,setLocalEventMap,localError]=useStoredState('nhip-hoc-events',{})
 const [deadlines,setDeadlines,deadlineError]=useStoredState('nhip-hoc-deadlines',[])
 const [composer,setComposer]=useState(false)
 const [deadlineMode,setDeadlineMode]=useState(false)
 const [selectedDate,setSelectedDate]=useState(null)
 const [pendingDelete,setPendingDelete]=useState(null)
 const [detailEvent,setDetailEvent]=useState(null)
 const [editing,setEditing]=useState(null)
 const [draft,setDraft]=useState({title:'',date:keyOf(anchor),start:'14:00',end:'15:30',tone:'blue',repeat:'none',repeatDays:[],repeatUntil:''})
 const [error,setError]=useState('')
 // --- Đồng bộ server (Supabase): đã đăng nhập -> server là nguồn sự thật,
 // chưa đăng nhập -> giữ localStorage như cũ.
 const [session,setSession]=useState(() => getSession())
 const loggedIn=!!session
 const [serverRows,setServerRows]=useState(null)
 const [syncError,setSyncError]=useState('')
 const loadingSchedule=loggedIn && serverRows===null
 useEffect(() => onSessionChange(next => {
  setSession(next)
  if(!next){ setServerRows(null); setSyncError('') }
 }), [])
 useEffect(() => {
  if(!loggedIn) return
  let mounted=true
  fetchScheduleBlocks()
   .then(async rows => {
    if(!mounted) return
    setSyncError('')
    // Migrate 1 lần duy nhất: đẩy lịch local cũ lên server khi server còn trống.
    if(rows.length===0 && !localStorage.getItem(MIGRATED_KEY)) {
     const payloads=groupLocalForMigration(readLocalMap())
     if(payloads.length) {
      try { for(const payload of payloads){ const created=await createScheduleBlock(payload); rows=[...rows,created] } }
      catch { if(mounted) setSyncError('Không đẩy được lịch cũ lên server. Lịch mới vẫn sẽ lưu online.') }
     }
     try { localStorage.setItem(MIGRATED_KEY,'1') } catch { /* bỏ qua */ }
    }
    if(mounted) setServerRows(rows)
   })
   .catch(() => { if(mounted){setSyncError('Không tải được lịch từ server. Kiểm tra backend và đăng nhập lại.');setServerRows([])} })

  return () => { mounted=false }
 },[loggedIn])
 const serverEventMap=useMemo(() => (loggedIn && serverRows ? serverRowsToEventMap(serverRows) : null),[loggedIn,serverRows])
 const eventMap=serverEventMap ?? localEventMap
 const calendarMap=calendarEvents(eventMap, roadmaps, deadlines)
 const sortedDeadlines=[...deadlines].sort((a,b)=>(a.date+a.end).localeCompare(b.date+b.end))
 const upcoming=sortedDeadlines.filter(item=>new Date(item.date+'T'+item.end)>=new Date())
 const sessions=Object.values(calendarMap).flat().filter(item => !item.deadline)
 const totalHours=sessions.reduce((sum,item)=>sum+Math.max(0,minutes(item.end)-minutes(item.start))/60,0)
 const weekEnd=startOfWeek(anchor);weekEnd.setDate(weekEnd.getDate()+6)
 const visibleTitle=view==='year' ? String(anchor.getFullYear()) : view==='day' ? fullDateLabel(anchor) : view==='week' ? fullDateLabel(startOfWeek(anchor))+' – '+fullDateLabel(weekEnd) : anchor.toLocaleDateString('vi-VN',{month:'long',year:'numeric'})
 function freshDraft(date=anchor,hour='14:00',deadline=false) {
  const endMinutes=Math.min(minutes(hour)+90,1439)
  const dateKey=keyOf(date)
  const dow=parseKey(dateKey).getDay()
  return {title:'',date:dateKey,start:hour,end:String(Math.floor(endMinutes/60)).padStart(2,'0')+':'+String(endMinutes%60).padStart(2,'0'),tone:deadline?'orange':'blue',repeat:'none',repeatDays:[dow],repeatUntil:defaultRepeatUntil(dateKey)}
 }
 function openComposer(date=anchor,hour='14:00',deadline=false) {
  setDraft(freshDraft(date,hour,deadline))
  setError('');setDeadlineMode(deadline);setComposer(true)
 }
 function move(amount) { const next=new Date(anchor); if(view==='day')next.setDate(next.getDate()+amount);else if(view==='week')next.setDate(next.getDate()+amount*7);else if(view==='month'){next.setDate(1);next.setMonth(next.getMonth()+amount)}else{next.setDate(1);next.setFullYear(next.getFullYear()+amount)}setAnchor(next) }
 function directRemove(date,id) { if(deadlines.some(item=>item.id===id))setDeadlines(deadlines.filter(item=>item.id!==id));else setLocalEventMap({...localEventMap,[date]:(localEventMap[date]||[]).filter(item=>item.id!==id)}) }
 function findEvent(date,eventOrId) {
  const id=typeof eventOrId==='object'&&eventOrId!==null?eventOrId.id:eventOrId
  if(typeof eventOrId==='object'&&eventOrId!==null&&eventOrId.id) return eventOrId
  return (eventMap[date]||[]).find(item=>item.id===id) || deadlines.find(item=>item.id===id) || (calendarMap[date]||[]).find(item=>item.id===id) || null
 }
 async function requestRemove(date,eventOrId) {
  const target=findEvent(date,eventOrId)
  if(!target||target.roadmap) { const id=typeof eventOrId==='object'&&eventOrId!==null?eventOrId.id:eventOrId; if(id) directRemove(date,id); return }
  // Bản ghi trên server (có serverId): xóa qua API.
  if(target.serverId && loggedIn && serverRows) {
   if(!target.repeatId) {
    try { await deleteScheduleBlock(target.serverId); setServerRows(rows=>rows.filter(row=>row.id!==target.serverId)) }
    catch(failure){ setSyncError(failure.friendlyMessage || 'Không xóa được buổi học trên server.') }
    return
   }
   setPendingDelete({date,event:target,server:true}); return
  }
  if(!target.repeatId) { directRemove(date,target.id); return }
  setPendingDelete({date,event:target,server:false})
 }
 function removeEvent(date,eventOrId) { requestRemove(date,eventOrId) }
 async function removeSingle() {
  if(!pendingDelete) return
  if(pendingDelete.server) {
   try {
    const updated=await deleteScheduleBlock(pendingDelete.event.serverId,{scope:'single',day:pendingDelete.event.date})
    setServerRows(rows=>rows.map(row=>row.id===updated.id?updated:row));setPendingDelete(null)
   } catch(failure){ setSyncError(failure.friendlyMessage || 'Không xóa được buổi học trên server.') }
   return
  }
  directRemove(pendingDelete.date,pendingDelete.event.id);setPendingDelete(null)
 }
 async function removeSeries() {
  if(!pendingDelete) return
  if(pendingDelete.server) {
   try {
    await deleteScheduleBlock(pendingDelete.event.serverId)
    setServerRows(rows=>rows.filter(row=>row.id!==pendingDelete.event.serverId));setPendingDelete(null)
   } catch(failure){ setSyncError(failure.friendlyMessage || 'Không xóa được chuỗi trên server.') }
   return
  }
  const rid=pendingDelete.event.repeatId
  setDeadlines(deadlines.filter(item=>item.repeatId!==rid))
  const next={}
  Object.entries(localEventMap).forEach(([date,items])=>{ const kept=items.filter(item=>item.repeatId!==rid); if(kept.length) next[date]=kept })
  setLocalEventMap(next)
  setPendingDelete(null)
 }
 function openDetail(event) { if(!event) return; setError(''); setDetailEvent(event) }
 function countSeries(repeatId) { if(!repeatId) return 1; return Object.values(calendarMap).flat().filter(item=>item.repeatId===repeatId).length }
 function deleteFromDetail() { const target=detailEvent; setDetailEvent(null); if(!target||target.roadmap) return; removeEvent(target.date,target) }
 function toEditorDraft(event) { return {title:event.title||'',subject:event.subject||'',date:event.date,start:event.start,end:event.end,tone:event.tone||'blue',repeat:event.repeat||'none',repeatDays:[...(event.repeatDays||[])],repeatUntil:event.repeatUntil||''} }
 // Đếm số buổi còn lại trong chuỗi (để hiển thị trong dialog xóa)
 const seriesCount=pendingDelete ? Object.values(calendarMap).flat().filter(item=>item.repeatId&&item.repeatId===pendingDelete.event.repeatId).length : 0
 async function saveEvent() {
  if(!draft.title.trim() || !draft.date || !draft.start || !draft.end){setError('Hãy điền tên, ngày và giờ.');return}
  if(minutes(draft.end)<=minutes(draft.start)){setError('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');return}
  const repeat=draft.repeat||'none'
  if(repeat!=='none') {
   if(repeat==='custom' && (!draft.repeatDays || draft.repeatDays.length===0)){setError('Hãy chọn ít nhất một ngày trong tuần để lặp lại.');return}
   const until=draft.repeatUntil||defaultRepeatUntil(draft.date)
   if(until<draft.date){setError('Ngày kết thúc lặp lại phải sau ngày bắt đầu.');return}
  }
  // Đã đăng nhập: lưu lên server (Supabase), server tự điền 31/12 nếu thiếu.
  if(loggedIn) {
   if(!serverRows){setError('Đang tải lịch từ server, thử lại sau giây lát.');return}
   try {
    const created=await createScheduleBlock(draftToCreatePayload(draft))
    setServerRows(rows=>[...(rows||[]),created])
    setSyncError('');setAnchor(new Date(draft.date+'T00:00:00'));setComposer(false)
   } catch(failure){ setError(failure.friendlyMessage || 'Không lưu được buổi học lên server.') }
   return
  }
  const untilRaw=repeat==='none' ? null : (draft.repeatUntil||defaultRepeatUntil(draft.date))
  const until=untilRaw && untilRaw>defaultRepeatUntil(draft.date) ? defaultRepeatUntil(draft.date) : untilRaw
  const dates=expandRepeatDates(draft.date,repeat,draft.repeatDays,until)
  if(dates.length>366){setError('Chuỗi lặp lại quá dài (tối đa 366 buổi trong năm).');return}
  const repeatId=dates.length>1 ? crypto.randomUUID() : undefined
  const {repeatDays:pickedDays,...base}=draft
  const items=dates.map(date=>({...base,title:draft.title.trim(),date,id:crypto.randomUUID(),...(repeatId?{repeatId,repeat,repeatUntil:until,...(repeat==='custom'?{repeatDays:[...pickedDays]}:{})}:{repeat:'none'})}))
  const next={...localEventMap}; items.forEach(item=>{ next[item.date]=[...(next[item.date]||[]),item] })
  if(setLocalEventMap(next)){setAnchor(new Date(draft.date+'T00:00:00'));setComposer(false)}
 }
 async function saveEdit(draft,scope) {
  const target=editing?.event
  if(!target) throw {friendlyMessage:'Không tìm thấy buổi cần sửa.'}
  if(!draft.title.trim() || !draft.date || !draft.start || !draft.end) throw {friendlyMessage:'Hãy điền tên, ngày và giờ.'}
  if(minutes(draft.end)<=minutes(draft.start)) throw {friendlyMessage:'Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.'}
  const inSeries=!!target.repeatId
  const effectiveScope=inSeries?scope:'series'
  if(effectiveScope==='series' && target.serverId && (draft.repeat||'none')==='custom' && (!draft.repeatDays||!draft.repeatDays.length)) throw {friendlyMessage:'Hãy chọn ít nhất một ngày trong tuần để lặp lại.'}
  // --- Có server (Supabase): PATCH qua API ---
  if(target.serverId && loggedIn && serverRows) {
   if(effectiveScope==='single' && inSeries) {
    const payload={title:draft.title.trim(),subject:draft.subject?.trim()||null,date:draft.date,start_time:draft.start,end_time:draft.end,tone:draft.tone}
    const child=await updateScheduleBlock(target.serverId,payload,{scope:'single',day:target.date})
    setServerRows(rows=>rows.map(row=>row.id===target.serverId?{...row,exdates:[...(row.exdates||[]),target.date]}:row).concat([child]))
   } else {
    const updated=await updateScheduleBlock(target.serverId,draftToCreatePayload(draft),{scope:'series'})
    setServerRows(rows=>rows.map(row=>row.id===updated.id?updated:row))
   }
   setSyncError('');setEditing(null);setDetailEvent(null);return
  }
  // --- Local (chưa đăng nhập): sửa trực tiếp trong eventMap ---
  const next={...localEventMap}
  const originKey=Object.keys(next).find(key=>(next[key]||[]).some(item=>item.id===target.id))
  if(originKey===undefined) throw {friendlyMessage:'Không tìm thấy buổi cần sửa.'}
  if(effectiveScope==='series' && inSeries) {
   // Chỉ sửa nội dung chung, giữ nguyên ngày + rule (tránh hồi sinh buổi đã xóa lẻ)
   Object.keys(next).forEach(key=>{ next[key]=(next[key]||[]).map(item=>item.repeatId===target.repeatId?{...item,title:draft.title.trim(),subject:draft.subject||'',start:draft.start,end:draft.end,tone:draft.tone}:item) })
  } else {
   const updatedItem={...target,title:draft.title.trim(),subject:draft.subject||'',date:draft.date,start:draft.start,end:draft.end,tone:draft.tone}
   next[originKey]=(next[originKey]||[]).filter(item=>item.id!==target.id)
   if(!next[originKey].length) delete next[originKey]
   next[draft.date]=[...(next[draft.date]||[]),updatedItem]
  }
  if(setLocalEventMap(next)){setEditing(null);setDetailEvent(null)}
 }
 const syncStatus=!loggedIn ? 'Chưa đăng nhập — lịch chỉ lưu trên trình duyệt này.' : loadingSchedule ? 'Đang đồng bộ lịch với server…' : syncError ? syncError : serverRows ? 'Đã lưu lên server ✓ ('+serverRows.length+' chuỗi)' : ''
 return <>
  <PageIntro eyebrow="SẮP XẾP TUẦN HỌC" title="Lịch học của bạn" subtitle="Lịch ở trường, buổi học thêm và hạn nộp bài — xem cùng một chỗ."><div className="intro-actions"><button className="primary-button" onClick={()=>openComposer()}>＋ Thêm lịch</button><button className="success-button" onClick={()=>openComposer(anchor,'14:00',true)}>＋ Hạn nộp</button></div></PageIntro>
  <div className="summary-grid schedule-stats"><div className="summary-chip blue"><span>TỔNG BUỔI</span><b>{sessions.length}</b></div><div className="summary-chip mint"><span>TỔNG GIỜ</span><b>{totalHours.toFixed(1)}</b></div><div className="summary-chip gold"><span>DEADLINE</span><b>{upcoming.length} sắp tới / {deadlines.length} hạn</b></div></div>
  {syncStatus && <p className="repeat-hint" role="status">{syncStatus}</p>}
  <SectionCard className="calendar-card"><div className="calendar-toolbar"><div className="calendar-nav"><button className="today-button" onClick={()=>setAnchor(new Date())}>Hôm nay</button><button className="round-button" aria-label="Lùi thời gian" onClick={()=>move(-1)}>‹</button><button className="round-button" aria-label="Tiến thời gian" onClick={()=>move(1)}>›</button><strong>{visibleTitle}</strong></div><div className="view-switcher" role="tablist">{viewOptions.map(([value,label])=><button key={value} role="tab" aria-selected={view===value} className={view===value?'active':''} onClick={()=>setView(value)}>{label}</button>)}</div></div>
  {view==='month' && <MonthView anchor={anchor} eventMap={calendarMap} onSelect={setSelectedDate} onOpen={openDetail} />}
  {view==='week' && <WeekView anchor={anchor} eventMap={calendarMap} onAdd={openComposer} onRemove={removeEvent} onOpen={openDetail} />}
  {view==='day' && <DayView anchor={anchor} eventMap={calendarMap} onAdd={openComposer} onRemove={removeEvent} onOpen={openDetail} />}
  {view==='year' && <YearView anchor={anchor} eventMap={calendarMap} onSelect={date=>{setAnchor(date);setView('month')}} />}</SectionCard>
  <div className="schedule-bottom"><SectionCard className="deadline-card"><CardHeader icon="⚑" title="Hạn nộp bài" tone="orange" action="Thêm" onAction={()=>openComposer(anchor,'14:00',true)} /><p>{upcoming.length} hạn sắp tới / {deadlines.length} hạn tổng cộng</p><DeadlineList items={sortedDeadlines} onRemove={removeEvent} /></SectionCard></div>
  {(localError || deadlineError) && <p role="alert">{localError || deadlineError}</p>}
  {selectedDate && <Modal title={fullDateLabel(selectedDate)} onClose={()=>setSelectedDate(null)}><DayView anchor={selectedDate} eventMap={calendarMap} onAdd={(date,hour)=>{setSelectedDate(null);openComposer(date,hour)}} onRemove={removeEvent} onOpen={openDetail} /><button className="primary-button" onClick={()=>{setSelectedDate(null);openComposer(selectedDate)}}>＋ Thêm lịch</button></Modal>}
  {composer && <EventComposer draft={draft} setDraft={setDraft} deadlineMode={deadlineMode} error={error || localError || deadlineError} onClose={()=>setComposer(false)} onSave={saveEvent} />}
  {detailEvent && !editing && <EventDetail event={detailEvent} seriesCount={countSeries(detailEvent.repeatId)} onClose={()=>setDetailEvent(null)} onEdit={()=>setEditing({event:detailEvent,scope:detailEvent.repeatId?'single':'series'})} onDelete={deleteFromDetail} />}
  {editing && <EventEditor key={editing.event.id} event={editing.event} initial={toEditorDraft(editing.event)} scope={editing.scope} setScope={scope=>setEditing({...editing,scope})} seriesCount={countSeries(editing.event.repeatId)} canEditRule={!!(editing.event.serverId && loggedIn && serverRows)} onClose={()=>setEditing(null)} onSave={saveEdit} />}
  {pendingDelete && <Modal title="Xóa lịch lặp lại" onClose={()=>setPendingDelete(null)}>
   <p><b>{pendingDelete.event.title}</b> thuộc chuỗi <b>{repeatSummary(pendingDelete.event)}</b> ({seriesCount} buổi). Bạn muốn xóa thế nào?</p>
   <p className="repeat-hint">{pendingDelete.event.date.split('-').reverse().join('/')} · {pendingDelete.event.start}–{pendingDelete.event.end}</p>
   <div className="composer-actions repeat-delete-actions">
    <button type="button" className="ghost-button" onClick={()=>setPendingDelete(null)}>Giữ lại</button>
    <button type="button" className="outline-button" onClick={removeSingle}>Chỉ xóa buổi này</button>
    <button type="button" className="delete-button" onClick={removeSeries}>Xóa toàn bộ chuỗi</button>
   </div>
  </Modal>}
 </>
}
function MonthView({anchor,eventMap,onSelect,onOpen}) {
 const first=new Date(anchor.getFullYear(),anchor.getMonth(),1);const start=startOfWeek(first)
 const dates=Array.from({length:42},(_,i)=>{const date=new Date(start);date.setDate(start.getDate()+i);return date})
 const all=dates.flatMap(date=>eventMap[keyOf(date)]||[])
 const startHour=Math.min(7,...all.map(event=>Math.floor(minutes(event.start)/60)))
 const endHour=Math.max(22,...all.map(event=>Math.ceil(minutes(event.end)/60)))
 return <div className="month-calendar month-timed"><div className="weekday-row">{dayNames.map(day=><b key={day}>{day}</b>)}</div><div className="month-grid">{dates.map(date=><button className={'month-cell '+(date.getMonth()===anchor.getMonth()?'':'muted-cell ')+(keyOf(date)===keyOf(new Date())?'selected-date':'')} key={keyOf(date)} onClick={()=>onSelect(date)} aria-label={'Xem lịch '+fullDateLabel(date)}><div className="date-number">{date.getDate()}</div><div className="month-timeline" style={{height:(endHour-startHour)*24}}>{Array.from({length:endHour-startHour},(_,i)=><span className="month-hour" style={{top:i*24}} key={i}>{String(i+startHour).padStart(2,'0')}</span>)}{layoutEvents(eventMap[keyOf(date)]||[]).map(({event,lane,lanes})=><div className="month-timed-event" key={event.id} style={{top:(minutes(event.start)-startHour*60)*0.4,height:(minutes(event.end)-minutes(event.start))*0.4,left:'calc(18px + (100% - 18px) * '+lane/lanes+')',width:'calc((100% - 18px) / '+lanes+')'}}><EventPill event={event} onOpen={onOpen ? ()=>onOpen(event) : undefined} /></div>)}</div></button>)}</div></div>
}
function WeekView({anchor,...props}) {const start=startOfWeek(anchor);const dates=Array.from({length:7},(_,i)=>{const date=new Date(start);date.setDate(start.getDate()+i);return date});return <TimeCalendar dates={dates} {...props} />}
function DayView({anchor,...props}) {return <TimeCalendar dates={[anchor]} {...props} />}
function TimeCalendar({dates,eventMap,onAdd,onRemove,onOpen}) {
 const all=dates.flatMap(date=>eventMap[keyOf(date)]||[])
 const startHour=Math.min(7,...all.map(event=>Math.floor(minutes(event.start)/60)))
 const endHour=Math.max(22,...all.map(event=>Math.ceil(minutes(event.end)/60)))
 const hours=Array.from({length:endHour-startHour},(_,i)=>startHour+i)
 return <div className="timeline-scroll"><div className={'timeline '+(dates.length>1?'timeline-week':'')} style={{'--days':dates.length}}><div className="timeline-heading"><span />{dates.map(date=><b key={keyOf(date)}>{dayNames[(date.getDay()+6)%7]} {date.getDate()}/{date.getMonth()+1}</b>)}</div><div className="timeline-body"><div className="timeline-labels">{hours.map(hour=><span key={hour}>{String(hour).padStart(2,'0')}:00</span>)}</div>{dates.map(date=><div className="timeline-column" key={keyOf(date)} style={{height:hours.length*72}}>{hours.map(hour=><button key={hour} className="timeline-slot" aria-label={'Thêm lịch '+keyOf(date)+' lúc '+hour+':00'} onClick={()=>onAdd(date,String(hour).padStart(2,'0')+':00')} />)}{layoutEvents(eventMap[keyOf(date)]||[]).map(({event,lane,lanes})=><div className="timeline-event" key={event.id} style={{top:(minutes(event.start)-startHour*60)*1.2,height:(minutes(event.end)-minutes(event.start))*1.2,left:'calc('+(lane/lanes*100)+'% + 2px)',width:'calc('+(100/lanes)+'% - 4px)'}}><EventPill event={event} onOpen={onOpen ? ()=>onOpen(event) : undefined} onRemove={event.roadmap ? undefined : ()=>onRemove(keyOf(date),event)} /></div>)}</div>)}</div></div></div>
}
function DeadlineList({items,onRemove}) {return <div className="deadline-list">{items.length?items.map(item=><div className="deadline-item" key={item.id}><div><b>{item.repeatId ? '🔁 ' : ''}{item.title}</b><small>{item.date.split('-').reverse().join('/')} · {item.start}–{item.end}{item.repeatId ? ' · '+repeatSummary(item) : ''}</small></div><button className="deadline-remove" aria-label={'Xóa hạn nộp '+item.title} onClick={()=>onRemove(item.date,item)}>×</button></div>):<p>Chưa có hạn nộp. Thêm bài tập để theo dõi ngày cần hoàn thành.</p>}</div>}
function YearView({ anchor, eventMap, onSelect }) { return <div className="year-grid">{Array.from({ length: 12 }, (_, month) => { const date = new Date(anchor.getFullYear(), month, 1); const days = new Date(anchor.getFullYear(), month + 1, 0).getDate(); return <button className="year-month" key={month} onClick={() => onSelect(date)}><b>{date.toLocaleDateString('vi-VN', { month: 'long' })}</b><div className="mini-week">{dayNames.map((day) => <span key={day}>{day.slice(1)}</span>)}</div><div className="mini-days">{Array.from({ length: days }, (_, day) => { const key = keyOf(new Date(anchor.getFullYear(), month, day + 1)); return <i className={(eventMap[key] || []).length ? 'has-events' : ''} key={day}>{day + 1}</i> })}</div></button> })}</div> }

function RepeatFields({draft,setDraft}) {
 const repeat=draft.repeat||'none'
 const preview=expandRepeatDates(draft.date,repeat,draft.repeatDays,draft.repeatUntil||defaultRepeatUntil(draft.date||keyOf(new Date())))
 function toggleDay(value) {
  const days=Array.isArray(draft.repeatDays)?draft.repeatDays:[]
  setDraft({...draft,repeatDays:days.includes(value)?days.filter(v=>v!==value):[...days,value].sort((a,b)=>(a===0?7:a)-(b===0?7:b))})
 }
 return <><label>Lặp lại<select value={repeat} onChange={event=>{ const value=event.target.value; const dow=draft.date?parseKey(draft.date).getDay():1; setDraft({...draft,repeat:value,repeatDays:value==='custom'?((draft.repeatDays&&draft.repeatDays.length)?draft.repeatDays:[dow]):draft.repeatDays,repeatUntil:value==='none'?'':(draft.repeatUntil||defaultRepeatUntil(draft.date||keyOf(new Date())))}) }}>{repeatOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{repeat!=='none' && <div className="repeat-box">{repeat==='custom' && <div><span className="repeat-hint">Lặp vào các ngày:</span><div className="repeat-days">{weekdayOptions.map(([value,label])=><button type="button" key={value} aria-pressed={(draft.repeatDays||[]).includes(value)} className={'repeat-day'+((draft.repeatDays||[]).includes(value)?' active':'')} onClick={()=>toggleDay(value)}>{label}</button>)}</div></div>}<label>Lặp đến ngày (mặc định hết năm)<input required={repeat!=='none'} type="date" min={draft.date} max={draft.date?defaultRepeatUntil(draft.date):undefined} value={draft.repeatUntil||(draft.date?defaultRepeatUntil(draft.date):'')} onChange={event=>setDraft({...draft,repeatUntil:event.target.value})} /></label><span className="repeat-hint">Tự động lặp liên tục đến 31/12{ draft.date ? ' ('+draft.date.slice(0,4)+')' : ''} — bạn có thể chọn ngày sớm hơn nếu muốn dừng trước.</span><p className="repeat-preview">Sẽ tạo <b>{preview.length} buổi</b>{preview.length>0 && <> đến 31/12: {preview.slice(0,6).map(shortDateLabel).join(', ')}{preview.length>6 ? ' … đến '+shortDateLabel(preview[preview.length-1]) : ''}</>}</p></div>}</>
}

function EventDetail({event,seriesCount,onClose,onEdit,onDelete}) {
 const inSeries=!!event.repeatId
 const duration=Math.max(0,minutes(event.end)-minutes(event.start))
 const durationLabel=duration>=60 ? Math.floor(duration/60)+' giờ'+(duration%60?' '+(duration%60)+' phút':'') : duration+' phút'
 return <Modal title={event.deadline ? 'Chi tiết hạn nộp' : 'Chi tiết buổi học'} onClose={onClose}>
  <div className="detail-rows">
   <div><span>Tên</span><b>{event.title}</b></div>
   {event.subject && <div><span>Môn học</span><b>{event.subject}</b></div>}
   <div><span>Ngày</span><b>{event.date.split('-').reverse().join('/')}</b></div>
   <div><span>Giờ</span><b>{event.start}–{event.end} ({durationLabel})</b></div>
   <div><span>Lặp lại</span><b>{inSeries ? '🔁 '+repeatSummary(event)+' · '+seriesCount+' buổi' : 'Không lặp lại'}</b></div>
   {!event.deadline && !event.roadmap && <div><span>Lưu trữ</span><b>{event.serverId ? 'Đã lưu lên server ✓' : 'Chỉ trên trình duyệt'}</b></div>}
  </div>
  <div className="composer-actions repeat-delete-actions">
   <button type="button" className="ghost-button" onClick={onClose}>Đóng</button>
   {!event.roadmap && <button type="button" className="delete-button" onClick={onDelete}>Xóa</button>}
   {!event.roadmap && !event.deadline && <button type="button" className="primary-button" onClick={onEdit}>Sửa</button>}
  </div>
 </Modal>
}

function EventEditor({event,initial,scope,setScope,seriesCount,canEditRule,onClose,onSave}) {
 const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects);
 const [draft,setDraft]=useState(initial)
 const [error,setError]=useState('')
 const [saving,setSaving]=useState(false)
 const inSeries=!!event.repeatId
 async function submit(formEvent) {
  formEvent.preventDefault();setSaving(true);setError('')
  try { await onSave(draft,scope) } catch(failure){ setError(failure.friendlyMessage || 'Không lưu được thay đổi. Vui lòng thử lại.');setSaving(false) }
 }
 return <Modal title="Sửa buổi học" onClose={onClose}>
  <form onSubmit={submit}>
   {inSeries && <div className="scope-switch" role="radiogroup" aria-label="Phạm vi sửa"><button type="button" aria-pressed={scope==='single'} className={scope==='single'?'active':''} onClick={()=>setScope('single')}>Chỉ buổi này ({shortDateLabel(event.date)})</button><button type="button" aria-pressed={scope==='series'} className={scope==='series'?'active':''} onClick={()=>setScope('series')}>Cả chuỗi ({seriesCount} buổi)</button></div>}
   <label>Tên buổi học<input autoFocus required maxLength={160} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} /></label>
   <label>Môn học<input maxLength={80} list="schedule-subjects-edit" value={draft.subject || ''} onChange={event=>setDraft({...draft,subject:event.target.value})} placeholder="Ví dụ: Toán, Ngữ văn, Tiếng Anh" /><datalist id="schedule-subjects-edit">{[...new Set([...subjects, 'Toán', 'Ngữ văn', 'Tiếng Anh'])].map(subject=><option key={subject} value={subject} />)}</datalist></label>
   <label>Ngày<input required type="date" value={draft.date} disabled={scope==='series' && !canEditRule} onChange={event=>setDraft({...draft,date:event.target.value})} /></label>
   <div className="composer-times"><label>Bắt đầu<input required type="time" value={draft.start} onChange={event=>setDraft({...draft,start:event.target.value})} /></label><label>Kết thúc<input required type="time" value={draft.end} onChange={event=>setDraft({...draft,end:event.target.value})} /></label></div>
   <label>Màu lịch<select value={draft.tone} onChange={event=>setDraft({...draft,tone:event.target.value})}>{palette.map(tone=><option key={tone}>{tone}</option>)}</select></label>
   {scope==='series' && canEditRule && <RepeatFields draft={draft} setDraft={setDraft} />}
   {scope==='series' && !canEditRule && inSeries && <p className="repeat-hint">🔁 {repeatSummary(event)} — chưa đăng nhập nên chỉ sửa nội dung chung, giữ nguyên ngày và rule lặp lại.</p>}
   {scope==='single' && inSeries && <p className="repeat-hint">Buổi này sẽ tách khỏi chuỗi thành block riêng, chuỗi gốc giữ nguyên.</p>}
   {error && <p role="alert">{error}</p>}
   <div className="composer-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
  </form>
 </Modal>
}

function EventComposer({draft,setDraft,onClose,onSave,deadlineMode,error}) {
 const [subjects] = useStoredState('nhip-hoc-subjects', defaultSubjects);
 const repeat=draft.repeat||'none'
 const preview=expandRepeatDates(draft.date,repeat,draft.repeatDays,draft.repeatUntil||defaultRepeatUntil(draft.date||keyOf(new Date())))
 return <Modal title={deadlineMode?'Thêm hạn nộp':'Thêm lịch'} onClose={onClose}><form onSubmit={event=>{event.preventDefault();onSave()}}><label>Tên {deadlineMode?'bài tập':'buổi học'}<input autoFocus required maxLength={160} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} /></label><label>Môn học{deadlineMode ? <input maxLength={80} value={draft.subject || ''} onChange={event=>setDraft({...draft,subject:event.target.value})} placeholder="Nhập tên môn học" /> : <><input maxLength={80} list="schedule-subjects" value={draft.subject || ''} onChange={event=>setDraft({...draft,subject:event.target.value})} placeholder="Ví dụ: Toán, Ngữ văn, Tiếng Anh" /><datalist id="schedule-subjects">{[...new Set([...subjects, 'Toán', 'Ngữ văn', 'Tiếng Anh'])].map(subject=><option key={subject} value={subject} />)}</datalist></>}</label><label>Ngày<input required type="date" value={draft.date} onChange={event=>{ const nextDate=event.target.value; const dow=nextDate?parseKey(nextDate).getDay():null; setDraft(prev=>{ const eoy=nextDate?defaultRepeatUntil(nextDate):prev.repeatUntil; const keepUntil=prev.repeat&&prev.repeat!=='none'&&nextDate ? (prev.repeatUntil&&prev.repeatUntil>=nextDate&&prev.repeatUntil.slice(0,4)===nextDate.slice(0,4) ? prev.repeatUntil : eoy) : prev.repeatUntil; return {...prev,date:nextDate,repeatDays:prev.repeat==='custom'&&dow!==null&&(!prev.repeatDays||prev.repeatDays.length===0)?[dow]:prev.repeatDays,repeatUntil:keepUntil} }) }} /></label><div className="composer-times"><label>Bắt đầu<input required type="time" value={draft.start} onChange={event=>setDraft({...draft,start:event.target.value})} /></label><label>{deadlineMode?'Giờ nộp':'Kết thúc'}<input required type="time" value={draft.end} onChange={event=>setDraft({...draft,end:event.target.value})} /></label></div><label>Màu lịch<select value={draft.tone} onChange={event=>setDraft({...draft,tone:event.target.value})}>{palette.map(tone=><option key={tone}>{tone}</option>)}</select></label><RepeatFields draft={draft} setDraft={setDraft} />{error && <p role="alert">{error}</p>}<div className="composer-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button">{deadlineMode?'Lưu hạn nộp':'Lưu lịch'}{repeat!=='none' && preview.length>1 ? ' ('+preview.length+' buổi)' : ''}</button></div></form></Modal>}
