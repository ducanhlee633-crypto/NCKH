import assert from 'node:assert/strict'
import { test } from 'node:test'
import api, {
  clearSession,
  createScheduleBlock,
  deleteScheduleBlock,
  displayUser,
  fetchScheduleBlocks,
  getSession,
  loginUser,
  logoutUser,
  registerUser,
  requestPasswordReset,
  changePassword,
  updateScheduleBlock,
  SESSION_KEY,
} from './backendApi.js'

const storage = new Map()
globalThis.sessionStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}
globalThis.window = new EventTarget()

const profile = { id: 'user-1', username: 'minhanh', name: 'Minh Anh' }
const token = {
  access_token: 'sb-access-token',
  refresh_token: 'sb-refresh-token',
  expires_in: 3600,
  user: { id: 'user-1', email: 'minhanh@example.com' },
  profile,
}

test('displayUser ưu tiên tên profile, rồi username, rồi email', () => {
  assert.equal(displayUser(null), null)
  assert.equal(displayUser({ user: { id: 'u', email: 'a@b.co' }, profile: null }).name, 'a')
  assert.equal(displayUser({ user: { id: 'u', email: 'a@b.co' }, profile }).name, 'Minh Anh')
})

test('register, login, request kèm Bearer, hết hạn, và logout — chỉ qua backend', async () => {
  const requests = []
  api.defaults.adapter = async config => {
    requests.push(config)
    if (config.url === '/api/auth/signup') return { data: token, status: 201, headers: {}, config }
    if (config.url === '/api/auth/login') return { data: token, status: 200, headers: {}, config }
    if (config.url === '/api/auth/refresh') {
      return { data: { ...token, access_token: 'sb-access-token-2' }, status: 200, headers: {}, config }
    }
    return { data: {}, status: 200, headers: {}, config }
  }

  // Register gọi backend, không chạm Supabase trực tiếp.
  const created = await registerUser({ email: 'minhanh@example.com', password: 'password123', name: 'Minh Anh', username: 'minhanh' })
  assert.equal(requests[0].url, '/api/auth/signup')
  assert.ok(created.access_token)
  assert.ok(getSession())
  clearSession()

  // Backend không trả session (chờ xác nhận mail) -> báo cần check mail.
  api.defaults.adapter = async config => ({ data: { detail: 'check mail' }, status: 201, headers: {}, config })
  const pending = await registerUser({ email: 'a@b.co', password: 'password123', name: 'A', username: 'a1' })
  assert.equal(pending.needsEmailConfirmation, true)
  assert.equal(getSession(), null)

  api.defaults.adapter = async config => {
    requests.push(config)
    if (config.url === '/api/auth/login') return { data: token, status: 200, headers: {}, config }
    if (config.url === '/api/auth/refresh') {
      return { data: { ...token, access_token: 'sb-access-token-2' }, status: 200, headers: {}, config }
    }
    return { data: {}, status: 200, headers: {}, config }
  }
  await loginUser({ email: 'minhanh@example.com', password: 'password123' })
  assert.deepEqual(getSession().profile, profile)

  // Request authenticated kèm Bearer từ session backend-proxy.
  await api.get('/api/users/me')
  assert.equal(requests.at(-1).headers.Authorization, 'Bearer sb-access-token')

  // 401 + còn refresh_token -> tự refresh qua backend rồi request lại.
  let refreshCalls = 0
  api.defaults.adapter = async config => {
    if (config.url === '/api/auth/refresh') {
      refreshCalls += 1
      return { data: { ...token, access_token: 'sb-access-token-2' }, status: 200, headers: {}, config }
    }
    if (!config._retried) throw { config, response: { status: 401 } }
    return { data: profile, status: 200, headers: {}, config }
  }
  const me = await api.get('/api/users/me')
  assert.equal(refreshCalls, 1)
  assert.equal(me.config.headers.Authorization, 'Bearer sb-access-token-2')

  await logoutUser()
  assert.equal(getSession(), null)
  storage.set(SESSION_KEY, '{invalid')
  assert.equal(getSession(), null)
  clearSession()
})

