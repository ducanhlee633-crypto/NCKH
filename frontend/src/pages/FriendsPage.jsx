import { CardHeader, EmptyState, PageIntro, SectionCard } from '../components/PageComponents'

export default function FriendsPage({ onNavigate }) {
  return (
    <>
      <PageIntro eyebrow="🌈 HỌC CÙNG ĐỒNG ĐỘI" title="Bạn bè & Bảng xếp hạng" subtitle="Cùng nhau giữ nhịp học và cổ vũ những tiến bộ nhỏ mỗi ngày." action="Tìm bạn" />
      <div className="friends-layout">
        <SectionCard className="friends-board"><CardHeader icon="♧" title="Bạn bè của bạn" action="Mời bạn" /><EmptyState icon="🦊" title="Chưa có bạn bè" button="Tìm bạn mới" tone="pink" /><div className="friend-tip">✨ Học cùng một người bạn giúp bạn có thêm động lực mỗi ngày.</div></SectionCard>
        <SectionCard><CardHeader icon="🏆" title="Bảng xếp hạng tuần" tone="gold" /><div className="leaderboard-empty"><div>🏅</div><b>Bạn sẽ xuất hiện ở đây</b><p>Hoàn thành buổi học đầu tiên để bắt đầu cuộc đua thân thiện.</p><button className="primary-button" onClick={() => onNavigate('pomodoro')}>Đến Pomodoro</button></div></SectionCard>
      </div>
    </>
  )
}
