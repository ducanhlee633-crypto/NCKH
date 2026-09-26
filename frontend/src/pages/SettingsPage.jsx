import { CardHeader, SectionCard } from '../components/PageComponents'

function Toggle({ active = true }) {
  return <span className={'toggle ' + (active ? 'on' : '')}><i /></span>
}

export default function SettingsPage() {
  return (
    <>
      <div className="settings-heading"><div><p className="eyebrow">▣ HỒ SƠ & TÀI KHOẢN</p><h1>Cài đặt cá nhân</h1></div><div className="save-status"><span>✓ Tài khoản xác thực</span><span>☁ Đã sao lưu</span></div></div>
      <div className="settings-grid">
        <div className="settings-main">
          <SectionCard><CardHeader icon="●" title="Hồ sơ học viên" /><p className="card-description">Thông tin hiển thị trên bảng xếp hạng và lớp học</p><div className="profile-preview"><div className="settings-avatar">MA<span>⌕</span></div><div><b>Minh Anh <em>Học viên mới ✦</em></b><p>Gia nhập từ tháng 04/2024 · ID: NH-88219</p></div><button className="ghost-button">Chọn Avatar AI ✨</button></div><div className="field-grid"><label>Họ và tên<input value="Nguyễn Minh Anh" readOnly /></label><label>Biệt danh hiển thị<input value="Minh Anh" readOnly /></label><label className="full">Email liên hệ<input value="minhanh.study@gmail.com" readOnly /></label></div><div className="password-row"><span>◴</span><div><b>Mật khẩu tài khoản</b><small>Đổi lần cuối 30 ngày trước</small></div><button className="ghost-button">Đổi mật khẩu</button></div></SectionCard>
          <SectionCard><CardHeader icon="♧" title="Quyền riêng tư & Bạn bè" /><p className="card-description">Kiểm soát người có thể thấy tiến độ học của bạn</p><div className="setting-list"><div><span>◉</span><p><b>Hiển thị trên Bảng xếp hạng</b><small>Cho phép bạn bè thấy thứ hạng của bạn</small></p><Toggle /></div><div><span>♧</span><p><b>Chia sẻ chuỗi Streak</b><small>Đồng đội cùng khóa có thể cổ vũ bạn</small></p><Toggle /></div></div></SectionCard>
        </div>
        <aside className="settings-side">
          <SectionCard><CardHeader icon="✣" title="Giao diện & Chủ đề" /><p className="card-description">Tùy biến màu sắc dịu mắt cá nhân</p><b className="setting-label">Màu chủ đạo yêu thích</b><div className="color-swatches"><i className="selected" /><i className="violet" /><i className="gold" /><i className="mint" /></div><div className="theme-switch"><span>◐ Chế độ hiển thị</span><button className="selected">☼ Sáng</button><button>☾ Đêm</button></div></SectionCard>
          <SectionCard><CardHeader icon="☷" title="Sở thích học tập" tone="orange" /><p className="card-description">Điều chỉnh theo nhịp sinh học</p><div className="preference-row"><span>◷ Thời gian nhắc nhở</span><b>15 phút trước ca</b></div><div className="preference-row"><span>◎ Mục tiêu tuần cá nhân</span><b>24 giờ / tuần</b></div><div className="preference-row"><span>♪ Âm thanh hoàn thành</span><Toggle /></div></SectionCard>
        </aside>
      </div>
      <div className="settings-footer"><span>✿ Tất cả thay đổi đang ở bộ nhớ tạm<br /><small>Hãy bấm nút lưu bên dưới để cập nhật lên đám mây</small></span><button className="ghost-button">Khôi phục ban đầu</button><button className="primary-button">✓ Lưu thiết lập</button></div>
    </>
  )
}
