/** Bộ emoji gợi ý cho mục tiêu — kiểu Notion: chọn nhanh trong lưới + tự nhập. */

export const GOAL_EMOJI_GROUPS = [
  {
    label: 'Phổ biến',
    emojis: ['🌱', '🎯', '⭐', '🚀', '🌟', '💡', '🔥', '💪'],
  },
  {
    label: 'Học tập',
    emojis: ['📚', '📖', '📝', '✏️', '🎓', '🧠', '💻', '🔬', '📐', '🌍'],
  },
  {
    label: 'Môn học & hoạt động',
    emojis: ['➗', '🧪', '📜', '🎨', '🎵', '⚽', '🏃', '🧘', '♟️', '🌱'],
  },
  {
    label: 'Động lực',
    emojis: ['🏆', '🥇', '🎉', '👏', '🙌', '💯', '✅', '🎖️'],
  },
  {
    label: 'Thư giãn',
    emojis: ['🌷', '🌻', '🍀', '🌙', '☀️', '🌈', '☁️', '🎈', '🍵', '🎧'],
  },
]

export const GOAL_EMOJI_FALLBACK = '🌱'

/** Lấy ngẫu nhiên 1 emoji trong bộ gợi ý (nút "Ngẫu nhiên" kiểu Notion). */
export function randomGoalEmoji() {
  const all = GOAL_EMOJI_GROUPS.flatMap(group => group.emojis)
  return all[Math.floor(Math.random() * all.length)] || GOAL_EMOJI_FALLBACK
}
