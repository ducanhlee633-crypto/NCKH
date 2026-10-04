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

/** Tên hiển thị: ưu tiên profile.name -> username -> email. */
export function displayUser(session) {
  if (!session) return null
  const { user, profile } = session
  return {
    id: user.id,
    email: user.email,
    name: profile?.name || profile?.username || (user.email ? user.email.split('@')[0] : 'Bạn'),
    username: profile?.username ?? null,
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
export async function registerUser({ email, password, name, username }) {
  try {
    const { data } = await api.post('/api/auth/signup', {
      email: email.trim(),
      password,
      name: name?.trim() || '',
      ...(username?.trim() ? { username: username.trim() } : {}),
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

export async function syncProfile({ username, name }) {
  const { data } = await api.patch('/api/users/me', {
    ...(username ? { username: username.trim().toLowerCase() } : {}),
    ...(name ? { name: name.trim() } : {}),
  })
  return data
}

export async function deleteAccount() {
  await api.delete('/api/users/me')
  clearSession()
}

export default api
