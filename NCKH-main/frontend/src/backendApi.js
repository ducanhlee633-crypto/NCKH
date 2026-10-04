import axios from 'axios'

// Mô hình backend-proxy: mọi key Supabase (URL, ANON_KEY, SERVICE_ROLE_KEY)
// chỉ nằm ở backend. Frontend chỉ gọi API của mình và giữ session token
// (access_token / refresh_token do Supabase cấp, backend relay lại).
export const SESSION_KEY = 'nhip-hoc-session'
export const SESSION_EVENT = 'nhip-hoc-session-change'

export function getSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY))
    return session?.access_token && session?.user?.id && session.expires_at > Date.now() ? session : null
  } catch {
    return null
  }
}

export function saveSession(token) {
  const session = { ...token, expires_at: Date.now() + (token.expires_in ?? 3600) * 1000 }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  window.dispatchEvent(new Event(SESSION_EVENT))
  return session
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new Event(SESSION_EVENT))
}

/** Tên hiển thị: ưu tiên nickname -> name -> username -> email. UserPublic chỉ còn nickname. */
export function displayUser(session) {
  if (!session) return null
  const { user, profile } = session
  return {
    id: user.id,
    email: user.email ?? profile?.email ?? null,
    name: profile?.nickname || profile?.name || profile?.username || (user.email ? user.email.split('@')[0] : 'Bạn'),
    nickname: profile?.nickname ?? null,
    username: profile?.username ?? null,
  }
}

/** Refresh profile riêng tư từ backend và patch vào session đang lưu. */
export function updateSessionProfile(profile) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    const next = { ...session, profile: { ...(session.profile || {}), ...profile } }
    // Giữ nguyên expires_at cũ.
    next.expires_at = session.expires_at
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(SESSION_EVENT))
    return next
  } catch {
    return null
  }
}

export function onSessionChange(callback) {
  const handler = () => callback(getSession())
  window.addEventListener(SESSION_EVENT, handler)
  // Gọi ngay để App render đồng bộ, không phải chờ event/timeout.
  callback(getSession())
  return () => window.removeEventListener(SESSION_EVENT, handler)
}

/** Khởi động: hết hạn thì tự xóa session. Không cần key gì ở frontend. */
export function initSessionSync() {
  const session = getSession()
  if (!session) {
    try { sessionStorage.removeItem(SESSION_KEY) } catch { /* bỏ qua */ }
    return () => {}
  }
  const timer = window.setTimeout(clearSession, Math.max(0, session.expires_at - Date.now()))
  return () => window.clearTimeout(timer)
}

const api = axios.create({
  baseURL: import.meta.env?.VITE_API_URL || '/',
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const session = getSession()
  if (session) config.headers.Authorization = `Bearer ${session.access_token}`
  return config
})

api.interceptors.response.use(response => response, async (error) => {
  const session = getSession()
  // Access token chết: thử refresh một lần bằng refresh_token rồi request lại.
  if (error.response?.status === 401 && session?.refresh_token && !error.config._retried) {
    error.config._retried = true
    try {
      const refreshed = await refreshSession(session.refresh_token)
      error.config.headers.Authorization = `Bearer ${refreshed.access_token}`
      return api(error.config)
    } catch { /* rơi xuống đăng xuất */ }
  }
  if (error.response?.status === 401 && error.config?.headers?.Authorization) clearSession()
  return Promise.reject(error)
})

