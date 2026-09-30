export function initializeWorkspace() {
  const version = 'nhip-hoc-clean-start-v1'
  try {
    if (localStorage.getItem(version)) return
    const keys = Object.keys(localStorage).filter(key => key.startsWith('nhip-hoc-') && !key.startsWith('nhip-hoc-backup-'))
    const backup = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]))
    if (keys.length) localStorage.setItem('nhip-hoc-backup-before-clean-start', JSON.stringify(backup))
    keys.forEach(key => localStorage.removeItem(key))
    localStorage.setItem(version, '1')
  } catch { /* Preserve existing records if the browser refuses storage. */ }
}
