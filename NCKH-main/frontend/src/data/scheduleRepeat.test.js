import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  draftToCreatePayload,
  expandRepeatDates,
  groupLocalForMigration,
  serverRowsToEventMap,
} from './scheduleRepeat.js'

test('expand hằng tuần mặc định kéo dài đến 31/12', () => {
  const dates = expandRepeatDates('2026-10-05', 'weekly', [], null)
  assert.equal(dates[0], '2026-10-05')
  assert.equal(dates.at(-1), '2026-12-28')
  assert.equal(dates.length, 13)
})

test('server row -> occurrences, exdates bị loại', () => {
  const map = serverRowsToEventMap([
    {
      id: 'r1', title: 'Toán', subject: null, date: '2026-10-05',
      start_time: '14:00:00', end_time: '15:30:00', tone: 'blue', kind: 'study',
      repeat: 'weekly', repeat_days: [], repeat_until: '2026-10-19', exdates: ['2026-10-12'],
    },
    {
      id: 'r2', title: 'Lẻ', subject: null, date: '2026-10-06',
      start_time: '08:00', end_time: '09:00', tone: 'pink', kind: 'study',
      repeat: 'none', repeat_days: [], repeat_until: null, exdates: [],
    },
  ])
  assert.deepEqual(Object.keys(map).sort(), ['2026-10-05', '2026-10-06', '2026-10-19'])
  assert.equal(map['2026-10-05'][0].serverId, 'r1')
  assert.equal(map['2026-10-05'][0].repeatId, 'r1')
  assert.equal(map['2026-10-06'][0].id, 'r2')
  assert.equal(map['2026-10-06'][0].start, '08:00')
  assert.ok(!('repeatId' in map['2026-10-06'][0]))
})

test('draft -> payload POST, custom giữ repeat_days', () => {
  const payload = draftToCreatePayload({
    title: '  Anh  ', subject: 'TA', date: '2026-10-05',
    start: '08:00', end: '09:00', tone: 'mint',
    repeat: 'custom', repeatDays: [1, 3], repeatUntil: '2026-12-31',
  })
  assert.deepEqual(payload, {
    title: 'Anh', subject: 'TA', date: '2026-10-05',
    start_time: '08:00', end_time: '09:00', tone: 'mint',
    repeat: 'custom', repeat_days: [1, 3], repeat_until: '2026-12-31',
  })
  const single = draftToCreatePayload({
    title: 'Lẻ', date: '2026-10-05', start: '08:00', end: '09:00', repeat: 'none',
  })
  assert.equal(single.repeat, 'none')
  assert.ok(!('repeat_until' in single))
})

test('gom lịch local materialize thành series để migrate', () => {
  const payloads = groupLocalForMigration({
    '2026-10-05': [{ id: 'a', title: 'Toán', start: '14:00', end: '15:30', tone: 'blue', repeat: 'weekly', repeatId: 'g1', repeatUntil: '2026-12-31' }],
    '2026-10-12': [{ id: 'b', title: 'Toán', start: '14:00', end: '15:30', tone: 'blue', repeat: 'weekly', repeatId: 'g1', repeatUntil: '2026-12-31' }],
    '2026-10-06': [{ id: 'c', title: 'Lẻ', start: '08:00', end: '09:00', tone: 'pink', repeat: 'none' }],
  })
  assert.equal(payloads.length, 2)
  const series = payloads.find(p => p.repeat === 'weekly')
  assert.equal(series.date, '2026-10-05')
  assert.equal(series.repeat_until, '2026-12-31')
})
