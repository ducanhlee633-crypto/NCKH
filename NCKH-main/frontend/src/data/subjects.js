// Danh mục môn học dùng chung toàn frontend (single source of truth).
// Mirror với backend/subjects.py — thêm/sửa môn thì sửa cả hai file.
//
// - SCHOOL_SUBJECTS: tên đầy đủ thân thiện, dùng gợi ý ở form tự do
//   (Lịch học, Lộ trình, Hạn nộp) và làm danh sách mặc định cho trang Tiến bộ.
// - POMODORO_SUBJECTS: nhãn khóa cứng của Phòng tập trung, KHỚP CHECK
//   pomodoro_sessions_subject_check trong Supabase (giữ tên ngắn cũ để không
//   vỡ dữ liệu đã lưu; "Dự án" là nhãn chung cho hoạt động ngoài môn học).
// - defaultSubjects: giữ tên cũ để StatsPage/RoadmapPage/SchedulePage
//   (useStoredState 'nhip-hoc-subjects') không phải sửa. Chỉ ảnh hưởng user
//   mới (user cũ đã có danh sách trong localStorage thì giữ nguyên).

export const SCHOOL_SUBJECTS = [
  'Toán',
  'Ngữ văn',
  'Tiếng Anh',
  'Vật lí',
  'Hóa học',
  'Sinh học',
  'Lịch sử',
  'Địa lí',
  'Khoa học tự nhiên',
  'Tin học',
  'Công nghệ',
  'GDCD',
]

export const POMODORO_SUBJECTS = [
  'Toán',
  'Lí',
  'Hoá',
  'Văn',
  'Sinh',
  'Sử',
  'Địa',
  'Tin',
  'Dự án',
  'Tiếng Anh',
  'KHTN',
  'GDCD',
]

export const defaultSubjects = [...SCHOOL_SUBJECTS]
