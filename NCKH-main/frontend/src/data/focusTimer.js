// Single source of truth cho timer Phòng tập trung.
//
// Vấn đề: PomodoroPage từng unmount mỗi khi user chuyển sang page khác nên
// timer (deadline + running trong useRef/useState) bị mất và đồng hồ reset.
// Cách sửa:
// - PomodoroPage được giữ mounted nền (xem App.jsx) và là owner duy nhất ghi
//   state timer xuống localStorage.
// - Các nơi khác (badge mini ở Topbar) chỉ đọc qua read/subscribe, tự tính
//   thời gian còn lại từ `deadline` nên luôn đúng dù user đang ở page nào.

export const FOCUS_TIMER_KEY = 'nhip-hoc-focus-timer'
export const FOCUS_TIMER_EVENT = 'nhip-hoc-focus-timer'

export function remainingFromDeadline(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline)) return 0
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

export function formatClock(totalSeconds) {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? Math.floor(totalSeconds) : 0)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

// { mode: 0|1|2, running: boolean, deadline: number|null, remaining: seconds }
export function readFocusTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOCUS_TIMER_KEY))
    if (!saved || typeof saved !== 'object') return null
    const mode = saved.mode === 1 || saved.mode === 2 ? saved.mode : 0
    if (typeof saved.running !== 'boolean') return null
    const remaining = Number.isInteger(saved.remaining) && saved.remaining >= 0 ? saved.remaining : null
    const deadline = Number.isFinite(saved.deadline) ? saved.deadline : null
    if (remaining === null) return null
    if (saved.running && deadline === null) return null
    return { mode, running: saved.running, deadline, remaining }
  } catch {
    return null
  }
}

export function writeFocusTimer(state, { silent = false } = {}) {
  try {
    localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify(state))
  } catch {
    // Hết quota / chặn storage: vẫn giữ timer trong memory của PomodoroPage.
  }
  if (!silent) window.dispatchEvent(new CustomEvent(FOCUS_TIMER_EVENT))
}

export function subscribeFocusTimer(listener) {
  const sync = () => listener(readFocusTimer())
  const onStorage = (event) => {
    if (event.key === FOCUS_TIMER_KEY) sync()
  }
  window.addEventListener(FOCUS_TIMER_EVENT, sync)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(FOCUS_TIMER_EVENT, sync)
    window.removeEventListener('storage', onStorage)
  }
}
