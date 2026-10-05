Nhịp Học — quy chuẩn giao diện học sinh
Cập nhật: 03/10/2026

Đối tượng là học sinh Việt Nam từ lớp 6 đến lớp 12. Nhiệm vụ chính của giao diện: giúp học sinh biết mình cần học gì tiếp theo, nhìn được lịch học và bắt đầu một việc vừa sức. Giữ bản sắc xanh dương cùng các điểm nhấn tím, xanh mint và vàng hiện có; giảm trang trí để nội dung dễ đọc hơn.

Hướng thiết kế: “Sổ học tập của bạn”. Một cuốn sổ mở kết hợp việc cần làm và lịch tuần, gợi đúng bối cảnh ghi bài, ôn tập, nộp bài của học sinh. Thân thiện nhưng không trẻ con; không dùng cấp độ trò chơi hay điểm XP cố định để tạo cảm giác tiến bộ giả.

Hai hướng bố cục đã cân nhắc:

```text
A. Bảng tổng hợp
[Chào bạn] [Số liệu] [Số liệu] [Số liệu]
[Việc cần làm               ] [Tiện ích]

B. Sổ học tập — hướng được chọn
[Chào bạn, hôm nay học gì?             ]
[Bước học tiếp theo    | Tuần của bạn  ]
[Việc cần làm] [Hạn nộp] [Phút tập trung]
[Danh sách việc        | Lịch hôm nay  ]
[Hạn nộp sắp tới       | Phòng tập trung]
```

Hướng A dễ trở thành bảng thống kê chung cho mọi sản phẩm. Hướng B đặt hành động học tập trước số liệu. Chi tiết nhận diện duy nhất là trang sổ có dòng kẻ nhẹ, nhãn đánh dấu vàng và lịch tuần. Các thẻ còn lại giữ nền sạch, không thêm hình trang trí hoặc chuyển động liên tục.

Bảng màu giữ nguyên

- Xanh chủ đạo: #1460D2; hành động chính, điều hướng đang chọn, ngày hiện tại.
- Tím: #8B45DC, nền nhạt #F0E4FF; việc cần làm và tiến độ.
- Mint: #149A7E, nền nhạt #CFF8EA; tập trung và nhịp học.
- Vàng nhạt: #FFF0BC; nhãn sổ học tập và điểm nhấn nhẹ.
- Nền ứng dụng: #F3F8FF; tương ứng HSL hiện có với hue 216.
- Nền nội dung: #FFFFFF; thẻ, trang sổ và vùng nhập liệu.

Chữ chính dùng --ink hiện có; chữ phụ #69748A. Viền dùng --line hiện có. Hạn nộp tiếp tục dùng cam nhạt #FFEDCB. Không đưa thêm màu thương hiệu. Xanh chủ đạo vẫn lấy từ --accent-hue để các lựa chọn màu trong cài đặt hoạt động như trước. Màu chỉ hỗ trợ nhận biết; trạng thái còn có nhãn, biểu tượng, viền hoặc dấu chọn.

Chế độ tối tiếp tục dùng nền #101722, thẻ #1B2534, chữ #E6EDF7 và chữ phụ #B5C0D1. Trang sổ, lịch tuần, thẻ tập trung và ô hạn nộp có nền tối tương ứng. Không áp nguyên nền pastel sáng lên trang tối.

Chữ và khoảng cách

Baloo 2 dùng tiết chế cho thương hiệu, tiêu đề trang và lời mở đầu trong sổ. Nunito dùng cho nội dung, điều hướng, tiêu đề thẻ, nút và biểu mẫu. Giữ font dự phòng system-ui, sans-serif khi font mạng chưa tải được.

