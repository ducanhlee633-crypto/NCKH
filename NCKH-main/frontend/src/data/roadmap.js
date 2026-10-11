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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return h * 60 + m
}

// Validate lộ trình TỰ TẠO: người học nhập tay từng chặng + từng buổi,
// mỗi buổi tự chọn ngày/giờ. Giữ cùng giới hạn Supabase như AI:
// tối đa 5 chặng, 120 buổi, link http(s).
export function validateManualDraft({ draft = {}, stages = [], lessons = [] } = {}) {
  if (!String(draft.title || '').trim() || !String(draft.subject || '').trim() || !String(draft.context || '').trim()) {
    return { error: 'Điền tên lộ trình, môn học và nội dung cần học.' }
  }
  for (const score of [draft.currentScore, draft.targetScore]) {
    if (score !== '' && score !== null && score !== undefined && (!Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 10)) {
      return { error: 'Điểm hiện tại và điểm mục tiêu phải từ 0 đến 10.' }
    }
  }
  if (!Array.isArray(stages) || !stages.length) return { error: 'Hãy thêm ít nhất 1 chặng cho lộ trình tự tạo.' }
  if (stages.length > 5) return { error: 'Lộ trình tự tạo tối đa 5 chặng.' }
  const cleanStages = []
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i] || {}
    const title = String(stage.title || '').trim()
    const goal = String(stage.goal || '').trim()
    const checkpoint = String(stage.checkpoint || '').trim()
    if (!title) return { error: `Chặng ${i + 1}: hãy nhập tên chặng.` }
    if (title.length > 160) return { error: `Chặng ${i + 1}: tên chặng tối đa 160 ký tự.` }
    if (goal.length > 800) return { error: `Chặng ${i + 1}: mục tiêu chặng tối đa 800 ký tự.` }
    if (checkpoint.length > 800) return { error: `Chặng ${i + 1}: checkpoint tối đa 800 ký tự.` }
    const materials = Array.isArray(stage.materials) ? stage.materials : []
    if (materials.length > 3) return { error: `Chặng ${i + 1}: tối đa 3 tài liệu.` }
    const cleanMaterials = []
    for (const item of materials) {
      const url = String(item?.url || '').trim()
      if (!url) continue
      if (!safeMaterialUrl(url)) return { error: `Chặng ${i + 1}: link tài liệu không hợp lệ (chỉ nhận http/https).` }
      cleanMaterials.push({ label: String(item?.label || url).trim().slice(0, 200) || url, url: safeMaterialUrl(url) })
    }
    cleanStages.push({ title, goal, checkpoint, materials: cleanMaterials })
  }
  if (!Array.isArray(lessons) || !lessons.length) return { error: 'Hãy thêm ít nhất 1 buổi học cho lộ trình tự tạo.' }
  if (lessons.length > MAX_LESSONS) return { error: `Lộ trình vượt ${MAX_LESSONS} buổi. Hãy bớt buổi học.` }
  const cleanLessons = []
  const dates = []
  for (let j = 0; j < lessons.length; j += 1) {
    const lesson = lessons[j] || {}
    const title = String(lesson.title || '').trim()
    const focus = String(lesson.focus || '').trim()
    if (!title) return { error: `Buổi ${j + 1}: hãy nhập tên buổi học.` }
    if (title.length > 160) return { error: `Buổi ${j + 1}: tên buổi tối đa 160 ký tự.` }
    if (focus.length > 600) return { error: `Buổi ${j + 1}: mục tiêu buổi tối đa 600 ký tự.` }
    const date = String(lesson.date || '')
    if (!DATE_RE.test(date)) return { error: `Buổi ${j + 1}: chọn ngày học hợp lệ.` }
    const parsed = new Date(date + 'T00:00:00')
    if (!Number.isFinite(parsed?.getTime()) || dateKey(parsed) !== date) return { error: `Buổi ${j + 1}: chọn ngày học hợp lệ.` }
    const start = String(lesson.start || '')
    const end = String(lesson.end || '')
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { error: `Buổi ${j + 1}: chọn giờ bắt đầu/kết thúc hợp lệ.` }
    if (toMinutes(end) <= toMinutes(start)) return { error: `Buổi ${j + 1}: giờ kết thúc phải sau giờ bắt đầu.` }
    const stage = Number(lesson.stage ?? lesson.stage_index ?? 0)
    if (!Number.isInteger(stage) || stage < 0 || stage >= cleanStages.length) {
      return { error: `Buổi ${j + 1}: chặng vượt quá số chặng của lộ trình.` }
    }
    const materialUrl = String(lesson.materialUrl ?? lesson.material_url ?? '').trim()
    if (materialUrl && !safeMaterialUrl(materialUrl)) {
      return { error: `Buổi ${j + 1}: link tài liệu không hợp lệ (chỉ nhận http/https).` }
    }
    const materialLabel = String(lesson.materialLabel ?? lesson.material_label ?? '').trim().slice(0, 200)
    dates.push(date)
    cleanLessons.push({
      title, focus, stage, date, start, end,
      materialUrl: materialUrl ? safeMaterialUrl(materialUrl) : '',
      materialLabel,
    })
  }
  const sortedDates = [...dates].sort()
  const startDate = sortedDates[0]
  const endDate = sortedDates[sortedDates.length - 1]
  // study_days = các thứ unique từ buổi học để qua được check backend.
  const weekdays = [...new Set(sortedDates.map(d => new Date(d + 'T00:00:00').getDay()))].sort((a, b) => a - b)
  const studyDays = weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6]
  // sessions_per_week ≈ buổi / số tuần, kẹp 1..7 và ≤ số ngày rảnh.
  const daySpan = Math.max(0, Math.round((new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / 86400000))
  const weeks = Math.max(1, Math.ceil((daySpan + 1) / 7))
  const perWeek = Math.min(7, Math.max(1, Math.ceil(cleanLessons.length / weeks)))
  const sessionsPerWeek = Math.min(perWeek, Math.max(1, studyDays.length))
  // Giờ + thời lượng tổng: ưu tiên draft hợp lệ, thiếu thì suy từ buổi học.
  const time = TIME_RE.test(draft.time) ? draft.time : (() => {
    const counts = {}
    cleanLessons.forEach(item => { counts[item.start] = (counts[item.start] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '19:00'
  })()
  const duration = Number.isInteger(Number(draft.duration)) && Number(draft.duration) >= 5 && Number(draft.duration) <= 240
    ? Number(draft.duration)
    : (() => {
      const first = cleanLessons[0]
      const diff = toMinutes(first.end) - toMinutes(first.start)
      return diff >= 5 && diff <= 240 ? diff : 60
    })()
  return { stages: cleanStages, lessons: cleanLessons, startDate, endDate, studyDays, sessionsPerWeek, time, duration }
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
