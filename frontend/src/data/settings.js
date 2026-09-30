export const defaultSettings = { name: 'Nguyễn Minh Anh', nickname: 'Minh Anh', email: 'minhanh.study@gmail.com', avatar: '', theme: 'light', color: 'blue', ranking: true, streak: true, sound: true }
export const colors = { blue: ['Xanh dương', 216], violet: ['Tím', 268], gold: ['Vàng', 38], mint: ['Xanh lá', 162] }
export function loadSettings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('nhip-hoc-settings')) } } catch { return { ...defaultSettings } }
}
export function applySettings(settings) {
  window.dispatchEvent(new CustomEvent('nhip-hoc-settings-preview', { detail: settings }))
  document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light'
  document.documentElement.style.setProperty('--accent-hue', colors[settings.color]?.[1] ?? 216)
}
