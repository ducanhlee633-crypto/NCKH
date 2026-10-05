import { useEffect, useMemo, useState } from 'react'
import { fetchRoadmaps, getSession, onSessionChange, roadmapFromServer } from '../backendApi'

function readLocalRoadmaps() {
  try {
    const raw = JSON.parse(localStorage.getItem('nhip-hoc-roadmaps'))
    return Array.isArray(raw) ? raw.filter(item => item?.id && Array.isArray(item.lessons)) : []
  } catch {
    return []
  }
}

/**
 * Nguồn hiển thị lộ trình cho Lịch/Dashboard:
 * - Đã đăng nhập: đọc server (roadmaps + stages + lessons), map về UI shape.
 * - Chưa đăng nhập: đọc localStorage cũ để lịch cũ không trắng (lộ trình mới bắt buộc login mới tạo).
 */
export default function useRoadmaps() {
  const [session, setSession] = useState(() => getSession())
  const loggedIn = !!session
  const [serverRows, setServerRows] = useState(null)

  useEffect(() => onSessionChange(setSession), [])

  useEffect(() => {
    if (!loggedIn) { setServerRows(null); return }
    let mounted = true
    setServerRows(null)
    fetchRoadmaps()
      .then(rows => { if (mounted) setServerRows(rows) })
      .catch(() => { if (mounted) setServerRows([]) })
    return () => { mounted = false }
  }, [loggedIn])

  const roadmaps = useMemo(() => {
    if (!loggedIn) return readLocalRoadmaps()
    return (Array.isArray(serverRows) ? serverRows : []).map(roadmapFromServer)
      .filter(item => item?.id && Array.isArray(item.lessons))
  }, [loggedIn, serverRows])

  return { loggedIn, loadingRoadmaps: loggedIn && serverRows === null, roadmaps, serverRows, setServerRows }
}
