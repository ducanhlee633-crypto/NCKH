import { useState } from 'react'
import { CardHeader, EmptyState, PageIntro, SectionCard } from '../components/PageComponents'
import Modal from '../components/Modal'
import { getSession } from '../backendApi'
import useStoredState from '../data/useStoredState'
import { defaultSettings } from '../data/settings'
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().trim()
export default function FriendsPage({ onNavigate }) {
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [users] = useStoredState('nhip-hoc-users', [])
  const [friends] = useStoredState('nhip-hoc-friends', [])
  const [storedSettings] = useStoredState('nhip-hoc-settings', defaultSettings)
  const settings = { ...defaultSettings, ...storedSettings }
  const accountEmail = getSession()?.user?.email || ''
  const directory = [...new Map([...users, ...friends].filter(user => user.email !== accountEmail).map(user => [user.id || user.email, user])).values()]
  const matches = searched ? directory.filter(user => [user.name, user.nickname, user.email].some(value => normalize(value).includes(normalize(searched)))) : []
  const openSearch = () => { setQuery(''); setSearched(''); setShowSearch(true) }
  return <>
    <PageIntro eyebrow="CÙNG NHAU TIẾN BỘ" title="Bạn bè" subtitle="Cùng nhau giữ nhịp học và cổ vũ những tiến bộ nhỏ mỗi ngày." action="Tìm bạn" onAction={openSearch} />
    <div className="friends-layout"><SectionCard className="friends-board"><CardHeader icon="♧" title="Bạn bè của bạn" action="Tìm bạn" onAction={openSearch} />{friends.length ? friends.map(friend => <div className="friend-result" key={friend.id || friend.email}><b>{friend.name}</b><span>{friend.email}</span></div>) : <EmptyState icon="🦊" title="Chưa có bạn bè" button="Tìm bạn mới" onAction={openSearch} tone="pink" />}<div className="friend-tip">{settings.streak ? '🔥 Bạn đang chia sẻ chuỗi học với bạn bè.' : '🔒 Chuỗi học của bạn đang được giữ riêng tư.'}</div></SectionCard><SectionCard><CardHeader icon="🏆" title="Bảng xếp hạng tuần" tone="gold" /><div className="leaderboard-empty"><div>🏅</div><b>{settings.ranking ? 'Bạn sẽ xuất hiện ở đây' : 'Bạn đã ẩn khỏi bảng xếp hạng'}</b><p>{settings.ranking ? 'Học theo khả năng của mình, cùng bạn bè chia sẻ tiến bộ.' : 'Bạn có thể bật lại trong phần quyền riêng tư.'}</p><button className="primary-button" onClick={() => onNavigate(settings.ranking ? 'pomodoro' : 'settings')}>{settings.ranking ? 'Vào phòng tập trung' : 'Cài đặt quyền riêng tư'}</button></div></SectionCard></div>
    {showSearch && <Modal title="Tìm bạn" onClose={() => setShowSearch(false)}><form onSubmit={event => { event.preventDefault(); setSearched(query.trim()) }}><label>Tên hoặc email<input autoFocus required maxLength={160} value={query} onChange={event => { setQuery(event.target.value); setSearched('') }} placeholder="Nhập tên hoặc email của bạn bè" /></label><button className="primary-button" disabled={!query.trim()}>Tìm kiếm</button></form><div aria-live="polite">{searched && (matches.length ? matches.map(user => <div className="friend-result" key={user.id || user.email}><b>{user.name || user.nickname}</b><span>{user.email}</span></div>) : <p>Không tìm thấy người phù hợp với “{searched}”.</p>)}</div>{!directory.length && <p>Chưa có danh sách người dùng để tìm kiếm. Tìm bạn trên hệ thống sẽ có khi dịch vụ tài khoản được kết nối.</p>}</Modal>}
  </>
}
