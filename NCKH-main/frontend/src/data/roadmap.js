export const MAX_LESSONS = 120
export const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

export function safeMaterialUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

// Bounded even when a manually entered end date is thousands of years away.
export function buildAvailableDates(start, end, sessionsPerWeek, studyDays = [0, 1, 2, 3, 4, 5, 6], limit = MAX_LESSONS + 1) {
  const per = Number(sessionsPerWeek)
  if (!Number.isFinite(start?.getTime()) || !Number.isFinite(end?.getTime()) || end < start ||
      !Number.isInteger(per) || per < 1 || per > 7 || !Number.isInteger(limit) || limit < 1 ||
      !Array.isArray(studyDays) || studyDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(studyDays).size < per) return []
  const picked = []
  const weekStart = new Date(start)
  while (weekStart <= end && picked.length < limit) {
    const dates = []
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(weekStart)
      day.setDate(day.getDate() + offset)
      if (day <= end && studyDays.includes(day.getDay())) dates.push(day)
    }
    const count = Math.min(per, dates.length)
    for (let slot = 0; slot < count && picked.length < limit; slot += 1) {
      picked.push(dates[Math.floor(slot * dates.length / count)])
    }
    weekStart.setDate(weekStart.getDate() + 7)
  }
  return picked
}

export function validateRoadmapDraft(draft) {
  if (!draft.title.trim() || !draft.subject.trim() || !draft.context.trim()) return { error: 'Điền tên lộ trình, môn học và nội dung cần học.' }
  const start = new Date(draft.startDate + 'T00:00:00')
  const end = new Date(draft.endDate + 'T00:00:00')
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || dateKey(start) !== draft.startDate || dateKey(end) !== draft.endDate || end < start) return { error: 'Chọn ngày hợp lệ; ngày kết thúc không trước ngày bắt đầu.' }
  const duration = Number(draft.duration)
  if (!Number.isInteger(duration) || duration < 5 || duration > 240) return { error: 'Mỗi buổi học từ 5 đến 240 phút, nhập số nguyên.' }
  const per = Number(draft.sessionsPerWeek)
  if (!Number.isInteger(per) || per < 1 || per > 7 || per > new Set(draft.studyDays).size) return { error: 'Chọn đủ ngày rảnh cho số buổi mỗi tuần (1–7 buổi).' }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return { error: 'Chọn giờ học hợp lệ.' }
  const [hour, minute] = draft.time.split(':').map(Number)
  const endMinute = hour * 60 + minute + duration
  if (endMinute >= 1440) return { error: 'Buổi học phải kết thúc trước nửa đêm.' }
  for (const score of [draft.currentScore, draft.targetScore]) {
    if (score !== '' && (!Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 10)) return { error: 'Điểm hiện tại và điểm mục tiêu phải từ 0 đến 10.' }
  }
  const slots = buildAvailableDates(start, end, per, draft.studyDays)
  if (!slots.length) return { error: 'Không có ngày học phù hợp trong khoảng thời gian này.' }
  if (slots.length > MAX_LESSONS) return { error: `Lộ trình vượt ${MAX_LESSONS} buổi. Hãy rút ngắn thời hạn hoặc giảm số buổi mỗi tuần.` }
  return { slots, endLabel: String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0') }
}

export function validateAiPlan(stages, total) {
  const seen = new Set()
  if (!Array.isArray(stages) || !stages.length || stages.length > 5) return false
  for (const stage of stages) {
    if (![stage?.title, stage?.goal, stage?.checkpoint].every(value => typeof value === 'string' && value.trim()) ||
        !Array.isArray(stage.lessons) || !stage.lessons.length || !Array.isArray(stage.materials)) return false
    for (const lesson of stage.lessons) {
      if (![lesson?.title, lesson?.focus].every(value => typeof value === 'string' && value.trim())) return false
      const key = JSON.stringify([lesson.title.trim().toLowerCase(), lesson.focus.trim().toLowerCase()])
      if (seen.has(key)) return false
      seen.add(key)
    }
  }
  return seen.size === total
}
