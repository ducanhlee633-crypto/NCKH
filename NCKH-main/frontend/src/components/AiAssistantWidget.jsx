import { useEffect, useRef, useState } from 'react'
import AiMarkdown from './AiMarkdown'
import { aiMessagesToPayload, getSession, sendAiChat } from '../backendApi'

const ROBOT_SRC = '/robot-assistant.png'
const GREETING = 'Chào bạn! Mình là robot Nhịp Học. Nhấn giữ và kéo mình đi khắp màn hình nhé — nhấn nhẹ để mở chat học tập!'
const FAB = 72
const PAD = 12
const PANEL_W = 360
const PANEL_H = 500

function toUiMessage(role, text) {
  return { id: crypto.randomUUID(), role, text: String(text ?? '') }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Ngưỡng phân biệt nhấn nhẹ (mở chat) với kéo (di chuyển robot). */
const DRAG_THRESHOLD = 6

export default function AiAssistantWidget() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => [toUiMessage('assistant', GREETING)])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Robot bắt đầu ở góc phải-dưới, người dùng nhấn giữ để kéo đi khắp màn hình.
  const [pos, setPos] = useState(() => ({
    x: Math.max(PAD, window.innerWidth - FAB - 20),
    y: Math.max(PAD, window.innerHeight - FAB - 20),
  }))
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  // Co màn hình thì kéo robot + panel vào trong khung nhìn.
  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      setPos((prev) => ({
        x: clamp(prev.x, PAD, Math.max(PAD, window.innerWidth - FAB - PAD)),
        y: clamp(prev.y, PAD, Math.max(PAD, window.innerHeight - FAB - PAD)),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, sending, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    }
    setDragging(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* bỏ qua */ }
  }

  function handlePointerMove(event) {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true
    if (drag.moved) {
      setPos({
        x: clamp(drag.origX + dx, PAD, Math.max(PAD, window.innerWidth - FAB - PAD)),
        y: clamp(drag.origY + dy, PAD, Math.max(PAD, window.innerHeight - FAB - PAD)),
      })
    }
  }

  function handlePointerUp(event) {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    // Nhấn nhẹ (không kéo) thì đóng/mở chat; đã kéo thì chỉ di chuyển, không mở chat.
    if (drag && !drag.moved) setOpen((was) => !was)
    try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* bỏ qua */ }
  }

  async function send(event) {
    event?.preventDefault()
    const question = input.trim()
    if (!question || sending) return
    if (!getSession()) {
      setError('Hãy đăng nhập để chat với AI.')
      return
    }
    setError('')
    const next = [...messages, toUiMessage('user', question)]
    setMessages(next)
    setInput('')
    inputRef.current?.focus()
    setSending(true)
    try {
      const reply = await sendAiChat(aiMessagesToPayload(next))
      setMessages((old) => [...old, toUiMessage('assistant', reply)])
    } catch (failure) {
      setError(failure?.friendlyMessage || 'Không nhận được câu trả lời từ AI. Vui lòng thử lại.')
    } finally {
      setSending(false)
    }
  }

  // Panel bám theo robot: robot ở nửa dưới thì panel hiện phía trên, ngược lại hiện phía dưới.
  const panelW = Math.min(PANEL_W, viewport.w - 24)
  const panelH = Math.min(PANEL_H, viewport.h - 130)
  const panelLeft = clamp(pos.x + FAB / 2 - panelW / 2, PAD, Math.max(PAD, viewport.w - panelW - PAD))
  const panelTopRaw = pos.y > viewport.h / 2 ? pos.y - panelH - PAD : pos.y + FAB + PAD
  const panelTop = clamp(panelTopRaw, PAD, Math.max(PAD, viewport.h - panelH - PAD))

  return (
    <div className="ai-widget" aria-hidden={false}>
      {open && (
        <section
          className="ai-widget-panel"
          role="dialog"
          aria-label="Chat nhanh với trợ lý AI"
          style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }}
        >
          <header className="ai-widget-header">
            <img src={ROBOT_SRC} alt="" aria-hidden="true" className="ai-widget-avatar" />
            <div className="ai-widget-title">
              <b>Trợ lý Nhịp Học</b>
              <small>{sending ? 'AI đang trả lời…' : 'Luôn sẵn sàng giúp bạn'}</small>
            </div>
            <a className="ai-widget-expand" href="#assistant" title="Mở trang trợ lý đầy đủ">⤢</a>
            <button className="ai-widget-close" onClick={() => setOpen(false)} aria-label="Đóng chat">×</button>
          </header>

          <div className="ai-widget-messages" ref={listRef} role="log" aria-label="Tin nhắn chat nhanh">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'assistant' ? 'ai-widget-ai' : 'ai-widget-user'}>
                {message.role === 'assistant'
                  ? <AiMarkdown text={message.text} />
                  : <p>{message.text}</p>}
              </div>
            ))}
            {sending && <div className="ai-widget-ai ai-widget-typing"><p>Đang suy nghĩ…</p></div>}
          </div>

          {error && <p className="ai-widget-error" role="alert">{error}</p>}

          <form className="ai-widget-composer" onSubmit={send}>
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Hỏi nhanh… (môn, lớp, phần chưa hiểu)"
              aria-label="Hỏi nhanh trợ lý AI"
              disabled={sending}
              maxLength={4000}
            />
            <button type="submit" disabled={!input.trim() || sending} aria-label="Gửi câu hỏi">
              {sending ? '…' : '↑'}
            </button>
          </form>
        </section>
      )}

      <button
        className={dragging ? 'ai-widget-fab dragging' : 'ai-widget-fab'}
        style={{ left: pos.x, top: pos.y, transition: dragging ? 'none' : undefined }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-expanded={open}
        aria-label={open ? 'Đóng trợ lý AI' : 'Mở trợ lý AI'}
        title="Nhấn giữ để kéo mình đi — nhấn nhẹ để chat!"
      >
        <img src={ROBOT_SRC} alt="Robot trợ lý AI" draggable={false} />
      </button>
    </div>
  )
}
