import { useEffect, useMemo, useState } from 'react'
import useStoredState from './useStoredState'
import {
  createWeeklyTask,
  fetchWeeklyTasks,
  getSession,
  onSessionChange,
  weeklyTaskFromServer,
  weeklyTaskToPayload,
  weeklyTasksLocalForMigration,
} from '../backendApi'

export const WEEKLY_TASK_MIGRATED_KEY = 'nhip-hoc-weekly-tasks-migrated'
const WEEKLY_TASK_BACKUP_KEY = 'nhip-hoc-weekly-tasks-backup-before-migrate'
const LOCAL_KEY = 'nhip-hoc-weekly-tasks'

const readLocalList = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Nguồn sự thật duy nhất cho việc trong tuần.
 * - Chưa đăng nhập: đọc localStorage `nhip-hoc-weekly-tasks` (giữ seed mẫu ở Page).
 * - Đã đăng nhập: chỉ đọc server (đã normalize về UI shape),
 *   KHÔNG fallback về local trong lúc loading để tránh flash ghost.
 */
export default function useWeeklyTasks() {
  const [localTasks, setLocalTasks, localError] = useStoredState(LOCAL_KEY, null)
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
    fetchWeeklyTasks()
      .then(async rows => {
        if (!mounted) return
        setSyncError('')
        // Migrate 1 lần duy nhất: đẩy task local cũ lên server khi server còn trống.
        if (rows.length === 0 && !localStorage.getItem(WEEKLY_TASK_MIGRATED_KEY)) {
          const payloads = weeklyTasksLocalForMigration(readLocalList())
          if (payloads.length) {
            try {
              const created = []
              for (const payload of payloads) {
                created.push(await createWeeklyTask(payload))
              }
              rows = [...rows, ...created]
            } catch {
              if (mounted) setSyncError('Không đẩy được việc cũ lên server. Việc mới vẫn sẽ lưu online.')
            }
          }
          try {
            localStorage.setItem(WEEKLY_TASK_MIGRATED_KEY, '1')
          } catch {
            /* bỏ qua */
          }
          // Server đã là truth sau migrate -> dọn local để không còn ghost.
          if (mounted) setLocalTasks([])
        } else if (localStorage.getItem(WEEKLY_TASK_MIGRATED_KEY)) {
          // Đã migrate nhưng local vẫn còn xác cũ: backup rồi dọn.
          try {
            const stale = readLocalList()
            if (stale.length > 0) {
              if (!localStorage.getItem(WEEKLY_TASK_BACKUP_KEY)) {
                localStorage.setItem(WEEKLY_TASK_BACKUP_KEY, JSON.stringify(stale))
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
          setSyncError('Không tải được việc trong tuần từ server. Kiểm tra backend và đăng nhập lại.')
          setServerRows([])
        }
      })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const serverTasks = useMemo(
    () => (loggedIn && serverRows ? serverRows.map(weeklyTaskFromServer) : null),
    [loggedIn, serverRows],
  )

  // QUAN TRỌNG: khi đã login thì KHÔNG fallback về local.
  // localTasks === null (chưa có gì) coi như [] để Page tự seed khi offline.
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
    toPayload: weeklyTaskToPayload,
    fromServer: weeklyTaskFromServer,
  }
}
