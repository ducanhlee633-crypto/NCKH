import { useCallback, useEffect, useState } from 'react'
import { CardHeader, EmptyState, PageIntro, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import {
  acceptFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  friendDisplayName,
  getSession,
  rejectFriendRequest,
  removeFriend,
  searchUsers,
  sendFriendRequest,
} from '../backendApi'
import useStoredState from '../data/useStoredState'
import { defaultSettings } from '../data/settings'

/** Lấy username hiển thị từ FriendshipDetail (backend kèm sẵn friend). */
const detailUsername = detail => detail?.friend?.username || ''
const detailName = detail => friendDisplayName(detail?.friend)

export default function FriendsPage({ onNavigate }) {
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searched, setSearched] = useState('')
  const [sending, setSending] = useState({})
  const [sent, setSent] = useState({})
  const [notice, setNotice] = useState('')

  const [friends, setFriends] = useState([])
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [acting, setActing] = useState({})

  const [storedSettings] = useStoredState('nhip-hoc-settings', defaultSettings)
  const settings = { ...defaultSettings, ...storedSettings }
  const session = getSession()

  const reload = useCallback(async () => {
    if (!getSession()) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [friendRows, incomingRows, outgoingRows] = await Promise.all([
        fetchFriends(),
        fetchFriendRequests('incoming'),
        fetchFriendRequests('outgoing'),
      ])
      setFriends(friendRows)
      setIncoming(incomingRows)
      setOutgoing(outgoingRows)
    } catch (failure) {
      setLoadError(failure.friendlyMessage || 'Không tải được danh sách bạn bè.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const openSearch = () => {
    setQuery('')
    setResults([])
    setSearched('')
    setSearchError('')
    setNotice('')
    setShowSearch(true)
  }

  /** Tìm theo username — đúng contract backend GET /friends/search?q=. */
  const handleSearch = async event => {
    event.preventDefault()
    const keyword = query.trim()
    if (!keyword) return
    setSearching(true)
    setSearchError('')
    try {
      const rows = await searchUsers(keyword)
      setResults(rows)
      setSearched(keyword)
    } catch (failure) {
      setSearchError(failure.friendlyMessage || 'Không tìm được bạn.')
      setResults([])
      setSearched(keyword)
    } finally {
      setSearching(false)
    }
  }

  /** Gửi lời mời — đúng contract POST /friends/requests {username}. */
  const handleSend = async profile => {
    const username = profile.username
    if (!username || sending[username]) return
    setSending(prev => ({ ...prev, [username]: true }))
    setSearchError('')
    try {
      const created = await sendFriendRequest(username)
      setSent(prev => ({ ...prev, [username]: true }))
      // Hai bên cùng gửi -> backend tự accept, reload để hiện vào danh sách bạn.
      if (created?.status === 'accepted') {
        setNotice(`Hai bạn đã là bạn bè với ${username}.`)
        await reload()
      } else {
        setNotice(`Đã gửi lời mời tới ${username}.`)
        const rows = await fetchFriendRequests('outgoing')
        setOutgoing(rows)
      }
    } catch (failure) {
      setSearchError(failure.friendlyMessage || 'Không gửi được lời mời.')
    } finally {
      setSending(prev => ({ ...prev, [username]: false }))
    }
  }

  const handleAccept = async detail => {
    const username = detailUsername(detail)
    if (!username) return
    setActing(prev => ({ ...prev, [username]: 'accept' }))
    try {
      await acceptFriendRequest(username)
      await reload()
    } catch (failure) {
      setLoadError(failure.friendlyMessage || 'Không chấp nhận được lời mời.')
    } finally {
      setActing(prev => ({ ...prev, [username]: null }))
    }
  }

  const handleReject = async detail => {
    const username = detailUsername(detail)
    if (!username) return
    setActing(prev => ({ ...prev, [username]: 'reject' }))
    try {
      await rejectFriendRequest(username)
      await reload()
    } catch (failure) {
      setLoadError(failure.friendlyMessage || 'Không từ chối được lời mời.')
    } finally {
      setActing(prev => ({ ...prev, [username]: null }))
    }
  }

  const handleRemove = async detailOrUsername => {
    const username = typeof detailOrUsername === 'string' ? detailOrUsername : detailUsername(detailOrUsername)
    if (!username) return
    if (!window.confirm(`Hủy kết bạn / hủy lời mời với ${username}?`)) return
    setActing(prev => ({ ...prev, [username]: 'remove' }))
    try {
      await removeFriend(username)
      await reload()
    } catch (failure) {
      setLoadError(failure.friendlyMessage || 'Không xóa được quan hệ bạn bè.')
    } finally {
      setActing(prev => ({ ...prev, [username]: null }))
    }
  }

  if (!session) {
    return (
      <>
        <PageIntro eyebrow="CÙNG NHAU TIẾN BỘ" title="Bạn bè" subtitle="Đăng nhập để tìm bạn và gửi lời mời kết bạn." />
        <SectionCard>
          <EmptyState icon="🔒" title="Bạn cần đăng nhập để dùng tính năng bạn bè" button="Đăng nhập" onAction={() => onNavigate('login')} tone="pink" />
        </SectionCard>
      </>
    )
  }

  return (
    <>
      <PageIntro eyebrow="CÙNG NHAU TIẾN BỘ" title="Bạn bè" subtitle="Tìm theo username và gửi lời mời kết bạn. Đối phương chấp nhận thì hiện ở danh sách bên dưới." action="Tìm bạn" onAction={openSearch} />
      {loadError && <p role="alert" style={{ color: '#c0392b' }}>{loadError}</p>}

      <div className="friends-layout">
        <SectionCard className="friends-board">
          <CardHeader icon="♧" title={`Bạn bè của bạn (${friends.length})`} action="Tìm bạn" onAction={openSearch} />
          {loading ? (
            <p>Đang tải…</p>
          ) : friends.length ? (
            friends.map(detail => {
              const username = detailUsername(detail)
              return (
                <div className="friend-result" key={detail.id}>
                  <b>{detailName(detail)}</b>
                  <span>@{username}</span>
                  <div>
                    <button type="button" className="outline-button" disabled={acting[username] === 'remove'} onClick={() => handleRemove(detail)}>
                      {acting[username] === 'remove' ? 'Đang hủy…' : 'Hủy kết bạn'}
                    </button>
                  </div>
                </div>
              )
            })
          ) : (
            <EmptyState icon="🦊" title="Chưa có bạn bè" button="Tìm bạn mới" onAction={openSearch} tone="pink" />
          )}
          <div className="friend-tip">{settings.streak ? '🔥 Bạn đang chia sẻ chuỗi học với bạn bè.' : '🔒 Chuỗi học của bạn đang được giữ riêng tư.'}</div>
        </SectionCard>

        <div style={{ display: 'grid', gap: 25, alignContent: 'start' }}>
          <SectionCard>
            <CardHeader icon="✉️" title={`Lời mời đến (${incoming.length})`} tone="gold" />
            {incoming.length ? (
              incoming.map(detail => {
                const username = detailUsername(detail)
                return (
                  <div className="friend-result" key={detail.id}>
                    <b>{detailName(detail)}</b>
                    <span>@{username} muốn kết bạn</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="primary-button" disabled={!!acting[username]} onClick={() => handleAccept(detail)}>
                        {acting[username] === 'accept' ? 'Đang chấp nhận…' : 'Chấp nhận'}
                      </button>
                      <button type="button" className="outline-button" disabled={!!acting[username]} onClick={() => handleReject(detail)}>
                        {acting[username] === 'reject' ? 'Đang từ chối…' : 'Từ chối'}
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <p>Chưa có lời mời nào.</p>
            )}
          </SectionCard>

          <SectionCard>
            <CardHeader icon="📤" title={`Đã gửi (${outgoing.length})`} tone="violet" />
            {outgoing.length ? (
              outgoing.map(detail => {
                const username = detailUsername(detail)
                return (
                  <div className="friend-result" key={detail.id}>
                    <b>{detailName(detail)}</b>
                    <span>@{username} — đang chờ chấp nhận</span>
                    <div>
                      <button type="button" className="outline-button" disabled={acting[username] === 'remove'} onClick={() => handleRemove(detail)}>
                        Hủy lời mời
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <p>Bạn chưa gửi lời mời nào.</p>
            )}
          </SectionCard>
        </div>
      </div>

      {showSearch && (
        <Modal title="Tìm bạn" onClose={() => setShowSearch(false)}>
          <form onSubmit={handleSearch}>
            <label>
              Username
              <input
                autoFocus
                required
                minLength={1}
                maxLength={64}
                value={query}
                onChange={event => {
                  setQuery(event.target.value)
                  setSearched('')
                  setResults([])
                  setSearchError('')
                }}
                placeholder="Nhập username (VD: minhanh)"
              />
            </label>
            <button className="primary-button" disabled={!query.trim() || searching}>
              {searching ? 'Đang tìm…' : 'Tìm kiếm'}
            </button>
          </form>
          {notice && <p style={{ color: '#1e7e34' }}>{notice}</p>}
          {searchError && <p role="alert" style={{ color: '#c0392b' }}>{searchError}</p>}
          <div aria-live="polite">
            {searched && !searching && !searchError && (
              results.length ? (
                results.map(user => (
                  <div className="friend-result" key={user.id}>
                    <b>{user.nickname || user.username}</b>
                    <span>@{user.username}</span>
                    <div>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!!sending[user.username] || !!sent[user.username]}
                        onClick={() => handleSend(user)}
                      >
                        {sent[user.username] ? 'Đã gửi lời mời' : sending[user.username] ? 'Đang gửi…' : 'Kết bạn'}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p>Không tìm thấy ai với “{searched}”.</p>
              )
            )}
          </div>
          <p><small>Backend tìm gần đúng theo username (không phân biệt hoa/thường), không hiện chính bạn.</small></p>
        </Modal>
      )}
    </>
  )
}
