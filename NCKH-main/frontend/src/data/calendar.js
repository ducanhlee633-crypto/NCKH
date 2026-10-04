export const minutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute }
export function calendarEvents(eventMap, roadmaps, deadlines) {
 const calendar = Object.fromEntries(Object.entries(eventMap).map(([date, items]) => [date, [...items]]))
 roadmaps.forEach(roadmap => roadmap.lessons.forEach(lesson => {
  calendar[lesson.date] = [...(calendar[lesson.date] || []), { ...lesson, title: roadmap.subject + ': ' + lesson.title, subject: roadmap.subject, roadmap: true, tone: 'violet' }]
 }))
 deadlines.forEach(item => { calendar[item.date] = [...(calendar[item.date] || []), { ...item, deadline: true }] })
 Object.values(calendar).forEach(items => items.sort((a, b) => a.start.localeCompare(b.start)))
 return calendar
}
// Each connected group of overlapping events shares its available columns.
export function layoutEvents(events) {
 const sorted = [...events].sort((a,b) => minutes(a.start)-minutes(b.start) || minutes(a.end)-minutes(b.end))
 const output = []; let group = []; let ends = []; let groupEnd = -1
 function flush() { group.forEach(item => output.push({...item, lanes:ends.length})); group=[]; ends=[] }
 for(const event of sorted) {
  const start = minutes(event.start); const end = minutes(event.end)
  if(start >= groupEnd) flush()
  let lane = ends.findIndex(value => value <= start)
  if(lane === -1) lane = ends.length
  ends[lane] = end; group.push({event,lane}); groupEnd = Math.max(group.length === 1 ? -1 : groupEnd,end)
 }
 flush(); return output
}
