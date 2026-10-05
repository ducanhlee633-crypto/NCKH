import useStoredState from '../data/useStoredState'
import { AI_TONES, loadSettings, normalizeAiTone } from '../data/settings'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CardHeader, SectionCard } from '../components/PageComponents'
import {
  aiMessageFromServer,
  aiMessagesToPayload,
  createAiMessage,
  createAiSession,
  deleteAiSession,
  fetchAiMessages,
  fetchAiSessions,
  getSession,
  sendAiChat,
} from '../backendApi'

const prompts = [['ϟ', 'Gợi ý cách giải', 'Mình học lớp …, đang làm bài … Mình đã thử … Hãy gợi ý bước tiếp theo.'], ['⌁', 'Lên kế hoạch ôn', 'Mình cần ôn môn … trước ngày … Mỗi ngày mình có … phút.'], ['▤', 'Hiểu kiến thức', 'Giải thích kiến thức … bằng một ví dụ phù hợp với lớp …'], ['✧', 'Tự kiểm tra', 'Đặt 5 câu hỏi về … để mình tự kiểm tra phần đã học.'], ['🔎', 'Tìm tài liệu', 'Tìm tài liệu về … cho học sinh lớp …']]
const greeting = 'Bạn đang vướng ở phần nào?'

/** Tách URL trong text thuần thành link bấm được (tin nhắn AI chứa link tài liệu). */
const urlPattern = /(https?:\/\/[^\s<>()]+)/g
const trailingPunctuation = /[.,;:!?)\]}>]+$/
function renderWithLinks(text) {
  return String(text).split(urlPattern).map((part, index) => {
    if (index % 2 === 0) return part
    const stripped = part.replace(trailingPunctuation, '')
    const tail = part.slice(stripped.length)
    if (!stripped) return part
    return <span key={index}><a href={stripped} target="_blank" rel="noopener noreferrer">{stripped}</a>{tail}</span>
  })
}

/** Chuẩn hóa message cũ (chỉ có {id,text}) thành {id, role, text} để chat 2 chiều. */
function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null
  const text = String(message.text ?? message.content ?? '').trim()
  if (!text) return null
  return {
    id: message.id || crypto.randomUUID(),
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text,
  }
}

