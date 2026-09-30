import { useEffect, useRef, useState } from 'react'
function readStored(key, fallback) {
 try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
export default function useStoredState(key, initialValue) {
 const fallback = useRef(initialValue)
 const [value, setValue] = useState(() => readStored(key, initialValue))
 const [error, setError] = useState('')
 useEffect(() => {
  const sync = event => {
   if (event.type === 'storage' ? event.key === key || event.key === null : event.detail?.key === key) setValue(readStored(key, fallback.current))
  }
  window.addEventListener('storage', sync)
  window.addEventListener('nhip-hoc-storage', sync)
  return () => { window.removeEventListener('storage', sync); window.removeEventListener('nhip-hoc-storage', sync) }
 }, [key])
 function save(next) {
  try {
   const result = typeof next === 'function' ? next(readStored(key, fallback.current)) : next
   localStorage.setItem(key, JSON.stringify(result)); setValue(result); setError('')
   window.dispatchEvent(new CustomEvent('nhip-hoc-storage', { detail: { key } }))
   return true
  } catch { setError('Chưa lưu được dữ liệu. Hãy kiểm tra quyền lưu của trình duyệt rồi thử lại.'); return false }
 }
 return [value, save, error]
}
