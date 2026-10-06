import axios from 'axios'
import { safeMaterialUrl, validateAiPlan } from './data/roadmap.js'
import { POMODORO_SUBJECTS } from './data/subjects.js'

// Danh mục môn học dùng chung nằm ở ./data/subjects.js (mirror backend/subjects.py).
// Re-export để PomodoroPage (và code cũ import từ backendApi) không phải sửa.
export { POMODORO_SUBJECTS }

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
    grade: profile?.grade ?? null,
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
export async function registerUser({ email, password, name, username, nickname, grade }) {
  try {
    const normalizedGrade = normalizeGrade(grade)
    const { data } = await api.post('/api/auth/signup', {
      email: email.trim(),
      password,
      name: name?.trim() || '',
      ...(username?.trim() ? { username: username.trim() } : {}),
      ...(nickname?.trim() ? { nickname: nickname.trim() } : {}),
      ...(normalizedGrade ? { grade: normalizedGrade } : {}),
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

const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12']
const normalizeGrade = value => {
  if (value === null || value === undefined) return null
  const cleaned = String(value).trim()
  if (!cleaned) return null
  return GRADE_VALUES.includes(cleaned) ? cleaned : undefined
}

export async function syncProfile({ username, name, nickname, grade }) {
  const normalizedGrade = normalizeGrade(grade)
  if (grade !== undefined && normalizedGrade === undefined) {
    throw { friendlyMessage: 'Lớp không hợp lệ. Chọn từ 6 đến 12.' }
  }
  const { data } = await api.patch('/api/users/me', {
    ...(username ? { username: username.trim().toLowerCase() } : {}),
    ...(nickname ? { nickname: nickname.trim().toLowerCase() } : {}),
    ...(name ? { name: name.trim() } : {}),
    // grade: gửi string "6".."12" để đặt, null để xóa, bỏ qua khi undefined/""
    ...(normalizedGrade ? { grade: normalizedGrade } : grade === null || grade === '' ? { grade: null } : {}),
  })
  updateSessionProfile(data)
  return data
}

export async function deleteAccount() {
  await api.delete('/api/users/me')
  clearSession()
}

/** Lựa chọn Settings (user_preferences): 10 field hiển thị/học tập/AI, không gồm identity. */

const AI_TONE_VALUES = ['cute', 'honest', 'funny', 'empathetic']
const normalizeAiTone = value => (AI_TONE_VALUES.includes(String(value)) ? String(value) : 'cute')

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
    aiTone: normalizeAiTone(data.aiTone ?? data.ai_tone ?? 'cute'),
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
    aiTone: normalizeAiTone(settings.aiTone ?? settings.ai_tone ?? 'cute'),
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

/** Môn học khóa cứng cho phiên focus — lấy từ ./data/subjects.js (khớp backend + CHECK trong Supabase). */

function pomodoroErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return detail
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** Chuẩn hóa payload POST /api/pomodoro: {focus_minutes, subject?, started_at, ended_at}. Subject chỉ gửi khi thuộc danh mục khóa cứng. */
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

/** Mục tiêu (goals): CRUD cho GoalsPage. Chỉ gọi khi đã đăng nhập. */

export const GOAL_STATUS = ['in_progress', 'completed']
export const GOAL_STATUS_LABEL = { in_progress: 'Đang thực hiện', completed: 'Đã hoàn thành' }

function goalErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return detail
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

const normalizeGoalStatus = value => (value === 'completed' ? 'completed' : 'in_progress')
const normalizeTargetScore = value => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10))
}

/** Row server {id,title,target_score,icon,start_date,end_date,status} -> item UI {id,title,targetScore,startDate,date,icon,status}. progress giữ tương thích ngược nhưng UI không dùng. */
export function goalFromServer(row = {}) {
  const completed = normalizeGoalStatus(row.status) === 'completed'
  return {
    id: row.id,
    title: row.title || '',
    targetScore: row.target_score ?? row.targetScore ?? null,
    icon: row.icon || '🌱',
    startDate: row.start_date || row.startDate || '',
    // Giữ `date` để GoalsPage cũ vẫn đọc được (tương thích ngược: date = end_date).
    date: row.end_date || row.date || '',
    endDate: row.end_date || row.date || '',
    status: normalizeGoalStatus(row.status),
    ...(completed ? { completedAt: row.end_date || row.date || '' } : {}),
  }
}

/** Item UI -> payload POST/PUT /api/goals. Không còn nhập tiến độ từng card: progress luôn suy từ status để tương thích DB cũ. */
export function goalToPayload(item = {}) {
  const targetScore = normalizeTargetScore(item.targetScore ?? item.target_score)
  const status = normalizeGoalStatus(item.status)
  const payload = {
    title: String(item.title || '').trim(),
    icon: String(item.icon || item.emoji || '🌱').slice(0, 16) || '🌱',
    start_date: item.startDate || item.start_date,
    end_date: item.date || item.endDate || item.end_date,
    status,
    progress: status === 'completed' ? 100 : 0,
  }
  if (targetScore !== null) payload.target_score = targetScore
  return payload
}

/** Gom goal local cũ thành payload để migrate 1 lần lên server. */
export function goalsLocalForMigration(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter(item => item && !item.serverId && typeof item.title === 'string' && item.title.trim())
    .map(item => goalToPayload(item))
    .filter(payload => payload.title && /^\d{4}-\d{2}-\d{2}$/.test(payload.start_date || '') && /^\d{4}-\d{2}-\d{2}$/.test(payload.end_date || ''))
    .filter(payload => payload.start_date <= payload.end_date)
}

/** GET /api/goals?status=&from=&to= — mục tiêu của chính mình. */
export async function fetchGoals({ status: goalStatus, from, to } = {}) {
  const params = new URLSearchParams()
  if (goalStatus) params.set('status', goalStatus)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  try {
    const { data } = await api.get('/api/goals' + (query ? `?${query}` : ''))
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: goalErrorMessage(failure, 'Không tải được mục tiêu.') }
  }
}