export default function AIAssistantPage() {
  const loggedIn = !!getSession()
  const [input, setInput, inputError] = useStoredState('nhip-hoc-chat-input', '')
  // Lịch sử local chỉ dùng khi chưa đăng nhập (khách chỉ đọc, không gọi được AI).
  const [history, setHistory, historyError] = useStoredState('nhip-hoc-chat-history', [])
  const [localActiveId, setLocalActiveId, localActiveIdError] = useStoredState('nhip-hoc-chat-activeId', null)
  const [files, setFiles, filesError] = useStoredState('nhip-hoc-chat-files', [])

  // Lịch sử server (ai_sessions + ai_messages) khi đã đăng nhập.
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(loggedIn)
  const [sessionsError, setSessionsError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [deleting, setDeleting] = useState({})

  const [sending, setSending] = useState(false)
  // Chất giọng AI đang dùng (SettingsPage -> user_preferences.ai_tone).
  // Đọc localStorage + nghe event đổi setting để huy hiệu cập nhật ngay.
  const [aiTone, setAiTone] = useState(() => {
    try { return normalizeAiTone(loadSettings().aiTone) } catch { return 'cute' }
  })
  useEffect(() => {
    const sync = (event) => {
      const next = event?.detail?.aiTone ?? event?.detail?.ai_tone
      if (next) { setAiTone(normalizeAiTone(next)); return }
      try { setAiTone(normalizeAiTone(loadSettings().aiTone)) } catch { /* giữ giọng cũ */ }
    }
    window.addEventListener('nhip-hoc-settings-preview', sync)
    window.addEventListener('nhip-hoc-storage', sync)
    return () => {
      window.removeEventListener('nhip-hoc-settings-preview', sync)
      window.removeEventListener('nhip-hoc-storage', sync)
    }
  }, [])
  const [aiError, setAiError] = useState('')
  const [saveWarning, setSaveWarning] = useState('')
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const messagesRef = useRef(null)

  const safeMessages = (Array.isArray(messages) ? messages : []).map(normalizeMessage).filter(Boolean)

  const reloadSessions = useCallback(async () => {
    if (!getSession()) {
      setSessionsLoading(false)
      return
    }
    setSessionsLoading(true)
    setSessionsError('')
    try {
      setSessions(await fetchAiSessions())
    } catch (failure) {
      setSessionsError(failure.friendlyMessage || 'Không tải được lịch sử trò chuyện.')
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    reloadSessions()
  }, [reloadSessions])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [messages, sending])

  // ---- Luồng khách (chưa đăng nhập): giữ hành vi cũ, lưu trên thiết bị ----
  function saveLocalChat(currentMessages = messages, currentId = localActiveId) {
    if (!currentMessages.length) return
    const chat = { id: currentId || crypto.randomUUID(), messages: currentMessages, files }
    setLocalActiveId(chat.id)
    setHistory((old) => [chat, ...old.filter((item) => item.id !== chat.id)])
  }

  // ---- Luồng đã đăng nhập: lịch sử nằm trên server ----
  function newChat() {
    if (!loggedIn) {
      saveLocalChat()
      setLocalActiveId(null)
      setInput('')
      setFiles([])
      setAiError('')
      inputRef.current?.focus()
      return
    }
    setActiveId(null)
    setMessages([])
    setInput('')
    setFiles([])
    setAiError('')
    setSaveWarning('')
    inputRef.current?.focus()
  }

  async function openServerChat(session) {
    if (session.id === activeId || messagesLoading) return
    setActiveId(session.id)
    setMessages([])
    setAiError('')
    setSaveWarning('')
    setInput('')
    setMessagesLoading(true)
    try {
      const rows = await fetchAiMessages(session.id)
      setMessages(rows.map(aiMessageFromServer))
    } catch (failure) {
      setAiError(failure.friendlyMessage || 'Không tải được tin nhắn.')
    } finally {
      setMessagesLoading(false)
    }
  }

  function openLocalChat(chat) {
    if (chat.id === localActiveId) return
    saveLocalChat()
    setLocalActiveId(chat.id)
    setMessages(chat.messages)
    setFiles(chat.files)
    setInput('')
    setAiError('')
  }

  async function handleDelete(sessionId) {
    if (loggedIn) {
      if (deleting[sessionId]) return
      setDeleting((previous) => ({ ...previous, [sessionId]: true }))
      try {
        await deleteAiSession(sessionId)
        setSessions((old) => old.filter((item) => item.id !== sessionId))
        if (activeId === sessionId) {
          setActiveId(null)
          setMessages([])
        }
      } catch (failure) {
        setSessionsError(failure.friendlyMessage || 'Không xóa được cuộc trò chuyện.')
      } finally {
        setDeleting((previous) => {
          const next = { ...previous }
          delete next[sessionId]
          return next
        })
      }
      return
    }
    setHistory((old) => old.filter((item) => item.id !== sessionId))
    if (localActiveId === sessionId) setLocalActiveId(null)
  }

  async function send(event) {
    event.preventDefault()
    const question = input.trim()
    if (!question || sending) return
    if (!getSession()) {
      setAiError('Hãy đăng nhập để chat với AI.')
      return
    }
    setAiError('')
    setSaveWarning('')
    const userMessage = { id: crypto.randomUUID(), role: 'user', text: question }
    const nextMessages = [...safeMessages, userMessage]
    setMessages(nextMessages)
    setInput('')
    inputRef.current?.focus()
    setSending(true)
    // Tên session = tin nhắn đầu tiên user gửi (backend rút gọn còn ≤80 ký tự).
    const online = !!getSession()
    let sessionId = online ? activeId : null
    try {
      if (online && !sessionId) {
        try {
          const created = await createAiSession(question)
          sessionId = created.id
          setActiveId(sessionId)
          setSessions((old) => [created, ...old.filter((item) => item.id !== created.id)])
        } catch (failure) {
          setSaveWarning(failure.friendlyMessage || 'Không tạo được phiên chat trên server, cuộc trò chuyện chỉ lưu tạm trên màn hình.')
        }
      }
      if (online && sessionId) {
        try {
          await createAiMessage(sessionId, { role: 'user', content: question })
        } catch (failure) {
          setSaveWarning(failure.friendlyMessage || 'Không lưu được tin nhắn lên server.')
        }
      }
      const reply = await sendAiChat(aiMessagesToPayload(nextMessages))
      const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: reply }
      const withReply = [...nextMessages, assistantMessage]
      setMessages(withReply)
      if (!online) saveLocalChat(withReply)
      if (online && sessionId) {
        try {
          await createAiMessage(sessionId, { role: 'assistant', content: reply })
        } catch (failure) {
          setSaveWarning(failure.friendlyMessage || 'AI đã trả lời nhưng chưa lưu được lên server.')
        }
        // Session vừa được chạm updated_at -> tải lại để sắp xếp "mới nhất trước".
        try {
          setSessions(await fetchAiSessions())
        } catch { /* giữ danh sách cũ, chat hiện tại vẫn đầy đủ */ }
      }
    } catch (failure) {
      setAiError(failure?.friendlyMessage || 'Không nhận được câu trả lời từ AI. Vui lòng thử lại.')
    } finally {
      setSending(false)
    }
  }

  const [uploadError, setUploadError] = useState('')
  async function addFiles(selected) {
    setUploadError('')
    try {
      const incoming = Array.from(selected)
      if (incoming.reduce((sum,file) => sum + file.size, 0) > 2 * 1024 * 1024) throw new Error('Mỗi lần tải tối đa 2 MB. Hãy chọn tệp nhỏ hơn.')
      const added = await Promise.all(incoming.map(file => new Promise((resolve,reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({id:crypto.randomUUID(),file:{name:file.name,type:file.type,size:file.size,data:reader.result}})
        reader.onerror = () => reject(new Error('Không đọc được tệp.'))
        reader.readAsDataURL(file)
      })))
      setFiles(old => [...old,...added])
    } catch (error) { setUploadError(error.message) }
  }

  const shownHistory = loggedIn ? sessions : history
  const shownActiveId = loggedIn ? activeId : localActiveId

  return (
    <>
      {(uploadError || inputError || historyError || localActiveIdError || filesError) && <p role="alert">{uploadError || inputError || historyError || localActiveIdError || filesError}</p>}
      <section className="ai-banner"><div className="ai-orb">✦</div><div><h1>Trợ lý học tập</h1><p>Ghi câu hỏi, nêu cách đã làm, tìm phần cần hiểu thêm.</p></div><span>{sending ? 'AI đang trả lời…' : 'Đã kết nối AI'}</span><span className="ai-tone-badge" title="Chất giọng AI — đổi trong Cài đặt cá nhân">{(AI_TONES[aiTone] ?? AI_TONES.cute)[1]} {(AI_TONES[aiTone] ?? AI_TONES.cute)[0]}</span></section>
      <div className="ai-layout ai-layout-simple">
        <aside className="ai-left">
          <button className="new-chat" onClick={newChat}>＋ <span>Cuộc trò chuyện mới</span></button>
          <SectionCard><CardHeader icon="◴" title="Lịch sử trò chuyện" />{sessionsError && loggedIn && <p role="alert">{sessionsError}</p>}{sessionsLoading ? <div className="chat-empty"><span>□</span><b>Đang tải lịch sử…</b></div> : shownHistory.length ? <div className="ai-item-list">{shownHistory.map((chat) => <div className="ai-item" key={chat.id}><button className="ai-history-title" aria-pressed={shownActiveId === chat.id} onClick={() => (loggedIn ? openServerChat(chat) : openLocalChat(chat))}>{chat.title || chat.messages?.[0]?.text || chat.messages?.[0]?.content || 'Cuộc trò chuyện mới'}</button><button aria-label="Xóa cuộc trò chuyện" disabled={!!deleting[chat.id]} onClick={() => handleDelete(chat.id)}>×</button></div>)}</div> : <div className="chat-empty"><span>□</span><b>Chưa có cuộc trò chuyện nào</b><p>{loggedIn ? 'Đặt câu hỏi đầu tiên, tên cuộc trò chuyện sẽ lấy từ tin nhắn đó.' : 'Hãy đăng nhập để chat và lưu lịch sử trên server.'}</p></div>}</SectionCard>
          <SectionCard><CardHeader icon="▧" title="Tài liệu & Đề cương" /><input ref={fileRef} hidden type="file" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} /><button className="upload-box" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}><span>⇧</span><b>Tải lên đề thi hoặc sách</b><small>Kéo thả hoặc chạm để chọn tệp</small></button><div className="ai-item-list">{files.map(({ id, file }) => <div className="ai-item" key={id}><a href={file.data} download={file.name}>{file.name}</a><button aria-label={'Xóa ' + file.name} onClick={() => setFiles((old) => old.filter((item) => item.id !== id))}>×</button></div>)}</div></SectionCard>
        </aside>
        <SectionCard className="ai-chat">
          {messagesLoading ? <div className="ai-greeting"><div className="ai-avatar">✦</div><p>Đang tải tin nhắn…</p></div> : safeMessages.length ? <div className="ai-messages" ref={messagesRef} role="log" aria-label="Tin nhắn trò chuyện">{safeMessages.map((message) => <div className={message.role === 'assistant' ? 'ai-assistant-message' : 'ai-user-message'} key={message.id}><small>{message.role === 'assistant' ? 'AI' : 'Bạn'}</small><p>{renderWithLinks(message.text)}</p></div>)}{sending && <div className="ai-assistant-message ai-typing"><small>AI</small><p>Đang suy nghĩ…</p></div>}</div> : <div className="ai-greeting"><div className="ai-avatar">✦</div><p>{greeting}</p><div className="prompt-grid">{prompts.map(([icon, label, prompt]) => <button key={label} onClick={() => { setInput(prompt); inputRef.current?.focus() }}><i>{icon}</i><b>{label}</b><span>›</span></button>)}</div></div>}
          {aiError && <p className="ai-error" role="alert">{aiError}</p>}
          {saveWarning && <p className="ai-error" role="status">{saveWarning}</p>}
          <form className="chat-composer" onSubmit={send}><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Câu hỏi học tập" placeholder="Nêu môn, lớp và phần bạn chưa hiểu…" disabled={sending || messagesLoading} /><button disabled={!input.trim() || sending} aria-label="Gửi câu hỏi">{sending ? '…' : '↑'}</button></form>
          <p className="ai-service-note" role="status">{loggedIn ? 'Đã đăng nhập: lịch sử chat được lưu trên server, tên lấy từ tin nhắn đầu tiên.' : 'Bạn cần đăng nhập để chat với AI. Câu hỏi và tài liệu chỉ được lưu trên thiết bị này.'}</p>
        </SectionCard>

      </div>

    </>
  )
}
