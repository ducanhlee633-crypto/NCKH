import { CardHeader, EmptyState, PageIntro, ProgressBar, SectionCard, SegmentedControl } from '../components/PageComponents'

const days = ['Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6']
const sessions = [
  ['☼ Sáng', '07:00 – 11:30'],
  ['☀ Chiều', '13:00 – 17:30'],
  ['☾ Tối', '18:30 – 22:00'],
]

export default function SchedulePage() {
  return (
    <>
      <PageIntro eyebrow="NHỊP HỌC CỦA BẠN" title="Lịch học tuần này" subtitle="Sắp xếp thời gian để mỗi buổi học đều nhẹ nhàng hơn.">
        <div className="intro-actions"><SegmentedControl items={['Tuần này', 'Hôm nay', 'Cả tháng']} /><button className="primary-button">＋ Thêm ca</button><button className="success-button">▣ + Hạn chót</button></div>
      </PageIntro>
      <div className="summary-grid">
        <div className="summary-chip blue"><span>THỜI KHÓA BIỂU</span><b>0 ca</b><i>▣</i></div>
        <div className="summary-chip gold"><span>HẠN CHÓT</span><b>0 bài</b><i>☷</i></div>
        <div className="summary-chip mint"><span>ÁP LỰC</span><b>Nhẹ nhàng</b><i>⌁</i></div>
      </div>
      <div className="schedule-layout">
        <div className="schedule-main">
          <SectionCard>
            <CardHeader icon="▥" title="Khung giờ tuần này" />
            <div className="week-toolbar"><button className="round-button">‹</button><strong>21 – 27 Tháng 9, 2026</strong><button className="round-button">›</button></div>
            <div className="week-grid">
              <div className="week-corner">Ca học</div>
              {days.map((day, index) => <div className={'day-heading ' + (index === 3 ? 'today' : '')} key={day}><b>{day}</b><span>{21 + index}</span></div>)}
              {sessions.flatMap(([title, time]) => [
                <div className="time-label" key={title}><b>{title}</b><span>{time}</span></div>,
                ...days.map((day, index) => <button className={'calendar-slot ' + (index === 3 ? 'slot-today' : '')} key={title + day}>{index === 3 ? <><b>⊕</b><span>Thêm</span></> : '⊕'}</button>),
              ])}
            </div>
          </SectionCard>
          <SectionCard className="energy-card">
            <CardHeader icon="▥" title="Nhiệt lượng học tập" tone="mint" action="Cân bằng" />
            <div className="energy-bars">{['T2', 'T3', 'T4', 'Thứ 5', 'T6', 'T7', 'CN'].map((day, index) => <div className={index === 3 ? 'energy-day active' : 'energy-day'} key={day}><i style={{ height: '8%' }} /><b>{day}</b><span>0h</span></div>)}</div>
          </SectionCard>
        </div>
        <aside className="schedule-side">
          <SectionCard><CardHeader icon="◷" title="Theo dõi hạn chót" tone="orange" /><EmptyState icon="✓" title="Không có deadline cần lo" button="Thêm hạn chót" tone="orange" /></SectionCard>
          <SectionCard className="goals-card"><CardHeader icon="🎯" title="Mục tiêu tuần này" /><div className="goal-count">0 <small>/ 3</small></div>{['Lên lịch ít nhất 3 ca học', 'Hoàn thành 1 bài nộp trước hạn', 'Duy trì nhịp học đều đặn'].map((goal, index) => <div className="goal-row" key={goal}><span>✓</span><b>{goal}</b><em>+{50 + index * 50} XP</em></div>)}<ProgressBar value={0} /></SectionCard>
        </aside>
      </div>
    </>
  )
}
