import { CardHeader, ProgressBar, SectionCard } from '../components/PageComponents'

const styles = [['♥', 'Gia sư', 'blue'], ['◷', 'Luyện tập', 'mint'], ['♜', 'Chiến lược', 'gold']]
const prompts = [['ϟ', 'Giải bài'], ['⌁', 'Lập lịch'], ['▤', 'Tóm tắt'], ['✧', 'Ôn tập']]

export default function AIAssistantPage({ onNavigate }) {
  return (
    <>
      <section className="ai-banner"><div className="ai-orb">✦</div><div><p>Trợ lý AI</p><b>Đồng hành học tập cá nhân</b></div><span>● Sẵn sàng hỗ trợ</span></section>
      <div className="ai-layout">
        <aside className="ai-left">
          <button className="new-chat">⊕ <span>+ Cuộc trò<br />chuyện mới</span></button>
          <SectionCard><CardHeader icon="☷" title="Phong cách đồng hành" /><div className="style-list">{styles.map(([icon, label, tone], index) => <button className={index === 0 ? 'selected ' + tone : tone} key={label}><i>{icon}</i><b>{label}</b><span>{index === 0 ? '●' : ''}</span></button>)}</div></SectionCard>
          <SectionCard><CardHeader icon="◴" title="Lịch sử trò chuyện" /><div className="chat-empty"><span>□</span><b>Chưa có cuộc trò chuyện nào</b><p>Gửi một câu hỏi đầu tiên để kích hoạt trí tuệ sáng tạo!</p></div></SectionCard>
          <SectionCard><CardHeader icon="▧" title="Tài liệu & Đề cương" /><div className="upload-box"><span>⇧</span><b>Tải lên đề thi hoặc sách</b><small>Kéo thả hoặc chạm để chọn tệp</small></div></SectionCard>
        </aside>
        <SectionCard className="ai-chat">
          <div className="ai-greeting"><div className="ai-avatar">✦</div><p>Mình có thể giúp gì cho bạn?</p><div className="prompt-grid">{prompts.map(([icon, label]) => <button key={label}><i>{icon}</i><b>{label}</b><span>›</span></button>)}</div></div>
          <div className="chat-composer"><span>⌕</span><span>Σ</span><input aria-label="Câu hỏi cho trợ lý AI" placeholder="Hỏi bất kỳ điều gì..." /><span>♩</span><button aria-label="Gửi câu hỏi">↑</button><small>Gợi ý: Hãy nêu rõ phần bạn chưa hiểu.</small><small>Học từng bước, hiểu thật sâu.</small></div>
        </SectionCard>
        <aside className="ai-right">
          <SectionCard><CardHeader icon="⌁" title="Cấp độ đồng hành" /><div className="level-summary"><b>LV. 1</b><span>Tân thủ <em>0 / 100 EXP</em></span><ProgressBar value={0} /></div></SectionCard>
          <SectionCard><CardHeader icon="✣" title="Thống kê tuần" /><div className="ai-stat-grid"><div><b>✓</b><strong>0</strong><span>Câu hỏi đã giải</span></div><div><b>•</b><strong>0</strong><span>Khái niệm làm chủ</span></div></div></SectionCard>
          <SectionCard><CardHeader icon="☷" title="Sổ tay & Ghi chú thông minh" /><div className="notebook-empty"><span>Chưa lưu<br />mục nào</span><button>Mở sổ tay</button></div></SectionCard>
          <SectionCard><CardHeader icon="⚑" title="Bộ nhớ mục tiêu" /><div className="memory-box"><span>Chưa chọn mục tiêu</span><button onClick={() => onNavigate('roadmap/goal-builder')}>Thiết lập →</button></div></SectionCard>
        </aside>
      </div>
    </>
  )
}