/** POST /api/goals — tạo mục tiêu mới. */
export async function createGoal(payload) {
  try {
    const { data } = await api.post('/api/goals', goalToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: goalErrorMessage(failure, 'Không lưu được mục tiêu lên server. Vui lòng thử lại.') }
  }
}

/** PUT /api/goals/{id} — sửa mục tiêu (đổi tên, ngày, trạng thái...). */
export async function updateGoal(id, payload) {
  try {
    const { data } = await api.put(`/api/goals/${encodeURIComponent(String(id || ''))}`, goalToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: goalErrorMessage(failure, 'Không sửa được mục tiêu trên server. Vui lòng thử lại.') }
  }
}

/** PATCH /api/goals/{id} — cập nhật 1 phần (VD: {status}). Dùng payload thô, không qua goalToPayload. */
export async function patchGoal(id, payload) {
  try {
    const { data } = await api.patch(`/api/goals/${encodeURIComponent(String(id || ''))}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: goalErrorMessage(failure, 'Không cập nhật được mục tiêu trên server.') }
  }
}

/** DELETE /api/goals/{id} — xóa mục tiêu (204). */
export async function deleteGoal(id) {
  try {
    await api.delete(`/api/goals/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: goalErrorMessage(failure, 'Không xóa được mục tiêu trên server.') }
  }
}

/** Việc trong tuần (weekly_tasks): kanban todo/doing/done cho WeeklyTasksPage. Chỉ gọi khi đã đăng nhập. */

export const WEEKLY_TASK_STATUS = ['todo', 'doing', 'done']
export const WEEKLY_TASK_PRIORITY = ['high', 'medium', 'low']

function weeklyTaskErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return typeof detail === 'string' ? detail : 'Thông tin việc chưa hợp lệ. Kiểm tra lại các trường.'
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

