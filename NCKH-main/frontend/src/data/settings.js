export const defaultSettings = { avatar: '', grade: '', theme: 'light', color: 'blue', ranking: true, streak: true, sound: true, reminders: true, reminderMinutes: 15, weeklyHours: 24 }
export const grades = ['6', '7', '8', '9', '10', '11', '12']
export const gradeLabel = grade => grades.includes(String(grade)) ? `Lớp ${grade} · ${Number(grade) <= 9 ? 'THCS' : 'THPT'}` : 'Học theo nhịp của bạn'
export const colors = { blue: ['Xanh dương', 216], violet: ['Tím', 268], gold: ['Vàng', 38], mint: ['Xanh lá', 162] }
export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('nhip-hoc-settings')) || {}
    delete stored.email // dọn key thừa của ô Email liên hệ đã xóa
    delete stored.name // dọn key thừa của ô Họ và tên (máy này) đã xóa
    delete stored.nickname // dọn key thừa của ô Biệt danh (máy này) đã xóa
    return { ...defaultSettings, ...stored }
  } catch { return { ...defaultSettings } }
}
export function applySettings(settings) {
  window.dispatchEvent(new CustomEvent('nhip-hoc-settings-preview', { detail: settings }))
  document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light'
  document.documentElement.style.setProperty('--accent-hue', colors[settings.color]?.[1] ?? 216)
}