test('reset password và change password đi qua backend', async () => {
  const requests = []
  api.defaults.adapter = async config => {
    requests.push(config)
    return { data: {}, status: 200, headers: {}, config }
  }
  await requestPasswordReset('minhanh@example.com')
  assert.equal(requests[0].url, '/api/auth/reset-password')
  await changePassword('new-password-123')
  assert.equal(requests[1].url, '/api/auth/password')
})

test('lỗi backend được gắn friendlyMessage tiếng Việt', async () => {
  api.defaults.adapter = async () => { throw { response: { status: 401, data: { detail: 'Email hoặc mật khẩu không đúng.' } } } }
  await assert.rejects(loginUser({ email: 'a@b.co', password: 'sai' }), (failure) => {
    assert.equal(failure.friendlyMessage, 'Email hoặc mật khẩu không đúng.')
    return true
  })
})

test('schedule CRUD gọi đúng endpoint, xóa series 204 trả null', async () => {
  const requests = []
  const row = {
    id: 'block-1', user_id: 'user-1', title: 'Toán', subject: null,
    date: '2026-10-05', start_time: '14:00', end_time: '15:30',
    tone: 'blue', kind: 'study', repeat: 'weekly', repeat_days: [],
    repeat_until: '2026-12-31', exdates: [],
  }
  api.defaults.adapter = async config => {
    requests.push(config)
    if (config.url.startsWith('/api/schedule') && config.method === 'get') return { data: [row], status: 200, headers: {}, config }
    if (config.url === '/api/schedule' && config.method === 'post') return { data: row, status: 201, headers: {}, config }
    if (config.url.startsWith('/api/schedule/block-1') && config.method === 'delete') {
      if (config.url.includes('scope=single')) return { data: { ...row, exdates: ['2026-10-12'] }, status: 200, headers: {}, config }
      return { data: null, status: 204, headers: {}, config }
    }
    return { data: {}, status: 200, headers: {}, config }
  }
  const rows = await fetchScheduleBlocks('2026-10-01', '2026-10-31')
  assert.equal(requests[0].url, '/api/schedule?from=2026-10-01&to=2026-10-31')
  assert.equal(rows[0].repeat_until, '2026-12-31')
  const created = await createScheduleBlock({ title: 'Toán', date: '2026-10-05', start_time: '14:00', end_time: '15:30' })
  assert.equal(created.id, 'block-1')
  const afterSingle = await deleteScheduleBlock('block-1', { scope: 'single', day: '2026-10-12' })
  assert.deepEqual(afterSingle.exdates, ['2026-10-12'])
  assert.equal(await deleteScheduleBlock('block-1'), null)
})

test('tạo block lỗi validate backend trả friendlyMessage từ detail', async () => {
  api.defaults.adapter = async () => { throw { response: { status: 422, data: { detail: 'Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.' } } } }
  await assert.rejects(createScheduleBlock({ title: 'X' }), (failure) => {
    assert.equal(failure.friendlyMessage, 'Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.')
    return true
  })
})

test('sửa block (PATCH) gửi đúng scope và query day', async () => {
  const requests = []
  api.defaults.adapter = async config => {
    requests.push(config)
    return { data: { id: 'block-9' }, status: 200, headers: {}, config }
  }
  await updateScheduleBlock('block-9', { title: 'Mới' })
  assert.equal(requests[0].url, '/api/schedule/block-9?scope=series')
  await updateScheduleBlock('block-9', { title: 'Lẻ' }, { scope: 'single', day: '2026-10-12' })
  assert.equal(requests[1].url, '/api/schedule/block-9?scope=single&day=2026-10-12')
  assert.equal(requests[1].method, 'put')
})