const normalizeWeeklyStatus = value => (value === 'doing' || value === 'done' ? value : 'todo')
const normalizeWeeklyPriority = value => (value === 'high' || value === 'low' ? value : 'medium')
const normalizeWeeklyDate = value => {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

/** Row server {id,title,description,subject,date,priority,status} -> item UI WeeklyTasksPage. */
export function weeklyTaskFromServer(row = {}) {
  const date = row.date ? String(row.date).slice(0, 10) : ''
  return {
    id: row.id,
    title: String(row.title || ''),
    description: String(row.description || ''),
    subject: String(row.subject || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    priority: normalizeWeeklyPriority(row.priority),
    status: normalizeWeeklyStatus(row.status),
  }
}

/** Item UI -> payload POST/PUT /api/weekly-tasks. date rỗng gửi null (chưa hẹn ngày). */
export function weeklyTaskToPayload(item = {}) {
  const title = String(item.title || '').trim()
  const description = String(item.description || '').trim().slice(0, 500)
  const subject = String(item.subject || '').trim().slice(0, 40)
  const date = normalizeWeeklyDate(item.date)
  return {
    title,
    description,
    ...(subject ? { subject } : { subject: null }),
    ...(date ? { date } : { date: null }),
    priority: normalizeWeeklyPriority(item.priority),
    status: normalizeWeeklyStatus(item.status),
  }
}

/** Gom task local cũ thành payload để migrate 1 lần lên server. */
export function weeklyTasksLocalForMigration(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter(item => item && !item.serverId && typeof item.title === 'string' && item.title.trim())
    .map(item => weeklyTaskToPayload(item))
    .filter(payload => payload.title && payload.title.length <= 120)
    .filter(payload => !payload.date || /^\d{4}-\d{2}-\d{2}$/.test(payload.date))
}

/** GET /api/weekly-tasks?from=&to=&status=&priority=&subject=&q= — việc của chính mình. */
export async function fetchWeeklyTasks({ from, to, status: taskStatus, priority, subject, q } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (taskStatus) params.set('status', taskStatus)
  if (priority) params.set('priority', priority)
  if (subject) params.set('subject', subject)
  if (q) params.set('q', q)
  const query = params.toString()
  try {
    const { data } = await api.get('/api/weekly-tasks' + (query ? `?${query}` : ''))
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: weeklyTaskErrorMessage(failure, 'Không tải được việc trong tuần.') }
  }
}

/** POST /api/weekly-tasks — tạo việc mới. */
export async function createWeeklyTask(payload) {
  try {
    const { data } = await api.post('/api/weekly-tasks', weeklyTaskToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: weeklyTaskErrorMessage(failure, 'Không lưu được việc lên server. Vui lòng thử lại.') }
  }
}

/** PUT /api/weekly-tasks/{id} — sửa việc (đổi tên, ngày, ưu tiên, trạng thái...). */
export async function updateWeeklyTask(id, payload) {
  try {
    const { data } = await api.put(`/api/weekly-tasks/${encodeURIComponent(String(id || ''))}`, weeklyTaskToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: weeklyTaskErrorMessage(failure, 'Không sửa được việc trên server. Vui lòng thử lại.') }
  }
}

/** PATCH /api/weekly-tasks/{id} — cập nhật 1 phần (VD: kéo-thả chỉ gửi {status}). Dùng payload thô. */
export async function patchWeeklyTask(id, payload) {
  try {
    const { data } = await api.patch(`/api/weekly-tasks/${encodeURIComponent(String(id || ''))}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: weeklyTaskErrorMessage(failure, 'Không đổi được trạng thái việc trên server.') }
  }
}

/** DELETE /api/weekly-tasks/{id} — xóa việc (204). */
export async function deleteWeeklyTask(id) {
  try {
    await api.delete(`/api/weekly-tasks/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: weeklyTaskErrorMessage(failure, 'Không xóa được việc trên server.') }
  }
}

/** Việc hằng ngày (daily_tasks): checkbox done + task_date cho DashboardPage. Chỉ gọi khi đã đăng nhập. */

export const DAILY_TASK_PRIORITY = ['high', 'medium', 'low']

function dailyTaskErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return typeof detail === 'string' ? detail : 'Thông tin việc chưa hợp lệ. Kiểm tra lại các trường.'
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

const normalizeDailyPriority = value => (value === 'high' || value === 'low' ? value : 'medium')
const normalizeDailyDate = value => {
  const text = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}
const todayKeyLocal = () => {
  try {
    return new Date().toLocaleDateString('en-CA')
  } catch {
    return ''
  }
}

/** Row server {id,title,description,subject,task_date,priority,done,position} -> item UI Dashboard. */
export function dailyTaskFromServer(row = {}) {
  const date = String(row.task_date ?? row.date ?? '').slice(0, 10)
  return {
    id: row.id,
    title: String(row.title || ''),
    description: String(row.description || ''),
    subject: String(row.subject || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    task_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    priority: normalizeDailyPriority(row.priority),
    done: !!row.done,
    position: Number.isInteger(row.position) ? row.position : Number(row.position) || 0,
  }
}

/** Item UI -> payload POST/PUT /api/daily-tasks. task_date bắt buộc, thiếu thì lấy hôm nay. */
export function dailyTaskToPayload(item = {}) {
  const title = String(item.title || '').trim()
  const description = String(item.description || '').trim().slice(0, 500)
  const subject = String(item.subject || '').trim().slice(0, 40)
  const date = normalizeDailyDate(item.task_date ?? item.date) || todayKeyLocal()
  const positionRaw = Number(item.position ?? 0)
  return {
    title,
    description,
    ...(subject ? { subject } : { subject: null }),
    task_date: date,
    priority: normalizeDailyPriority(item.priority),
    done: !!item.done,
    position: Number.isInteger(positionRaw) ? Math.max(0, Math.min(10000, positionRaw)) : 0,
  }
}

/** Gom task local cũ (kể cả shape {title,done} của `nhip-hoc-tasks`) thành payload để migrate 1 lần. */
export function dailyTasksLocalForMigration(list = []) {
  const today = todayKeyLocal()
  return (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item.title === 'string' && item.title.trim())
    .map((item, index) => dailyTaskToPayload({
      title: item.title,
      description: item.description || '',
      subject: item.subject || null,
      task_date: normalizeDailyDate(item.task_date ?? item.date) || today,
      priority: item.priority,
      done: !!item.done,
      position: Number.isInteger(item.position) ? item.position : index,
    }))
    .filter(payload => payload.title && payload.title.length <= 160 && /^\d{4}-\d{2}-\d{2}$/.test(payload.task_date || ''))
}

/** GET /api/daily-tasks?from=&to=&priority=&done=&subject=&q= — việc của chính mình. */
export async function fetchDailyTasks({ from, to, priority, done, subject, q } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (priority) params.set('priority', priority)
  if (done !== undefined && done !== null && done !== '') params.set('done', done ? 'true' : 'false')
  if (subject) params.set('subject', subject)
  if (q) params.set('q', q)
  const query = params.toString()
  try {
    const { data } = await api.get('/api/daily-tasks' + (query ? `?${query}` : ''))
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: dailyTaskErrorMessage(failure, 'Không tải được việc hằng ngày.') }
  }
}

/** POST /api/daily-tasks — tạo việc mới. */
export async function createDailyTask(payload) {
  try {
    const { data } = await api.post('/api/daily-tasks', dailyTaskToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: dailyTaskErrorMessage(failure, 'Không lưu được việc lên server. Vui lòng thử lại.') }
  }
}

/** PUT /api/daily-tasks/{id} — sửa việc (đổi tên, ngày, ưu tiên, mô tả...). */
export async function updateDailyTask(id, payload) {
  try {
    const { data } = await api.put(`/api/daily-tasks/${encodeURIComponent(String(id || ''))}`, dailyTaskToPayload(payload))
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: dailyTaskErrorMessage(failure, 'Không sửa được việc trên server. Vui lòng thử lại.') }
  }
}