- Tiêu đề trang: 28–36 px, đậm 700, dòng 1,25; điện thoại 27–29 px.
- Tiêu đề trang sổ: 30–42 px; tiêu đề thẻ: 17 px, đậm 800.
- Nội dung: 14–16 px, dòng 1,55–1,6; chú thích: 12 px. Nhãn lịch rất ngắn có thể dùng 11 px.
- Khoảng cách theo nhịp 4/8/12/16/24/32 px. Thẻ có đệm 24 px, điện thoại 16–20 px.
- Bo góc thẻ 20 px; nút 12 px; ô nhập 10 px. Bóng nhẹ, viền 1 px.
- Số phút, giờ và số liệu dùng chữ số có độ rộng bằng nhau khi thích hợp.

Cấu trúc và nội dung

Điều hướng thống nhất: Góc học tập; Lịch học; Trợ lý học tập; Phòng tập trung; Lộ trình học; Mục tiêu; Tiến bộ của bạn; Bạn bè; Cài đặt; Trợ giúp. Dùng cùng tên ở menu, tiêu đề trang và hướng dẫn. Biểu tượng menu dùng chung SVG nét mảnh; luôn đi kèm chữ.

Góc học tập mở bằng ngày hiện tại và lời chào. Trang sổ gợi việc chưa hoàn thành đầu tiên; nếu chưa có việc thì nút đưa con trỏ đến ô thêm việc. Khi đã có việc, nút mở phòng tập trung. Lịch tuần bắt đầu thứ Hai, đánh dấu hôm nay và các ngày có lịch; liên kết mở trang lịch học. Danh sách việc có ba bộ lọc: Tất cả, Chưa xong, Đã xong. Không gắn nhãn “tuần này” cho công việc chưa có ngày.

Ba số liệu chính là việc chưa hoàn thành, hạn nộp trong bảy ngày tới và phút tập trung hôm nay. Số phút tính từ các phiên 25 phút đã hoàn thành; không tính thời gian đang chạy hoặc phiên nghỉ. Tiến độ lấy từ các việc đã đánh dấu xong. Không hiển thị chuỗi học hoặc XP giả định.

Lịch hôm nay và trang Lịch học dùng chung dữ liệu: lịch tự thêm, bài trong lộ trình và hạn nộp. Hạn nộp hiển thị giờ nộp. Biểu mẫu dùng ngày/tháng/năm theo ngữ cảnh tiếng Việt, giờ 24 tiếng, tên môn quen thuộc. Trường môn học cho phép gõ tên riêng và gợi ý 12 môn trong SCHOOL_SUBJECTS (Toán, Ngữ văn, Tiếng Anh, Vật lí, Hóa học, Sinh học, Lịch sử, Địa lí, Khoa học tự nhiên, Tin học, Công nghệ, GDCD — xem frontend/src/data/subjects.js, mirror backend/subjects.py); đây là gợi ý, không phải danh mục chương trình bắt buộc. Phòng tập trung dùng 12 nhãn khóa cứng tương ứng (tên ngắn Lí/Hoá/Văn/Sử/Địa/Tin/KHTN/GDCD + Dự án cho hoạt động ngoài môn học), khớp CHECK trong Supabase.

Hồ sơ cho chọn lớp 6–9 trong nhóm THCS, lớp 10–12 trong nhóm THPT. Lớp đã lưu xuất hiện đồng nhất ở thanh trên, hồ sơ bên trái và trang sổ. Chưa chọn lớp thì mời chọn, không mặc định mọi người là học sinh THPT. Hiện tại lớp là thông tin hồ sơ; chưa tự thay nội dung hay chương trình học theo lớp.

Trợ lý học tập đưa ra bốn cách mở câu hỏi: gợi ý cách giải, lên kế hoạch ôn, hiểu kiến thức, tự kiểm tra. Mẫu câu hỏi khuyến khích nêu lớp, phần chưa hiểu và cách đã thử. Khi chưa nối dịch vụ AI, nói rõ chưa thể trả lời; thao tác chỉ lưu câu hỏi trên thiết bị. Không trình bày trạng thái “sẵn sàng hỗ trợ” như một dịch vụ đã hoạt động.