function backendErrorMessage(failure, fallback) {
  if (failure.response?.data?.detail) return failure.response.data.detail
  const status = failure.response?.status
  if (status === 401) return 'Email hoặc mật khẩu không đúng.'
  if (status === 409) return 'Email hoặc tên đăng nhập đã tồn tại.'
  if (status === 422) return 'Thông tin chưa hợp lệ. Kiểm tra lại các trường bên dưới.'
  if (status === 429) return 'Thử quá nhiều lần. Vui lòng đợi rồi thử lại.'
  if (status === 503) return 'Dịch vụ tài khoản chưa được cấu hình. Vui lòng liên hệ quản trị viên.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** Đăng ký qua backend (backend gọi Supabase Auth). Có thể trả { needsEmailConfirmation }. */
export async function registerUser({ email, password, name, username, nickname }) {
  try {
    const { data } = await api.post('/api/auth/signup', {
      email: email.trim(),
      password,
      name: name?.trim() || '',
      ...(username?.trim() ? { username: username.trim() } : {}),
      ...(nickname?.trim() ? { nickname: nickname.trim() } : {}),
    })
    // Project bật "Confirm email": Supabase không trả session, backend trả 201 kèm detail.
    if (!data?.access_token) return { needsEmailConfirmation: true, email: email.trim() }
    return saveSession(data)
  } catch (failure) {
    throw { ...failure, friendlyMessage: backendErrorMessage(failure, 'Không thể tạo tài khoản. Vui lòng thử lại.') }
  }
}

/** Đăng nhập qua backend + nạp sẵn profile. */
export async function loginUser({ email, password }) {
  try {
    const { data } = await api.post('/api/auth/login', { email: email.trim(), password })
    return saveSession(data)
  } catch (failure) {
    throw { ...failure, friendlyMessage: backendErrorMessage(failure, 'Không thể đăng nhập. Vui lòng thử lại.') }
  }
}

export async function refreshSession(refreshToken) {
  const { data } = await api.post('/api/auth/refresh', { refresh_token: refreshToken })
  return saveSession(data)
}

export async function logoutUser() {
  try {
    await api.post('/api/auth/logout')
  } catch { /* token hết hạn thì vẫn coi như đã đăng xuất */ }
  clearSession()
}

/** Gửi mail đặt lại mật khẩu (backend gọi Supabase Auth, luôn 202). */
export async function requestPasswordReset(email) {
  await api.post('/api/auth/reset-password', { email: email.trim() })
}

/** Đổi mật khẩu khi đang đăng nhập. */
export async function changePassword(newPassword) {
  try {
    await api.patch('/api/auth/password', { new_password: newPassword })
  } catch (failure) {
    throw { ...failure, friendlyMessage: backendErrorMessage(failure, 'Không đổi được mật khẩu. Hãy đăng nhập lại rồi thử.') }
  }
}

export async function fetchProfile() {
  const { data } = await api.get('/api/users/me')
  return data
}

export async function syncProfile({ username, name, nickname }) {
  const { data } = await api.patch('/api/users/me', {
    ...(username ? { username: username.trim().toLowerCase() } : {}),
    ...(nickname ? { nickname: nickname.trim().toLowerCase() } : {}),
    ...(name ? { name: name.trim() } : {}),
  })
  updateSessionProfile(data)
  return data
}

export async function deleteAccount() {
  await api.delete('/api/users/me')
  clearSession()
}

/** Lựa chọn Settings (user_preferences): 9 field hiển thị/học tập, không gồm identity. */

export function preferencesFromServer(data = {}) {
  return {
    avatar: data.avatar ?? '',
    theme: data.theme === 'dark' ? 'dark' : 'light',
    color: ['blue', 'violet', 'gold', 'mint'].includes(data.color) ? data.color : 'blue',
    ranking: data.ranking ?? true,
    streak: data.streak ?? true,
    reminders: data.reminders ?? true,
    reminderMinutes: Number(data.reminderMinutes ?? data.reminder_minutes ?? 15),
    weeklyHours: Number(data.weeklyHours ?? data.weekly_hours ?? 24),
    sound: data.sound ?? true,
  }
}

export function preferencesToPayload(settings = {}) {
  return {
    avatar: settings.avatar || null,
    theme: settings.theme === 'dark' ? 'dark' : 'light',
    color: settings.color,
    ranking: !!settings.ranking,
    streak: !!settings.streak,
    reminders: !!settings.reminders,
    reminderMinutes: Number(settings.reminderMinutes ?? 15),
    weeklyHours: Number(settings.weeklyHours ?? 24),
    sound: !!settings.sound,
  }
}

export async function fetchPreferences() {
  const { data } = await api.get('/api/preferences/me')
  return preferencesFromServer(data)
}

export async function savePreferences(settings) {
  try {
    const { data } = await api.put('/api/preferences/me', preferencesToPayload(settings))
    return preferencesFromServer(data)
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không lưu được thiết lập lên server. Đã giữ bản trên trình duyệt.' }
  }
}

/** Block học (schedule_blocks): CRUD cho SchedulePage. Chỉ gọi khi đã đăng nhập. */

export async function fetchScheduleBlocks(from, to) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  const { data } = await api.get('/api/schedule' + (query ? `?${query}` : ''))
  return Array.isArray(data) ? data : []
}