/** PATCH /api/daily-tasks/{id} — cập nhật 1 phần (VD: tick checkbox chỉ gửi {done}). Dùng payload thô. */
export async function patchDailyTask(id, payload) {
  try {
    const { data } = await api.patch(`/api/daily-tasks/${encodeURIComponent(String(id || ''))}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: dailyTaskErrorMessage(failure, 'Không đổi được trạng thái việc trên server.') }
  }
}

/** DELETE /api/daily-tasks/{id} — xóa việc (204). */
export async function deleteDailyTask(id) {
  try {
    await api.delete(`/api/daily-tasks/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: dailyTaskErrorMessage(failure, 'Không xóa được việc trên server.') }
  }
}

/** Lộ trình học (roadmaps + roadmap_stages + roadmap_lessons): CRUD cho RoadmapPage. Bắt buộc đăng nhập. */

function roadmapErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return typeof detail === 'string' ? detail : 'Thông tin lộ trình chưa hợp lệ. Kiểm tra lại các trường.'
  if (failure.response?.status === 401) return 'Hãy đăng nhập để lưu lộ trình học.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

const hhmmRoadmap = value => String(value || '').slice(0, 5)
const normalizeRoadmapScore = value => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10))
}

/** Row server RoadmapDetail -> item UI cho RoadmapPage (giữ shape cũ của localStorage để khỏi vỡ hiển thị). */
export function roadmapFromServer(row = {}) {
  const stages = (Array.isArray(row.stages) ? row.stages : []).map(stage => ({
    title: String(stage?.title || ''),
    goal: String(stage?.goal || ''),
    materials: (Array.isArray(stage?.materials) ? stage.materials : [])
      .filter(item => item?.url)
      .map(item => ({ label: String(item.label || item.url), url: String(item.url) })),
    checkpoint: String(stage?.checkpoint || ''),
  }))
  const lessons = (Array.isArray(row.lessons) ? row.lessons : []).map(lesson => ({
    id: lesson?.id,
    title: String(lesson?.title || ''),
    focus: String(lesson?.focus || ''),
    stage: Number.isInteger(lesson?.stage_index) ? lesson.stage_index : Number(lesson?.stage ?? 0) || 0,
    date: lesson?.date || '',
    start: hhmmRoadmap(lesson?.start_time ?? lesson?.start),
    end: hhmmRoadmap(lesson?.end_time ?? lesson?.end),
    done: !!lesson?.done,
    materialUrl: String(lesson?.material_url ?? lesson?.materialUrl ?? ''),
    materialLabel: String(lesson?.material_label ?? lesson?.materialLabel ?? lesson?.material_url ?? lesson?.materialUrl ?? ''),
    stageId: lesson?.stage_id ?? null,
  }))
  return {
    id: row.id,
    title: String(row.title || ''),
    goalId: row.goal_id || '',
    subject: String(row.subject || ''),
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    time: hhmmRoadmap(row.start_time) || '19:00',
    duration: Number(row.duration_minutes ?? row.duration ?? 60),
    sessionsPerWeek: Number(row.sessions_per_week ?? row.sessionsPerWeek ?? 5),
    studyDays: Array.isArray(row.study_days) ? row.study_days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : Array.isArray(row.studyDays) ? row.studyDays : [0, 1, 2, 3, 4, 5, 6],
    context: String(row.context || ''),
    notes: String(row.notes || ''),
    grade: row.grade ?? '',
    level: String(row.level || ''),
    currentScore: row.current_score ?? row.currentScore ?? '',
    targetScore: row.target_score ?? row.targetScore ?? '',
    weakTopics: String(row.weak_topics ?? row.weakTopics ?? ''),
    learningStyle: String(row.learning_style ?? row.learningStyle ?? ''),
    aiGenerated: !!(row.ai_generated ?? row.aiGenerated),
    goalTitle: String(row.goalTitle || ''),
    stages,
    lessons,
  }
}

