# Thiết kế Nhịp Học

Nhịp Học là không gian học tập cá nhân, ưu tiên cảm giác nhẹ nhàng, rõ ràng và khuyến khích tiến bộ từng bước.

## Nguyên tắc

- Nội dung chia thành các thẻ nhỏ, có khoảng trắng và tiêu đề rõ để giảm tải nhận thức.
- Thao tác quan trọng có trạng thái rỗng, biểu mẫu, phản hồi lỗi và nút hành động rõ ràng.
- Dữ liệu được lưu trong localStorage để lịch học, mục tiêu, môn học, cài đặt và avatar còn nguyên ở lần truy cập sau.

## Màu sắc

Nền sáng trung tính làm nền cho các màu nhấn xanh dương, xanh mint, vàng, cam và tím. Màu nhấn dùng để phân loại ngữ cảnh; chữ và đường viền giữ độ tương phản cao. Chế độ tối được điều khiển qua thuộc tính theme.

## Kiểu chữ và bố cục

Tiêu đề lớn tạo điểm neo, văn bản phụ ngắn và dễ quét. Bố cục responsive chuyển từ lưới nhiều cột sang một cột trên màn hình hẹp. Nút, liên kết, modal và biểu mẫu có nhãn và hỗ trợ bàn phím.

## Luồng sản phẩm

Landing giới thiệu giá trị và dẫn đến đăng ký. Ứng dụng gồm tổng quan, lịch, lộ trình, mục tiêu, thống kê, Pomodoro, trợ lý AI, bạn bè và cài đặt. Các trang dùng chung AppShell, Sidebar, Card, Modal và điều hướng hash.

## Hình ảnh tài khoản

Avatar được lưu cùng cài đặt cá nhân và hiển thị trong hồ sơ bên Sidebar. Quyền riêng tư có thể bật tắt; trạng thái tắt dùng màu xám.


## Chi tiết các màn hình

- Tổng quan: việc cần làm, hạn chót trong 7 ngày và lời nhắc. Thêm hạn chót trong modal mà không rời trang.
- Lịch: các chế độ ngày, tuần, tháng, năm; lịch học và deadline dùng cùng nguồn dữ liệu. Một danh sách deadline hiển thị tất cả hạn chót.
- Mục tiêu: tiêu đề, emoji, ngày bắt đầu và hoàn thành dự kiến; tiến độ kết nối với lộ trình.
- Lộ trình: chia mục tiêu thành bài học có lịch và trạng thái hoàn thành.
- Thống kê: lọc bài học theo tuần hiện tại, tháng hiện tại hoặc năm học 01/09/2026–31/08/2027. Thời lượng lấy từ bài hoàn thành. Báo cáo dùng hộp thoại in để lưu PDF.
- Pomodoro: phiên tập trung 25 phút và nghỉ 5/15 phút, thống kê phiên học.
- Trợ lý: lưu câu hỏi, cuộc trò chuyện và tài liệu trong trình duyệt. Tệp lưu cả nội dung và có liên kết tải lại; giới hạn 2 MB mỗi lượt và báo lỗi nếu hết dung lượng.
- Bạn bè: trạng thái rỗng khi chưa có bạn; tìm trong danh sách người dùng hiện có.
- Cài đặt: hồ sơ, ảnh, màu chủ đạo, chế độ sáng/tối, quyền riêng tư và nhắc học. Ảnh và tên được đồng bộ sang Sidebar khi lưu.
- Trợ giúp: hướng dẫn thao tác. Landing và Auth giữ nội dung giới thiệu; các thẻ tính năng dẫn đến đăng ký, ba bước là nội dung tĩnh.

## Trạng thái và lưu trữ

Bản cập nhật khởi tạo không gian trống đúng một lần, lưu bản sao dữ liệu cũ tại khóa nhip-hoc-backup-before-clean-start trước khi reset. Các lần truy cập tiếp theo giữ dữ liệu mới. Không dùng dữ liệu mẫu làm tiến độ thật. localStorage chỉ lưu trên trình duyệt hiện tại, không đồng bộ thiết bị. Nút đăng xuất và đổi tài khoản trở về giao diện đăng nhập; Auth hiện chưa tích hợp xác thực backend, dữ liệu chưa được phân tách theo tài khoản.

## Ngôn ngữ thị giác

Logo trong Sidebar dùng SVG nét currentColor thay emoji nhiều màu để theo màu chủ đạo. Nền trung tính và chữ tương phản đi cùng các màu pastel phân biệt nhóm nội dung. Avatar cắt vừa khung. Biểu tượng quyền riêng tư và công tắc chuyển xám khi tắt. Modal dùng dialog, đóng được bằng Escape, có nhãn và thao tác hủy. Bản in ẩn Sidebar và nút để ưu tiên số liệu.


## Cập nhật giao diện

Đã bỏ trang giới thiệu và đăng nhập/đăng ký. Ứng dụng mở trực tiếp Tổng quan; đường dẫn cũ chuyển về Tổng quan. Bỏ các nút phiên tài khoản vốn dẫn đến trang đã xóa. Chế độ đêm dùng nền #101722, thẻ #1b2534, chữ chính #e6edf7 và chữ phụ #b5c0d1. Ô nhập, lịch, mục tiêu, thống kê và popup dùng cùng hệ màu tối; công tắc tắt màu xám, bật theo màu chủ đạo được chọn. Số hạn chót hiển thị ở hàng riêng dưới tiêu đề để không chồng nút Thêm.
