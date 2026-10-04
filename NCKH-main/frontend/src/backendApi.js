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

export default api
