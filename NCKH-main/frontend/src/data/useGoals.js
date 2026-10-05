import { useEffect, useMemo, useState } from 'react'
import useStoredState from './useStoredState'
import {
  createGoal,
  fetchGoals,
  getSession,
  goalFromServer,
  goalToPayload,
  goalsLocalForMigration,
  onSessionChange,
} from '../backendApi'

export const GOAL_MIGRATED_KEY = 'nhip-hoc-goals-migrated'
const GOAL_BACKUP_KEY = 'nhip-hoc-goals-backup-before-migrate'

const readLocalList = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('nhip-hoc-goals'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Nguồn sự thật duy nhất cho mục tiêu.
 * - Chưa đăng nhập: đọc localStorage `nhip-hoc-goals`.
 * - Đã đăng nhập: chỉ đọc server (đã normalize về UI shape),
 *   KHÔNG fallback về local trong lúc loading để tránh flash ghost.
 */
export default function useGoals() {
  const [localGoals, setLocalGoals, localError] = useStoredState('nhip-hoc-goals', [])
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
    fetchGoals()
      .then(async rows => {
        if (!mounted) return
        setSyncError('')
        // Migrate 1 lần duy nhất: đẩy goal local cũ lên server khi server còn trống.
        if (rows.length === 0 && !localStorage.getItem(GOAL_MIGRATED_KEY)) {
          const payloads = goalsLocalForMigration(readLocalList())
          if (payloads.length) {
            try {
              const created = []
              for (const payload of payloads) {
                created.push(await createGoal(payload))
              }
              rows = [...rows, ...created]
            } catch {
              if (mounted) setSyncError('Không đẩy được mục tiêu cũ lên server. Mục tiêu mới vẫn sẽ lưu online.')
            }
          }
          try {
            localStorage.setItem(GOAL_MIGRATED_KEY, '1')
          } catch {
            /* bỏ qua */
          }
          // Server đã là truth sau migrate -> dọn local để không còn ghost.
          if (mounted) setLocalGoals([])
        } else if (localStorage.getItem(GOAL_MIGRATED_KEY)) {
          // Đã migrate nhưng local vẫn còn xác cũ: backup rồi dọn.
          try {
            const stale = readLocalList()
            if (stale.length > 0) {
              if (!localStorage.getItem(GOAL_BACKUP_KEY)) {
                localStorage.setItem(GOAL_BACKUP_KEY, JSON.stringify(stale))
              }
              localStorage.setItem('nhip-hoc-goals', JSON.stringify([]))
              if (mounted) setLocalGoals([])
            }
          } catch {
            /* bỏ qua */
          }
        }
        if (mounted) setServerRows(rows)
      })
      .catch(() => {
        if (mounted) {
          setSyncError('Không tải được mục tiêu từ server. Kiểm tra backend và đăng nhập lại.')
          setServerRows([])
        }
      })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const serverGoals = useMemo(
    () => (loggedIn && serverRows ? serverRows.map(goalFromServer) : null),
    [loggedIn, serverRows],
  )

  // QUAN TRỌNG: khi đã login thì KHÔNG fallback về local.
  const goals = loggedIn ? (serverGoals ?? []) : (Array.isArray(localGoals) ? localGoals : [])
  const loadingGoals = loggedIn && serverRows === null

  return {
    loggedIn,
    loadingGoals,
    goals,
    serverRows,
    setServerRows,
    localGoals,
    setLocalGoals,
    localError,
    syncError,
    setSyncError,
    toPayload: goalToPayload,
    fromServer: goalFromServer,
  }
}