export async function createScheduleBlock(payload) {
  try {
    const { data } = await api.post('/api/schedule', payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không lưu được buổi học lên server. Vui lòng thử lại.' }
  }
}

export async function updateScheduleBlock(id, payload, { scope = 'series', day } = {}) {
  const params = new URLSearchParams({ scope })
  if (day) params.set('day', day)
  try {
    const { data } = await api.put(`/api/schedule/${id}?${params}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không sửa được buổi học trên server. Vui lòng thử lại.' }
  }
}

/** Xóa block. scope=series -> 204 (trả null); scope=single -> 200 + chuỗi đã cập nhật. */
export async function deleteScheduleBlock(id, { scope = 'series', day } = {}) {
  const params = new URLSearchParams({ scope })
  if (day) params.set('day', day)
  try {
    const { data, status } = await api.delete(`/api/schedule/${id}?${params}`)
    return status === 204 ? null : data
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không xóa được buổi học trên server. Vui lòng thử lại.' }
  }
}

/** Deadline (deadlines): CRUD cho SchedulePage. Chỉ gọi khi đã đăng nhập. */

const hhmm = value => String(value || '23:59').slice(0, 5)
const normalizePriority = value => (value === 'high' || value === 'low' ? value : 'medium')

/** Row server {id,title,due_date,due_time,priority,status} -> item UI {id,title,date,time,end,priority,status}. */
export function deadlineFromServer(row = {}) {
  const time = hhmm(row.due_time)
  return {
    id: row.id,
    title: row.title || '',
    date: row.due_date || row.date || '',
    time,
    // Giữ `end` để Dashboard/lịch cũ vẫn đọc được (tương thích ngược).
    end: time,
    priority: normalizePriority(row.priority),
    status: !!row.status,
  }
}

/** Item UI -> payload POST/PUT /api/deadlines. */
export function deadlineToPayload(item = {}) {
  const time = hhmm(item.time || item.end || item.due_time)
  return {
    title: String(item.title || '').trim(),
    due_date: item.date || item.due_date,
    due_time: time,
    priority: normalizePriority(item.priority),
    status: !!item.status,
  }
}

/** Gom deadline local cũ thành payload để migrate 1 lần lên server. */
export function deadlinesLocalForMigration(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter(item => item && !item.serverId && (item.title && (item.date || item.due_date)))
    .map(item => deadlineToPayload(item))
    .filter(payload => payload.title && /^\d{4}-\d{2}-\d{2}$/.test(payload.due_date || '') && /^\d{2}:\d{2}$/.test(payload.due_time || ''))}

export async function fetchDeadlines(from, to) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  const { data } = await api.get('/api/deadlines' + (query ? `?${query}` : ''))
  return Array.isArray(data) ? data : []
}

export async function createDeadline(payload) {
  try {
    const { data } = await api.post('/api/deadlines', payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không lưu được hạn nộp lên server. Vui lòng thử lại.' }
  }
}

export async function updateDeadline(id, payload) {
  try {
    const { data } = await api.put(`/api/deadlines/${id}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không sửa được hạn nộp trên server. Vui lòng thử lại.' }
  }
}

export async function deleteDeadline(id) {
  try {
    await api.delete(`/api/deadlines/${id}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: failure.response?.data?.detail || 'Không xóa được hạn nộp trên server. Vui lòng thử lại.' }
  }
}

/** Bạn bè (friendships): tìm theo username + kết bạn 2 bước. Chỉ gọi khi đã đăng nhập. */

function friendErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) {
    if (detail === 'Already friends.') return 'Hai bạn đã là bạn bè rồi.'
    if (detail === 'Friend request already sent.') return 'Bạn đã gửi lời mời rồi. Hãy chờ đối phương chấp nhận.'
    if (detail === 'User not found') return 'Không tìm thấy người dùng này.'
    if (detail === 'Friend request not found') return 'Lời mời không còn tồn tại.'
    if (detail === 'Friendship not found') return 'Chưa có quan hệ bạn bè với người này.'
    if (detail === 'Cannot add yourself as a friend.') return 'Bạn không thể kết bạn với chính mình.'
    return detail
  }
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** Tên hiển thị của 1 profile bạn bè: nickname -> username. */
export function friendDisplayName(friend = {}) {
  return friend.nickname || friend.username || 'Bạn'
}

/** GET /api/friends/search?q=... — tìm gần đúng theo username, backend đã loại chính mình. */
export async function searchUsers(query, limit = 20) {
  const keyword = String(query || '').trim()
  if (!keyword) return []
  try {
    const { data } = await api.get('/api/friends/search', { params: { q: keyword, limit } })
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không tìm được bạn. Vui lòng thử lại.') }
  }
}

/** POST /api/friends/requests {username} — gửi lời mời kết bạn. */
export async function sendFriendRequest(username) {
  try {
    const { data } = await api.post('/api/friends/requests', { username: String(username || '').trim().toLowerCase() })
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không gửi được lời mời. Vui lòng thử lại.') }
  }
}

/** GET /api/friends/requests?direction=incoming|outgoing|all — liệt kê lời mời pending. */
export async function fetchFriendRequests(direction = 'incoming') {
  try {
    const { data } = await api.get('/api/friends/requests', { params: { direction } })
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không tải được lời mời kết bạn.') }
  }
}

/** POST /api/friends/accept/{username} — chấp nhận lời mời đến. */
export async function acceptFriendRequest(username) {
  try {
    const { data } = await api.post(`/api/friends/accept/${encodeURIComponent(String(username || '').trim().toLowerCase())}`)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không chấp nhận được lời mời.') }
  }
}

/** POST /api/friends/reject/{username} — từ chối lời mời đến (204). */
export async function rejectFriendRequest(username) {
  try {
    await api.post(`/api/friends/reject/${encodeURIComponent(String(username || '').trim().toLowerCase())}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không từ chối được lời mời.') }
  }
}

/** GET /api/friends — danh sách bạn đã accepted (cả 2 chiều). */
export async function fetchFriends() {
  try {
    const { data } = await api.get('/api/friends')
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không tải được danh sách bạn bè.') }
  }
}

/** DELETE /api/friends/{username} — hủy kết bạn / hủy lời mời đã gửi / từ chối lời mời đến. */
export async function removeFriend(username) {
  try {
    await api.delete(`/api/friends/${encodeURIComponent(String(username || '').trim().toLowerCase())}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: friendErrorMessage(failure, 'Không xóa được quan hệ bạn bè.') }
  }
}

/** Góp ý (feedbacks): gửi từ trang Trợ giúp. Chỉ gọi khi đã đăng nhập. */

function feedbackErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return detail
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** GET /api/feedback — góp ý của chính mình (mới nhất trước). */
export async function fetchFeedbacks() {
  try {
    const { data } = await api.get('/api/feedback')
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: feedbackErrorMessage(failure, 'Không tải được góp ý.') }
  }
}

/** POST /api/feedback {message} — gửi góp ý mới. */
export async function createFeedback(message) {
  try {
    const { data } = await api.post('/api/feedback', { message: String(message || '').trim() })
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: feedbackErrorMessage(failure, 'Không gửi được góp ý. Vui lòng thử lại.') }
  }
}

/** DELETE /api/feedback/{id} — xóa góp ý của chính mình (204). */
export async function deleteFeedback(id) {
  try {
    await api.delete(`/api/feedback/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: feedbackErrorMessage(failure, 'Không xóa được góp ý.') }
  }
}

/** Pomodoro (pomodoro_sessions): ghi phiên focus đã hoàn thành. Chỉ gọi khi đã đăng nhập. */

/** Môn học khóa cứng cho phiên focus — khớp backend + CHECK trong Supabase. */
export const POMODORO_SUBJECTS = ['Toán', 'Lí', 'Hoá', 'Văn', 'Sinh', 'Sử', 'Địa', 'Tin', 'Dự án']

function pomodoroErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return detail
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** Chuẩn hóa payload POST /api/pomodoro: {focus_minutes, subject?, started_at, ended_at}. Subject chỉ gửi khi thuộc 9 môn khóa cứng. */
export function pomodoroToPayload({ focusMinutes, focus_minutes, subject, startedAt, started_at, endedAt, ended_at } = {}) {
  const minutes = Number(focus_minutes ?? focusMinutes ?? 0)
  const toISO = value => (value instanceof Date ? value.toISOString() : String(value || ''))
  const cleanSubject = String(subject || '').trim()
  return {
    focus_minutes: minutes,
    ...(POMODORO_SUBJECTS.includes(cleanSubject) ? { subject: cleanSubject } : {}),
    started_at: toISO(started_at ?? startedAt),
    ended_at: toISO(ended_at ?? endedAt),
  }
}

/** GET /api/pomodoro?from=YYYY-MM-DD&to=YYYY-MM-DD — phiên của chính mình. */
export async function fetchPomodoroSessions(from, to) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  try {
    const { data } = await api.get('/api/pomodoro' + (query ? `?${query}` : ''))
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: pomodoroErrorMessage(failure, 'Không tải được phiên tập trung.') }
  }
}

/** GET /api/pomodoro/summary?from&to — {total_minutes, total_sessions, days:[{date,total_minutes,total_sessions}]}. */
export async function fetchPomodoroSummary(from, to) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  try {
    const { data } = await api.get('/api/pomodoro/summary' + (query ? `?${query}` : ''))
    return data && typeof data === 'object'
      ? { total_minutes: Number(data.total_minutes ?? 0), total_sessions: Number(data.total_sessions ?? 0), days: Array.isArray(data.days) ? data.days : [] }
      : { total_minutes: 0, total_sessions: 0, days: [] }
  } catch (failure) {
    throw { ...failure, friendlyMessage: pomodoroErrorMessage(failure, 'Không tải được thống kê tập trung.') }
  }
}

/** POST /api/pomodoro — ghi 1 phiên focus đã hoàn thành (timer chạy hết giờ mới gọi). */
export async function createPomodoroSession(payload) {
  try {
    const { data } = await api.post('/api/pomodoro', pomodoroToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: pomodoroErrorMessage(failure, 'Không lưu được phiên tập trung lên server. Vui lòng thử lại.') }
  }
}

/** DELETE /api/pomodoro/{id} — xóa phiên của chính mình (204). */
export async function deletePomodoroSession(id) {
  try {
    await api.delete(`/api/pomodoro/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: pomodoroErrorMessage(failure, 'Không xóa được phiên tập trung.') }
  }
}

export default api
