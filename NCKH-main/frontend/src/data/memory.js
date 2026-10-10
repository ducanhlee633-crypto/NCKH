// Trí nhớ dài hạn cho AI — mirror backend/schema.py + agent_tools/long_term_memory.py.
// Tag lưu DB là key tiếng Anh gọn (info/hobby/study/goal/habit/note),
// label tiếng Việt hiển thị ở Settings "Quản lí trí nhớ AI" + AIAssistant.
export const MEMORY_TAGS = {
  info: ['Thông tin cá nhân', '👤', 'Tên, lớp, trường... để AI biết bạn là ai'],
  hobby: ['Sở thích', '🎨', 'Môn thích, game, nhạc, thể thao...'],
  study: ['Học tập', '📚', 'Môn mạnh/yếu, cách học hiệu quả...'],
  goal: ['Mục tiêu', '🎯', 'Điểm muốn đạt, trường muốn vào...'],
  habit: ['Thói quen', '⏰', 'Giờ học, giờ ngủ, cách nghỉ...'],
  note: ['Ghi chú khác', '📝', 'Điều khác muốn AI nhớ'],
}

export const MEMORY_TAG_VALUES = Object.keys(MEMORY_TAGS)
export const MEMORY_CONTENT_MAX = 500
export const MEMORY_MAX_PER_USER = 50

export const memoryTagLabel = (tag) => MEMORY_TAGS[tag]?.[0] ?? MEMORY_TAGS.note[0]
export const memoryTagEmoji = (tag) => MEMORY_TAGS[tag]?.[1] ?? '📝'

export function normalizeMemoryTag(value) {
  return MEMORY_TAG_VALUES.includes(String(value)) ? String(value) : 'note'
}

/** Suy 1-2 tag liên quan từ câu hỏi (mirror backend infer_tags_from_text, đủ dùng ở client). */
export function inferMemoryTags(text) {
  const lowered = ` ${String(text || '').toLowerCase()} `
  const keywords = {
    info: ['tên', 'ten ', 'lớp', 'lop ', 'trường', 'truong', 'tuổi', 'tuoi'],
    hobby: ['thích', 'thich', 'sở thích', 'so thich', 'đam mê', 'dam me', 'game', 'nhạc', 'nhac'],
    study: ['môn', 'mon ', 'học', 'hoc ', 'bài', 'bai ', 'thi ', 'kiểm tra', 'kiem tra', 'ôn ', 'on '],
    goal: ['mục tiêu', 'muc tieu', 'muốn đạt', 'muon dat', 'ước mơ', 'uoc mo', 'nguyện vọng', 'nguyen vong'],
    habit: ['thói quen', 'thoi quen', 'mỗi ngày', 'moi ngay', 'dậy', 'ngủ', 'ngu ', 'nghỉ', 'nghi '],
  }
  const scored = []
  for (const [tag, words] of Object.entries(keywords)) {
    const hits = words.filter((w) => lowered.includes(w)).length
    if (hits) scored.push([hits, tag])
  }
  scored.sort((a, b) => b[0] - a[0])
  return scored.slice(0, 2).map(([, tag]) => tag)
}
