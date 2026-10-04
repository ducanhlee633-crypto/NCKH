import { useEffect, useMemo, useState } from 'react'
import useStoredState from './useStoredState'
import {
  createDeadline,
  deadlineFromServer,
  deadlineToPayload,
  deadlinesLocalForMigration,
  fetchDeadlines,
  getSession,
  onSessionChange,
} from '../backendApi'

export const DEADLINE_MIGRATED_KEY = 'nhip-hoc-deadlines-migrated'
const DEADLINE_BACKUP_KEY = 'nhip-hoc-deadlines-backup-before-migrate'

const readLocalList = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('nhip-hoc-deadlines'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Nguồn sự thật duy nhất cho deadline.
 * - Chưa đăng nhập: đọc localStorage `nhip-hoc-deadlines`.
 * - Đã đăng nhập: chỉ đọc server (đã normalize về {id,title,date,time,end,priority}),
 *   KHÔNG fallback về local trong lúc loading để tránh flash ghost.
 */
export default function useDeadlines() {
  const [localDeadlines, setLocalDeadlines, localError] = useStoredState('nhip-hoc-deadlines', [])
  const [session, setSession] = useState(() => getSession())
  const loggedIn = !!session
  const [serverRows, setServerRows] = useState(null)
  const [syncError, setSyncError] = useState('')

  useEffect(
    () =>
      onSessionChange(next => {
        setSession(next)
        if (!next) {
          setServerRows(null)
          setSyncError('')
        }
      }),
    [],
  )

  useEffect(() => {
    if (!loggedIn) return
    let mounted = true
    setServerRows(null)
    fetchDeadlines()
      .then(async rows => {
        if (!mounted) return
        setSyncError('')
        // Migrate 1 lần duy nhất: đẩy deadline local cũ lên server khi server còn trống.
        if (rows.length === 0 && !localStorage.getItem(DEADLINE_MIGRATED_KEY)) {
          const payloads = deadlinesLocalForMigration(readLocalList())
          if (payloads.length) {
            try {
              const created = []
              for (const payload of payloads) {
                created.push(await createDeadline(payload))
              }
              rows = [...rows, ...created]
            } catch {
              if (mounted) setSyncError('Không đẩy được hạn nộp cũ lên server. Hạn mới vẫn sẽ lưu online.')
            }
          }
          try {
            localStorage.setItem(DEADLINE_MIGRATED_KEY, '1')
          } catch {
            /* bỏ qua */
          }
          // Server đã là truth sau migrate -> dọn local để không còn ghost.
          if (mounted) setLocalDeadlines([])
        } else if (localStorage.getItem(DEADLINE_MIGRATED_KEY)) {
          // Đã migrate nhưng local vẫn còn xác cũ: backup rồi dọn.
          try {
            const stale = readLocalList()
            if (stale.length > 0) {
              if (!localStorage.getItem(DEADLINE_BACKUP_KEY)) {
                localStorage.setItem(DEADLINE_BACKUP_KEY, JSON.stringify(stale))
              }
              localStorage.setItem('nhip-hoc-deadlines', JSON.stringify([]))
              if (mounted) setLocalDeadlines([])
            }
          } catch {
            /* bỏ qua */
          }
        }
        if (mounted) setServerRows(rows)
      })
      .catch(() => {
        if (mounted) {
          setSyncError('Không tải được hạn nộp từ server. Kiểm tra backend và đăng nhập lại.')
          setServerRows([])
        }
      })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const serverDeadlines = useMemo(
    () => (loggedIn && serverRows ? serverRows.map(deadlineFromServer) : null),
    [loggedIn, serverRows],
  )

  // QUAN TRỌNG: khi đã login thì KHÔNG fallback về local.
  const deadlines = loggedIn ? (serverDeadlines ?? []) : (Array.isArray(localDeadlines) ? localDeadlines : [])
  const loadingDeadlines = loggedIn && serverRows === null

  return {
    loggedIn,
    loadingDeadlines,
    deadlines,
    serverRows,
    setServerRows,
    localDeadlines,
    setLocalDeadlines,
    localError,
    syncError,
    setSyncError,
    // Helper dùng chung để page không cần nhớ shape server.
    toPayload: deadlineToPayload,
    fromServer: deadlineFromServer,
  }
}