/** Draft UI + stages/lessons đã dựng -> payload POST /api/roadmaps. */
export function roadmapToPayload({ draft = {}, stages = [], lessons = [], aiGenerated = false } = {}) {
  const trim = value => String(value ?? '').trim()
  const grade = trim(draft.grade)
  const currentScore = normalizeRoadmapScore(draft.currentScore)
  const targetScore = normalizeRoadmapScore(draft.targetScore)
  const studyDays = [...new Set((Array.isArray(draft.studyDays) ? draft.studyDays : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
  return {
    title: trim(draft.title),
    subject: trim(draft.subject),
    ...(draft.goalId ? { goal_id: draft.goalId } : {}),
    start_date: draft.startDate,
    end_date: draft.endDate,
    start_time: hhmmRoadmap(draft.time) || '19:00',
    duration_minutes: Number(draft.duration),
    sessions_per_week: Number(draft.sessionsPerWeek),
    study_days: studyDays,
    context: trim(draft.context),
    notes: trim(draft.notes),
    ...(grade ? { grade } : { grade: null }),
    level: trim(draft.level),
    ...(currentScore !== null ? { current_score: currentScore } : {}),
    ...(targetScore !== null ? { target_score: targetScore } : {}),
    weak_topics: trim(draft.weakTopics),
    learning_style: trim(draft.learningStyle),
    ai_generated: !!aiGenerated,
    stages: (Array.isArray(stages) ? stages : []).slice(0, 5).map(stage => ({
      title: trim(stage.title),
      goal: trim(stage.goal),
      checkpoint: trim(stage.checkpoint),
      materials: (Array.isArray(stage.materials) ? stage.materials : []).slice(0, 3)
        .filter(item => item?.url)
        .map(item => ({ label: trim(item.label || item.url).slice(0, 200) || String(item.url), url: String(item.url).trim() })),
    })),
    lessons: (Array.isArray(lessons) ? lessons : []).slice(0, 120).map((lesson, index) => ({
      title: trim(lesson.title) || `Buổi ${index + 1}`,
      focus: trim(lesson.focus),
      stage_index: Math.max(0, Number(lesson.stage ?? lesson.stage_index ?? 0) || 0),
      date: lesson.date,
      start_time: hhmmRoadmap(lesson.start ?? lesson.start_time),
      end_time: hhmmRoadmap(lesson.end ?? lesson.end_time),
      material_url: String(lesson.materialUrl ?? lesson.material_url ?? '').trim(),
      material_label: trim(lesson.materialLabel ?? lesson.material_label ?? '').slice(0, 200),
    })),
  }
}

/** GET /api/roadmaps — lộ trình của mình kèm stages + lessons (mới nhất trước). */
export async function fetchRoadmaps() {
  try {
    const { data } = await api.get('/api/roadmaps')
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: roadmapErrorMessage(failure, 'Không tải được lộ trình học.') }
  }
}

/** POST /api/roadmaps — tạo lộ trình kèm stages + lessons. Nhận payload thô từ roadmapToPayload. */
export async function createRoadmap(payload) {
  try {
    const { data } = await api.post('/api/roadmaps', payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: roadmapErrorMessage(failure, 'Không lưu được lộ trình lên server. Vui lòng thử lại.') }
  }
}

/** PUT /api/roadmaps/{id} — sửa scalar; gửi kèm stages/lessons để thay toàn bộ nested. */
export async function updateRoadmap(id, payload) {
  try {
    const { data } = await api.put(`/api/roadmaps/${encodeURIComponent(String(id || ''))}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: roadmapErrorMessage(failure, 'Không sửa được lộ trình trên server. Vui lòng thử lại.') }
  }
}

/** DELETE /api/roadmaps/{id} — xóa lộ trình + stages/lessons (204). */
export async function deleteRoadmap(id) {
  try {
    await api.delete(`/api/roadmaps/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: roadmapErrorMessage(failure, 'Không xóa được lộ trình trên server.') }
  }
}

/** PATCH /api/roadmaps/lessons/{lessonId} — tick done hoặc sửa 1 buổi học. */
export async function patchRoadmapLesson(lessonId, payload) {
  try {
    const { data } = await api.patch(`/api/roadmaps/lessons/${encodeURIComponent(String(lessonId || ''))}`, payload)
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: roadmapErrorMessage(failure, 'Không cập nhật được buổi học trên server.') }
  }
}

/** Trợ lý AI (ai chat): POST /api/ai/chat {messages:[{role,content}]} -> {reply, model}. Chỉ gọi khi đã đăng nhập. */

function aiErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return detail
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại rồi chat.'
  if (failure.response?.status === 503) return 'Dịch vụ AI chưa được cấu hình. Vui lòng liên hệ quản trị viên.'
  if (failure.response?.status === 502) return 'AI đang bận. Vui lòng thử lại sau ít phút.'
  return failure.response ? fallback : 'Không kết nối được máy chủ AI. Kiểm tra backend rồi thử lại.'
}

