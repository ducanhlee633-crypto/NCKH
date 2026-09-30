export const minutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute }
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
