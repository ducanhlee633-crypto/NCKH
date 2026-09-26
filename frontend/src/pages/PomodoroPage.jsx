import { CardHeader, SectionCard, SegmentedControl } from '../components/PageComponents'

export default function PomodoroPage({ onNavigate }) {
  return (
    <>
      <PageHeading />
      <div className="focus-layout">
        <SectionCard className="focus-card">
          <CardHeader icon="◷" title="Phòng tập trung" tone="blue" />
          <SegmentedControl items={['Tập trung 25’', 'Nghỉ 5’', 'Nghỉ 15’']} />
          <div className="focus-ring"><div><strong>25:00</strong><span>Sẵn sàng bắt đầu</span></div></div>
          <div className="cycle-row"><span>Chu kỳ phiên hôm nay</span><b>0 / 4</b></div><div className="cycle-dots"><i /><i /><i /><i /></div>
          <div className="focus-actions"><button className="primary-button">▶ &nbsp; Bắt đầu</button><button className="icon-button" aria-label="Đặt lại thời gian">↻</button></div>
        </SectionCard>
        <aside className="focus-side">
          <SectionCard><CardHeader icon="♧" title="Bạn bè" /><div className="online-row"><span>0 trực tuyến</span><button className="ghost-button" onClick={() => onNavigate('friends')}>♧ Mời bạn</button></div></SectionCard>
          <SectionCard><CardHeader icon="▤" title="Thống kê" tone="mint" /><div className="focus-stats"><div><b>⌛</b><strong>0 giờ</strong></div><div><b>♧</b><strong>0 lần</strong></div></div></SectionCard>
        </aside>
      </div>
      <SectionCard className="sound-card"><CardHeader icon="♧" title="Âm thanh" /><div className="sound-options"><button>🌧️ &nbsp; Mưa</button><button>≋ &nbsp; Sóng</button><button>☕ &nbsp; Quán cà phê</button></div></SectionCard>
    </>
  )
}

function PageHeading() {
  return <div className="simple-heading"><div><p className="eyebrow">⏱️ NHỊP HỌC TẬP TRUNG</p><h1>Pomodoro & Focus</h1><p className="page-subtitle">Một khoảng tập trung nhỏ có thể tạo ra tiến bộ lớn.</p></div><div className="focus-tip">💡 Mẹo: Để điện thoại xa tầm tay</div></div>
}
