export const defaultSettings = { avatar: '', grade: '', theme: 'light', color: 'blue', ranking: true, streak: true, sound: true, reminders: true, reminderMinutes: 15, weeklyHours: 24, aiTone: 'cute' }
export const grades = ['6', '7', '8', '9', '10', '11', '12']
export const gradeLabel = grade => grades.includes(String(grade)) ? `Lớp ${grade} · ${Number(grade) <= 9 ? 'THCS' : 'THPT'}` : 'Học theo nhịp của bạn'
export const colors = { blue: ['Xanh dương', 216], violet: ['Tím', 268], gold: ['Vàng', 38], mint: ['Xanh lá', 162] }
// Chất giọng AI — key lưu DB (ai_tone) + localStorage (aiTone). Giữ key tiếng Anh gọn để API ổn định,
// label tiếng Việt hiển thị ở SettingsPage.
export const AI_TONES = {
  cute: ['Dễ thương, gần gũi', '🥰', 'Ngọt ngào, thân thiện như bạn thân'],
  honest: ['Thẳng thắn, thật thà', '🎯', 'Nói thẳng trọng tâm, không vòng vo'],
  funny: ['Vui vẻ, hài hước', '😄', 'Vui tươi, thêm chút hài hước khi động viên'],
  empathetic: ['Đồng cảm', '💗', 'Nhẹ nhàng, lắng nghe và động viên'],
}
export const AI_TONE_VALUES = Object.keys(AI_TONES)
export const aiToneLabel = tone => AI_TONES[tone]?.[0] ?? AI_TONES.cute[0]
export function normalizeAiTone(value) {
  return AI_TONE_VALUES.includes(String(value)) ? String(value) : 'cute'
}
export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('nhip-hoc-settings')) || {}
    delete stored.email // dọn key thừa của ô Email liên hệ đã xóa
    delete stored.name // dọn key thừa của ô Họ và tên (máy này) đã xóa
    delete stored.nickname // dọn key thừa của ô Biệt danh (máy này) đã xóa
    return { ...defaultSettings, ...stored, aiTone: normalizeAiTone(stored.aiTone ?? stored.ai_tone) }
  } catch { return { ...defaultSettings } }
}
export function applySettings(settings) {
  window.dispatchEvent(new CustomEvent('nhip-hoc-settings-preview', { detail: settings }))
  document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light'
  document.documentElement.style.setProperty('--accent-hue', colors[settings.color]?.[1] ?? 216)
}
// Ghi settings xuống localStorage + báo cho các hook useStoredState.
// Tách riêng để App (boot) và SettingsPage (fetch server) dùng chung,
// tránh mỗi nơi tự setItem/dispatch một kiểu rồi quên.
export function persistSettings(settings) {
  try {
    localStorage.setItem('nhip-hoc-settings', JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent('nhip-hoc-storage', { detail: { key: 'nhip-hoc-settings' } }))
  } catch { /* bỏ qua: state trong memory vẫn đúng */ }
}