/** Chuẩn hóa message UI {role,text} hoặc {role,content} -> {role,content} cho backend. */
export function aiMessagesToPayload(list = []) {
  return (Array.isArray(list) ? list : [])
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content ?? item?.text ?? '').trim(),
    }))
    .filter(item => item.content)
    .slice(-20)
}

/** Gửi hội thoại lên backend, trả về chuỗi reply. Ném lỗi có friendlyMessage. */
export async function sendAiChat(messages, { aiTone } = {}) {
  const payload = aiMessagesToPayload(messages)
  if (!payload.length) throw { friendlyMessage: 'Hãy nhập câu hỏi trước khi gửi.' }
  // Ưu tiên aiTone truyền vào (bản Settings mới chỉnh nhưng chưa bấm Lưu);
  // thiếu thì đọc localStorage để backend dùng đúng giọng đang xem.
  let tone = ['cute', 'honest', 'funny', 'empathetic'].includes(aiTone) ? aiTone : null
  if (!tone) {
    try {
      const stored = JSON.parse(localStorage.getItem('nhip-hoc-settings')) || {}
      const raw = stored.aiTone ?? stored.ai_tone
      if (['cute', 'honest', 'funny', 'empathetic'].includes(raw)) tone = raw
    } catch { /* bỏ qua: backend tự đọc DB */ }
  }
  try {
    const { data } = await api.post('/api/ai/chat', { messages: payload, ...(tone ? { aiTone: tone } : {}) }, { timeout: 60000 })
    const reply = String(data?.reply ?? '').trim()
    if (!reply) throw { response: { data: {} }, message: 'empty reply' }
    return reply
  } catch (failure) {
    throw { ...failure, friendlyMessage: aiErrorMessage(failure, 'Không nhận được câu trả lời từ AI. Vui lòng thử lại.') }
  }
}

