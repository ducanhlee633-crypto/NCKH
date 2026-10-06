import { useEffect, useMemo, useState } from 'react'
import useStoredState from './useStoredState'
import {
  createDailyTask,
  dailyTaskFromServer,
  dailyTaskToPayload,
  dailyTasksLocalForMigration,
  fetchDailyTasks,
  getSession,
  onSessionChange,
} from '../backendApi'

export const DAILY_TASK_MIGRATED_KEY = 'nhip-hoc-daily-tasks-migrated'
const DAILY_TASK_BACKUP_KEY = 'nhip-hoc-daily-tasks-backup-before-migrate'
// Giữ đúng key local cũ của Dashboard để không mất việc đang có.
const LOCAL_KEY = 'nhip-hoc-tasks'

const readLocalList = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Nguồn sự thật duy nhất cho việc hằng ngày (Dashboard).
 * - Chưa đăng nhập: đọc localStorage `nhip-hoc-tasks` (shape cũ {id,title,done}
 *   vẫn đọc được, Dashboard chuẩn hóa khi hiển thị).
 * - Đã đăng nhập: chỉ đọc server (đã normalize về UI shape
 *   {id,title,description,subject,date,priority,done,position}),
 *   KHÔNG fallback về local trong lúc loading để tránh flash ghost.
 */
export default function useDailyTasks() {
  const [localTasks, setLocalTasks, localError] = useStoredState(LOCAL_KEY, [])
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
    fetchDailyTasks()
      .then(async rows => {
        if (!mounted) return
        setSyncError('')
        // Migrate 1 lần duy nhất: đẩy task local cũ lên server khi server còn trống.
        if (rows.length === 0 && !localStorage.getItem(DAILY_TASK_MIGRATED_KEY)) {
          const payloads = dailyTasksLocalForMigration(readLocalList())
          if (payloads.length) {
            try {
              const created = []
              for (const payload of payloads) {
                created.push(await createDailyTask(payload))
              }
              rows = [...rows, ...created]
            } catch {
              if (mounted) setSyncError('Không đẩy được việc cũ lên server. Việc mới vẫn sẽ lưu online.')
            }
          }
          try {
            localStorage.setItem(DAILY_TASK_MIGRATED_KEY, '1')
          } catch {
            /* bỏ qua */
          }
          // Server đã là truth sau migrate -> dọn local để không còn ghost.
          if (mounted) setLocalTasks([])
        } else if (localStorage.getItem(DAILY_TASK_MIGRATED_KEY)) {
          // Đã migrate nhưng local vẫn còn xác cũ: backup rồi dọn.
          try {
            const stale = readLocalList()
            if (stale.length > 0) {
              if (!localStorage.getItem(DAILY_TASK_BACKUP_KEY)) {
                localStorage.setItem(DAILY_TASK_BACKUP_KEY, JSON.stringify(stale))
              }
              localStorage.setItem(LOCAL_KEY, JSON.stringify([]))
              if (mounted) setLocalTasks([])
            }
          } catch {
            /* bỏ qua */
          }
        }
        if (mounted) setServerRows(rows)
      })
      .catch(() => {
        if (mounted) {
          setSyncError('Không tải được việc hằng ngày từ server. Kiểm tra backend và đăng nhập lại.')
          setServerRows([])
        }
      })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const serverTasks = useMemo(
    () => (loggedIn && serverRows ? serverRows.map(dailyTaskFromServer) : null),
    [loggedIn, serverRows],
  )

  // QUAN TRỌNG: khi đã login thì KHÔNG fallback về local.
  const tasks = loggedIn ? (serverTasks ?? []) : (Array.isArray(localTasks) ? localTasks : [])
  const loadingTasks = loggedIn && serverRows === null

  return {
    loggedIn,
    loadingTasks,
    tasks,
    serverRows,
    setServerRows,
    localTasks,
    setLocalTasks,
    localError,
    syncError,
    setSyncError,
    toPayload: dailyTaskToPayload,
    fromServer: dailyTaskFromServer,
  }
}
