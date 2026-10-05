import { useState } from 'react'
import { GOAL_EMOJI_FALLBACK, GOAL_EMOJI_GROUPS, randomGoalEmoji } from '../data/goalEmojis'

/**
 * Ô chọn biểu tượng kiểu Notion cho form mục tiêu:
 * - Nút preview hiện emoji đang chọn, bấm để mở/đóng lưới gợi ý.
 * - Lưới emoji theo nhóm, bấm 1 cái là chọn ngay (đóng lưới).
 * - Ô "Tự chọn" cho phép dán/nhập emoji riêng + nút Ngẫu nhiên.
 * Giá trị submit qua <input type="hidden" name="emoji"> để FormData đọc được.
 */
export default function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState('')
  const current = value || GOAL_EMOJI_FALLBACK

  function pick(emoji) {
    onChange?.(emoji)
    setOpen(false)
    setCustomError('')
  }

  function submitCustom(event) {
    event.preventDefault()
    const text = String(custom || '').trim()
    if (!text) { setCustomError('Hãy nhập 1 emoji bất kỳ, ví dụ 🦊.'); return }
    if ([...text].length > 16) { setCustomError('Biểu tượng tối đa 16 ký tự.'); return }
    onChange?.(text.slice(0, 16))
    setCustom('')
    setCustomError('')
    setOpen(false)
  }

  return (
    <div className="emoji-field">
      <span className="emoji-label">Biểu tượng mục tiêu</span>
      <div className="emoji-current-row">
        <button
          type="button"
          className="emoji-current"
          aria-expanded={open}
          aria-label="Chọn biểu tượng mục tiêu"
          title="Bấm để chọn biểu tượng khác"
          onClick={() => setOpen(prev => !prev)}
        >
          <span className="emoji-current-icon" aria-hidden="true">{current}</span>
          <span className="emoji-current-text">{open ? 'Đóng' : 'Đổi biểu tượng'}</span>
        </button>
        <button
          type="button"
          className="ghost-button emoji-random"
          title="Chọn ngẫu nhiên 1 biểu tượng gợi ý"
          onClick={() => pick(randomGoalEmoji())}
        >
          🎲 Ngẫu nhiên
        </button>
      </div>

      {open && (
        <div className="emoji-panel" role="dialog" aria-label="Chọn biểu tượng">
          {GOAL_EMOJI_GROUPS.map(group => (
            <div className="emoji-group" key={group.label}>
              <p className="emoji-group-label">{group.label}</p>
              <div className="emoji-grid">
                {group.emojis.map(emoji => (
                  <button
                    key={group.label + emoji}
                    type="button"
                    className={'emoji-option' + (emoji === current ? ' selected' : '')}
                    aria-pressed={emoji === current}
                    aria-label={'Chọn biểu tượng ' + emoji}
                    title={emoji}
                    onClick={() => pick(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <form className="emoji-custom" onSubmit={submitCustom}>
            <label>Tự chọn emoji khác
              <input
                value={custom}
                maxLength={16}
                onChange={event => { setCustom(event.target.value); setCustomError('') }}
                placeholder="Dán emoji bất kỳ, ví dụ 🦊"
              />
            </label>
            <button type="submit" className="outline-button">Dùng emoji này</button>
          </form>
          {customError && <p role="alert" className="emoji-error">{customError}</p>}
        </div>
      )}

      <input type="hidden" name="emoji" value={current} />
    </div>
  )
}
