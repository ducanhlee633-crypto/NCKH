import assert from 'node:assert/strict'
import { test } from 'node:test'
import api, { generateRoadmapPlan } from './backendApi.js'

const payload = { subject: 'Toán', context: 'Ôn thi', totalSessions: 1, learnerProfile: { grade: 9 }, notes: 'Nghỉ ngắn' }
const plan = { stages: [{ title: 'Ôn tập', goal: 'Giải được bài', checkpoint: 'Đạt 4/5 câu', materials: [{ label: 'Sai', url: 'javascript:alert(1)' }], lessons: [{ title: 'Buổi 1', focus: 'Luyện tập', material_url: 'javascript:alert(1)' }] }] }

test('truyền hồ sơ, AbortSignal, timeout và loại link nguy hiểm', async () => {
  const controller = new AbortController()
  api.defaults.adapter = async config => {
    assert.deepEqual(JSON.parse(config.data), payload)
    assert.equal(config.signal, controller.signal)
    assert.equal(config.timeout, 210000)
    return { data: plan, status: 200, config, headers: {} }
  }
  const result = await generateRoadmapPlan(payload, { signal: controller.signal })
  assert.deepEqual(result.stages[0].materials, [])
  assert.equal(result.stages[0].lessons[0].material_url, '')
})

test('không tự sửa số buổi sai thành số hợp lệ', async () => {
  api.defaults.adapter = () => assert.fail('Không được gọi API')
  for (const totalSessions of [0, -1, 121, 1.5, undefined]) {
    await assert.rejects(generateRoadmapPlan({ ...payload, totalSessions }), error => typeof error.friendlyMessage === 'string')
  }
})

test('bản thiếu buổi bị từ chối trước khi trang lưu', async () => {
  api.defaults.adapter = async config => ({ data: plan, status: 200, config, headers: {} })
  await assert.rejects(generateRoadmapPlan({ ...payload, totalSessions: 2 }), error => /thiếu hoặc trùng/.test(error.friendlyMessage))
})

test('lỗi validation trả chuỗi hiển thị được, không render object', async () => {
  api.defaults.adapter = async () => { throw { response: { status: 422, data: { detail: [{ loc: ['body', 'duration'], msg: 'invalid' }] } } } }
  await assert.rejects(generateRoadmapPlan(payload), error => typeof error.friendlyMessage === 'string')
})

test('yêu cầu bị hủy không bị đổi thành lỗi AI', async () => {
  const controller = new AbortController()
  controller.abort()
  api.defaults.adapter = () => assert.fail('Không được gọi API')
  await assert.rejects(generateRoadmapPlan(payload, { signal: controller.signal }), error => error.code === 'ERR_CANCELED' && !error.friendlyMessage)
})
