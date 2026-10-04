// Logic lặp lại kiểu Google Calendar dùng chung giữa SchedulePage
// (hiển thị local) và đồng bộ server (Supabase qua backend).
// File thuần JS để backendApi.test.js (node:test) cũng import được.

export const repeatOptions = [
  ['none', 'Không lặp lại'],
  ['daily', 'Hằng ngày'],
  ['weekly', 'Hằng tuần (cùng thứ)'],
  ['weekdays', 'Thứ 2 → Thứ 6'],
  ['weekends', 'Cuối tuần (T7, CN)'],
  ['custom', 'Tùy chọn ngày trong tuần…'],
  ['monthly', 'Hằng tháng (cùng ngày)'],
]
export const repeatLabels = Object.fromEntries(repeatOptions)
// Thứ tự hiển thị T2..CN, giá trị là JS getDay()
export const weekdayOptions = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [0, 'CN']]

export const keyOf = date =>
  date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
export const parseKey = key => new Date(key + 'T00:00:00')
export const shortDateLabel = key => {
  const [, m, d] = key.split('-')
  return d + '/' + m
}
/** Mặc định lặp liên tục đến hết năm của ngày bắt đầu. */
export function endOfYearKey(startKey) {
  return parseKey(startKey).getFullYear() + '-12-31'
}
export function defaultRepeatUntil(startKey) {
  return endOfYearKey(startKey)
}

export function expandRepeatDates(startKey, repeat, repeatDays, repeatUntil) {
  if (!startKey || !repeat || repeat === 'none') return startKey ? [startKey] : []
  const start = parseKey(startKey)
  // Mặc định lặp liên tục đến hết năm của ngày bắt đầu
  const yearEnd = parseKey(endOfYearKey(startKey))
  let end = repeatUntil ? parseKey(repeatUntil) : yearEnd
  if (!repeatUntil) end = yearEnd
  if (Number.isNaN(end.getTime()) || end < start) return [startKey]
  if (end > yearEnd) end = yearEnd
  const picked = new Set(Array.isArray(repeatDays) ? repeatDays : [])
  const out = [startKey]
  const cursor = new Date(start)
  cursor.setDate(cursor.getDate() + 1)
  while (cursor <= end && out.length < 366) {
    const dow = cursor.getDay()
    const diff = Math.round((cursor - start) / 86400000)
    let include = false
    if (repeat === 'daily') include = true
    else if (repeat === 'weekly') include = diff % 7 === 0
    else if (repeat === 'weekdays') include = dow >= 1 && dow <= 5
    else if (repeat === 'weekends') include = dow === 0 || dow === 6
    else if (repeat === 'custom') include = picked.has(dow)
    else if (repeat === 'monthly') include = cursor.getDate() === start.getDate()
    if (include) out.push(keyOf(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

const hhmm = value => String(value || '').slice(0, 5)

export function repeatSummary(event) {
  if (!event || !event.repeatId || !event.repeat || event.repeat === 'none') return ''
  const base = repeatLabels[event.repeat] || 'Lặp lại'
  if (event.repeat === 'custom' && Array.isArray(event.repeatDays)) {
    const names = weekdayOptions.filter(([v]) => event.repeatDays.includes(v)).map(([, l]) => l).join(', ')
    return base + ' (' + names + ')'
  }
  return base
}

/** Một dòng schedule_blocks trên server -> các buổi hiển thị trên lịch. */
export function serverRowToOccurrences(row) {
  if (!row) return []
  const repeat = row.repeat || 'none'
  const dates = expandRepeatDates(row.date, repeat, row.repeat_days, row.repeat_until)
  const exdates = new Set((row.exdates || []).map(String))
  const recurring = repeat !== 'none'
  return dates
    .filter(date => !exdates.has(date))
    .map(date => ({
      id: recurring ? row.id + ':' + date : row.id,
      serverId: row.id,
      title: row.title,
      subject: row.subject || '',
      date,
      start: hhmm(row.start_time),
      end: hhmm(row.end_time),
      tone: row.tone || 'blue',
      kind: row.kind || 'study',
      repeat,
      repeatDays: row.repeat_days || [],
      repeatUntil: row.repeat_until || null,
      ...(recurring ? { repeatId: row.id } : {}),
    }))
}

/** Nhiều dòng server -> eventMap { 'YYYY-MM-DD': [buổi] } như localStorage. */
export function serverRowsToEventMap(rows) {
  const map = {}
  for (const row of rows || []) {
    for (const item of serverRowToOccurrences(row)) {
      map[item.date] = [...(map[item.date] || []), item]
    }
  }
  return map
}

/** Draft trong EventComposer -> payload POST /api/schedule. */
export function draftToCreatePayload(draft) {
  const repeat = draft.repeat || 'none'
  const payload = {
    title: draft.title.trim(),
    date: draft.date,
    start_time: draft.start,
    end_time: draft.end,
    tone: draft.tone || 'blue',
    repeat,
  }
  if (draft.subject?.trim()) payload.subject = draft.subject.trim()
  if (repeat !== 'none') {
    if (repeat === 'custom') payload.repeat_days = [...(draft.repeatDays || [])]
    if (draft.repeatUntil) payload.repeat_until = draft.repeatUntil
  }
  return payload
}

/** Gom các buổi local (đã materialize) thành payload để migrate 1 lần lên server. */
export function groupLocalForMigration(localMap) {
  const payloads = []
  const series = new Map()
  for (const [date, items] of Object.entries(localMap || {})) {
    for (const item of items || []) {
      if (item.roadmap || item.deadline) continue
      if (item.serverId) continue
      if (item.repeatId) {
        if (!series.has(item.repeatId)) series.set(item.repeatId, [])
        series.get(item.repeatId).push({ ...item, date })
      } else {
        payloads.push({
          title: item.title,
          ...(item.subject?.trim() ? { subject: item.subject.trim() } : {}),
          date,
          start_time: item.start,
          end_time: item.end,
          tone: item.tone || 'blue',
          repeat: 'none',
        })
      }
    }
  }
  for (const items of series.values()) {
    items.sort((a, b) => a.date.localeCompare(b.date))
    const base = items[0]
    const repeat = base.repeat && base.repeat !== 'none' ? base.repeat : 'weekly'
    const payload = {
      title: base.title,
      ...(base.subject?.trim() ? { subject: base.subject.trim() } : {}),
      date: base.date,
      start_time: base.start,
      end_time: base.end,
      tone: base.tone || 'blue',
      repeat,
    }
    if (repeat === 'custom') payload.repeat_days = [...(base.repeatDays || base.repeat_days || [])]
    if (base.repeatUntil || base.repeat_until) payload.repeat_until = base.repeatUntil || base.repeat_until
    payloads.push(payload)
  }
  return payloads
}