/** Generate a complete plan; cancellation belongs to the composer that requested it. */
export async function generateRoadmapPlan(payload = {}, { signal } = {}) {
  const total = Number(payload.totalSessions)
  if (!String(payload.subject || '').trim() || !String(payload.context || '').trim() || !Number.isInteger(total) || total < 1 || total > 120) {
    throw { friendlyMessage: 'Nhập môn học, ngữ cảnh và số buổi hợp lệ (1–120).' }
  }
  try {
    const { data } = await api.post('/api/ai/roadmap', payload, { timeout: 210000, signal })
    if (!validateAiPlan(data?.stages, total)) throw { friendlyMessage: 'AI trả về lộ trình thiếu hoặc trùng buổi học. Hãy soạn lại.' }
    const stages = data.stages.map(stage => ({ ...stage,
      materials: stage.materials.filter(item => safeMaterialUrl(item?.url)).map(item => ({ label: String(item.label || item.url), url: safeMaterialUrl(item.url) })),
      lessons: stage.lessons.map(lesson => ({ ...lesson, material_url: safeMaterialUrl(lesson.material_url) })),
    }))
    return { stages, searchUsed: !!data.searchUsed, model: data.model || '', warnings: Array.isArray(data.warnings) ? data.warnings.filter(item => typeof item === 'string') : [] }
  } catch (failure) {
    if (axios.isCancel(failure)) throw failure
    const detail = failure.response?.data?.detail
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? 'Thông tin chưa hợp lệ. Kiểm tra số buổi, thời lượng và hồ sơ học tập.' :
      failure.code === 'ECONNABORTED' ? 'AI soạn quá lâu. Hãy giảm số buổi hoặc thử lại.' :
      failure.friendlyMessage || aiErrorMessage(failure, 'AI không tạo được lộ trình. Hãy thử lại.')
    throw { ...failure, friendlyMessage: message }
  }
}

/** Lịch sử chat AI (ai_sessions + ai_messages): CRUD lưu trữ, chỉ gọi khi đã đăng nhập. */

function aiHistoryErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return detail
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** Tên session = tin nhắn đầu tiên của user, gọn 1 dòng, tối đa 80 ký tự (backend cho 200). */
export function aiSessionTitleFromText(text, max = 80) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ')
  if (!clean) return 'Cuộc trò chuyện mới'
  if (clean.length <= max) return clean
  return clean.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}

/** GET /api/ai/sessions — phiên chat của mình (mới nhất trước). */
export async function fetchAiSessions() {
  try {
    const { data } = await api.get('/api/ai/sessions')
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: aiHistoryErrorMessage(failure, 'Không tải được lịch sử trò chuyện.') }
  }
}

/** POST /api/ai/sessions {title} — tạo phiên mới. Nhận cả title thô, tự rút gọn từ tin nhắn đầu. */
export async function createAiSession(title) {
  try {
    const { data } = await api.post('/api/ai/sessions', { title: aiSessionTitleFromText(title) })
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: aiHistoryErrorMessage(failure, 'Không tạo được cuộc trò chuyện mới. Vui lòng thử lại.') }
  }
}

/** DELETE /api/ai/sessions/{id} — xóa phiên + toàn bộ tin nhắn (204). */
export async function deleteAiSession(id) {
  try {
    await api.delete(`/api/ai/sessions/${encodeURIComponent(String(id || ''))}`)
    return null
  } catch (failure) {
    throw { ...failure, friendlyMessage: aiHistoryErrorMessage(failure, 'Không xóa được cuộc trò chuyện.') }
  }
}

