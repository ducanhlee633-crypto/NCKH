import { useEffect, useMemo, useState } from 'react'
import useStoredState from './useStoredState'
import {
  createScheduleBlock,
  fetchScheduleBlocks,
  getSession,
  onSessionChange,
} from '../backendApi'
import {
  groupLocalForMigration,
  serverRowsToEventMap,
} from './scheduleRepeat'

export const MIGRATED_KEY = 'nhip-hoc-schedule-migrated'
const DEDUP_BACKUP_KEY = 'nhip-hoc-events-backup-before-dedup'

const readLocalMap = () => {
  try {
    return JSON.parse(localStorage.getItem('nhip-hoc-events')) ?? {}
  } catch {
    return {}
  }
}

/**
 * Nguồn sự thật duy nhất cho lịch học.
 * - Chưa đăng nhập: đọc localStorage `nhip-hoc-events`.
 * - Đã đăng nhập: chỉ đọc server (`serverRowsToEventMap`), KHÔNG fallback
 *   về local trong lúc loading để tránh flash ghost (block đã xóa hiện 1-2s).
 */
export default function useScheduleBlocks() {
  const [localEventMap, setLocalEventMap, localError] = useStoredState('nhip-hoc-events', {})
  const [session, setSession] = useState(() => getSession())
  const loggedIn = !!session
  const [serverRows, setServerRows] = useState(null)
  const [syncError, setSyncError] = useState('')

  useEffect(
    () =>
      onSessionChange((next) => {
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
    // Reset về loading mỗi lần đổi tài khoản / login lại.
    setServerRows(null)
    fetchScheduleBlocks()
      .then(async (rows) => {
        if (!mounted) return
        setSyncError('')
        // Migrate 1 lần duy nhất: đẩy lịch local cũ lên server khi server còn trống.
        if (rows.length === 0 && !localStorage.getItem(MIGRATED_KEY)) {
          const payloads = groupLocalForMigration(readLocalMap())
          if (payloads.length) {
            try {
              for (const payload of payloads) {
                const created = await createScheduleBlock(payload)
                rows = [...rows, created]
              }
            } catch {
              if (mounted) setSyncError('Không đẩy được lịch cũ lên server. Lịch mới vẫn sẽ lưu online.')
            }
          }
          try {
            localStorage.setItem(MIGRATED_KEY, '1')
          } catch {
            /* bỏ qua */
          }
          // Server đã là truth sau migrate -> dọn local để không còn ghost.
          if (mounted) setLocalEventMap({})
        } else if (localStorage.getItem(MIGRATED_KEY)) {
          // Đã migrate từ trước nhưng local vẫn còn xác cũ (vd block IELTS đã
          // xóa trên server): backup rồi dọn để logout cũng không thấy ghost.
          try {
            const stale = readLocalMap()
            if (Object.keys(stale).length > 0) {
              if (!localStorage.getItem(DEDUP_BACKUP_KEY)) {
                localStorage.setItem(DEDUP_BACKUP_KEY, JSON.stringify(stale))
              }
              localStorage.setItem('nhip-hoc-events', JSON.stringify({}))
              if (mounted) setLocalEventMap({})
            }
          } catch {
            /* bỏ qua */
          }
        }
        if (mounted) setServerRows(rows)
      })
      .catch(() => {
        if (mounted) {
          setSyncError('Không tải được lịch từ server. Kiểm tra backend và đăng nhập lại.')
          setServerRows([])
        }
      })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const serverEventMap = useMemo(
    () => (loggedIn && serverRows ? serverRowsToEventMap(serverRows) : null),
    [loggedIn, serverRows],
  )

  // QUAN TRỌNG: khi đã login thì KHÔNG fallback về local.
  // Lúc đang loading (serverRows===null) trả map rỗng để không flash ghost.
  const eventMap = loggedIn ? (serverEventMap ?? {}) : localEventMap
  const loadingSchedule = loggedIn && serverRows === null

  return {
    loggedIn,
    loadingSchedule,
    serverRows,
    setServerRows,
    serverEventMap,
    localEventMap,
    setLocalEventMap,
    localError,
    eventMap,
    syncError,
    setSyncError,
  }
}
