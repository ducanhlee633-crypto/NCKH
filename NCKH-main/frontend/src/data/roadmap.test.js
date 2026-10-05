import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAvailableDates, dateKey, safeMaterialUrl, validateAiPlan, validateRoadmapDraft } from './roadmap.js'

const draft = { title: 'Toán học kỳ', subject: 'Toán', context: 'Phương trình', startDate: '2026-10-05', endDate: '2026-10-18', time: '19:00', duration: 60, sessionsPerWeek: 3, studyDays: [1, 3, 5], currentScore: '', targetScore: '' }
const start = value => new Date(value + 'T00:00:00')

test('lịch tuân theo ngày rảnh, đủ buổi và không trùng ngày', () => {
  const result = validateRoadmapDraft(draft)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.slots.map(dateKey), ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16'])
  assert.equal(result.endLabel, '20:00')
})

test('tuần cuối ngắn và khoảng ngày không có ngày rảnh', () => {
  assert.deepEqual(buildAvailableDates(start('2026-10-05'), start('2026-10-05'), 3, [1, 3, 5]).map(dateKey), ['2026-10-05'])
  assert.equal(buildAvailableDates(start('2026-10-10'), start('2026-10-11'), 3, [1, 3, 5]).length, 0)
})

test('ngày sai, số buổi lẻ và ngày rảnh thiếu không được xếp lịch', () => {
  for (const changes of [{ startDate: 'bad' }, { endDate: '2026-02-30' }, { endDate: '2026-10-04' },
    { sessionsPerWeek: 2.5 }, { sessionsPerWeek: 4 }, { studyDays: [] }, { time: '25:00' },
    { time: '23:30' }, { duration: 0 }, { duration: 5.5 }, { currentScore: 11 }, { targetScore: -1 }]) {
    assert.ok(validateRoadmapDraft({ ...draft, ...changes }).error, JSON.stringify(changes))
  }
})

test('khoảng ngày cực dài bị chặn ở 121 buổi', () => {
  const dates = buildAvailableDates(start('2026-10-05'), start('9999-12-31'), 1, [1])
  assert.equal(dates.length, 121)
  assert.match(validateRoadmapDraft({ ...draft, endDate: '9999-12-31' }).error, /120/)
})

test('lộ trình đủ 120 buổi được giữ nguyên', () => {
  const dates = buildAvailableDates(start('2026-01-01'), start('2026-04-30'), 7)
  assert.equal(dates.length, 120)
  assert.equal(dateKey(dates.at(-1)), '2026-04-30')
})

test('chỉ chấp nhận link http(s) không chứa thông tin đăng nhập', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '/relative', null, 'https://name:password@example.com']) assert.equal(safeMaterialUrl(value), '')
  assert.equal(safeMaterialUrl('https://example.com/watch?v=1'), 'https://example.com/watch?v=1')
})

test('bản AI thiếu, trùng, sai cấu trúc không được xem là sẵn sàng', () => {
  const stages = [{ title: 'Nền tảng', goal: 'Giải phương trình', checkpoint: '4/5 câu', materials: [], lessons: [{ title: 'Công thức nghiệm', focus: 'Tự giải 3 bài' }] }]
  assert.equal(validateAiPlan(stages, 1), true)
  assert.equal(validateAiPlan(stages, 2), false)
  assert.equal(validateAiPlan([{ ...stages[0], lessons: [...stages[0].lessons, ...stages[0].lessons] }], 2), false)
  assert.equal(validateAiPlan([{ ...stages[0], lessons: [null] }], 1), false)
  assert.equal(validateAiPlan([{ ...stages[0], materials: {} }], 1), false)
})