/** Row server {role, content} -> message UI {id, role, text}. */
export function aiMessageFromServer(row = {}) {
  return {
    id: row.id || String(Math.random()),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    text: String(row.content ?? row.text ?? ''),
  }
}

/** GET /api/ai/sessions/{id}/messages — tin nhắn theo thời gian tăng dần (đủ dựng context RAG). */
export async function fetchAiMessages(sessionId, { limit = 200, offset = 0 } = {}) {
  try {
    const { data } = await api.get(`/api/ai/sessions/${encodeURIComponent(String(sessionId || ''))}/messages`, {
      params: { limit, offset },
    })
    return Array.isArray(data) ? data : []
  } catch (failure) {
    throw { ...failure, friendlyMessage: aiHistoryErrorMessage(failure, 'Không tải được tin nhắn.') }
  }
}

/** POST /api/ai/sessions/{id}/messages {role, content} — lưu 1 lượt nhắn. */
export async function createAiMessage(sessionId, { role, content } = {}) {
  try {
    const { data } = await api.post(`/api/ai/sessions/${encodeURIComponent(String(sessionId || ''))}/messages`, {
      role: role === 'assistant' ? 'assistant' : 'user',
      content: String(content ?? '').trim(),
    })
    return data
  } catch (failure) {
    throw { ...failure, friendlyMessage: aiHistoryErrorMessage(failure, 'Không lưu được tin nhắn lên server.') }
  }
}

/** Onboarding bắt buộc sau đăng ký: hỏi lớp + ≥3 mục tiêu + giọng AI + giờ/tuần.
 *  Trạng thái suy từ DB (grade/goals/preferences) để resume đúng bước dở. */

function onboardingErrorMessage(failure, fallback) {
  const detail = failure.response?.data?.detail
  if (detail) return typeof detail === 'string' ? detail : 'Thông tin onboarding chưa hợp lệ.'
  if (failure.response?.status === 401) return 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.'
  return failure.response ? fallback : 'Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.'
}

/** GET /api/onboarding/status — {grade, goals_count, has_preferences, completed, missing, next_step}. */
export async function fetchOnboardingStatus() {
  try {
    const { data } = await api.get('/api/onboarding/status')
    return {
      grade: data?.grade ?? null,
      goalsCount: Number(data?.goals_count ?? data?.goalsCount ?? 0),
      hasPreferences: !!(data?.has_preferences ?? data?.hasPreferences),
      aiTone: data?.ai_tone ?? data?.aiTone ?? null,
      weeklyHours: data?.weekly_hours ?? data?.weeklyHours ?? null,
      completed: !!data?.completed,
      missing: Array.isArray(data?.missing) ? data.missing : [],
      nextStep: data?.next_step ?? data?.nextStep ?? 'grade',
    }
  } catch (failure) {
    throw { ...failure, friendlyMessage: onboardingErrorMessage(failure, 'Không tải được trạng thái onboarding.') }
  }
}

/** POST /api/onboarding/complete — lưu 4 nhóm vào từng bảng, trả status mới. */
export async function completeOnboarding({ grade, aiTone, weeklyHours, goals } = {}) {
  const payload = {
    grade: String(grade || '').trim(),
    ai_tone: String(aiTone || 'cute').trim(),
    weekly_hours: Number(weeklyHours),
    goals: (Array.isArray(goals) ? goals : []).map(item => ({
      title: String(item.title || '').trim(),
      ...(item.targetScore ?? item.target_score ?? null) !== null && String(item.targetScore ?? item.target_score ?? '') !== ''
        ? { target_score: Number(item.targetScore ?? item.target_score) }
        : {},
      icon: String(item.icon || '🌱').slice(0, 16) || '🌱',
      start_date: item.startDate || item.start_date,
      end_date: item.endDate || item.end_date || item.date,
    })),
  }
  try {
    const { data } = await api.post('/api/onboarding/complete', payload)
    return {
      grade: data?.grade ?? null,
      goalsCount: Number(data?.goals_count ?? 0),
      hasPreferences: !!(data?.has_preferences),
      completed: !!data?.completed,
      missing: Array.isArray(data?.missing) ? data.missing : [],
      nextStep: data?.next_step ?? 'done',
    }
  } catch (failure) {
    throw { ...failure, friendlyMessage: onboardingErrorMessage(failure, 'Không lưu được onboarding. Vui lòng thử lại.') }
  }
}

export default api