Phòng tập trung giữ chu kỳ 25 phút học, 5 phút nghỉ và tùy chọn nghỉ dài. Lộ trình chia nội dung thành các bài; Mục tiêu có hạn hoàn thành. Tiến bộ của bạn thể hiện bài và thời lượng thực tế, có bộ lọc tuần/tháng/năm học. Năm học tính từ tháng 9 đến trước tháng 9 năm sau; không khóa cứng một niên khóa. Bỏ khối huy hiệu và phần thưởng chưa được tính từ dữ liệu.

Góp ý được lưu riêng trên thiết bị, có xác nhận sau khi lưu. Không dùng nhãn “Gửi” khi chưa có nơi nhận. Trạng thái cài đặt nói “Đã lưu trên thiết bị”, không khẳng định đã sao lưu hoặc xác thực tài khoản.

Giọng văn

Xưng “bạn”, câu ngắn, thân thiện và cụ thể. Dùng “Hạn nộp”, “Phòng tập trung”, “Chuỗi học” thay cho Deadline, Focus, Streak. Nút gọi đúng việc sẽ xảy ra: Thêm việc, Lưu hạn nộp, Mở lịch học, Lưu thiết lập. Trạng thái trống chỉ ra bước tiếp theo; lỗi lưu cho biết cần thử lại. Không dùng ngôn ngữ gây áp lực như cuộc đua, nhiệt kế kỷ luật hoặc thưởng điểm không có dữ liệu.

Điện thoại và khả năng tiếp cận

Máy tính dùng sidebar 236 px và nội dung tối đa 1392 px. Dưới 980 px, trang sổ xếp dọc và cột chính thu về một cột. Dưới 760 px, sidebar thành dải điều hướng ngang cuộn được, giữ cả chữ lẫn biểu tượng; mọi trang, kể cả cài đặt và trợ giúp, vẫn truy cập được. Dưới 480 px, các thẻ phụ xếp dọc và nút thêm việc rộng toàn hàng. Thanh điều hướng là vùng được phép cuộn ngang có chủ đích; nội dung chính cần vừa khung từ 320 px.

Nút chính có vùng bấm tối thiểu 44 px. Ô nhập trên điện thoại dùng chữ 16 px. Giữ focus bàn phím rõ, liên kết bỏ qua điều hướng, nhãn biểu mẫu, một h1 mỗi trang và trạng thái aria-current/aria-pressed. Thanh tiến độ có giá trị cho trình đọc màn hình; SVG trang trí được ẩn khỏi cây trợ năng. Tôn trọng prefers-reduced-motion; không thêm animation nền hoặc hiệu ứng vẫy liên tục.

Triển khai và kiểm tra

Quy chuẩn chung nằm ở frontend/src/styles/student-design.css, được nạp sau các stylesheet từng trang. Màu gốc vẫn nằm trong app-shell.css và theme.css. Icon.jsx cung cấp bộ biểu tượng điều hướng; PageComponents.jsx giữ các thành phần dùng chung. calendarEvents trong data/calendar.js ghép lịch để trang chính và lịch học không lệch dữ liệu.

Đã kiểm tra build production, lint và render React phía máy chủ cho 10 trang, với dữ liệu trống và dữ liệu mẫu cho trang chính. Kiểm tra lịch ghép đủ ba nguồn, không thay đổi dữ liệu gốc, lớp học và phút tập trung hiển thị đúng. Kiểm tra render không thay thế kiểm tra tương tác trên trình duyệt.

Chưa xác nhận trực quan bằng ảnh chụp ở các kích thước 320/390/768/1440 px: môi trường hiện tại không cấp quyền Computer Use và không có trình duyệt kết nối. Cần đối chiếu các kích thước này, chế độ tối, điều hướng bàn phím, lưu lớp và các luồng thêm việc/hạn nộp khi có trình duyệt kiểm thử.
