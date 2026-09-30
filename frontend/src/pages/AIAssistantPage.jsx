import { useEffect, useRef, useState } from 'react'
import { CardHeader, ProgressBar, SectionCard } from '../components/PageComponents'

const styles = [['♥', 'Gia sư', 'blue'], ['◷', 'Luyện tập', 'mint'], ['♜', 'Chiến lược', 'gold']]
const prompts = [['ϟ', 'Giải bài'], ['⌁', 'Lập lịch'], ['▤', 'Tóm tắt'], ['✧', 'Ôn tập']]
const greetings = ['Mình có thể giúp gì cho bạn?', 'Bạn muốn luyện tập nội dung nào?', 'Bạn muốn xây dựng chiến lược học tập nào?']

export default function AIAssistantPage({ onNavigate }) {
  const [mode, setMode] = useState(0)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [history, setHistory] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState([])
  const [note, setNote] = useState('')
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const dialogRef = useRef(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [messages])

  function saveChat() {
    if (!messages.length) return
    const chat = { id: activeId || crypto.randomUUID(), messages, mode, files }
    setHistory((old) => [chat, ...old.filter((item) => item.id !== chat.id)])
  }

  function newChat() {
    saveChat()
    setActiveId(null)
    setMessages([])
    setInput('')
    setMode(0)
    setFiles([])
    inputRef.current?.focus()
  }

  function openChat(chat) {
    if (chat.id === activeId) return
    saveChat()
    setActiveId(chat.id)
    setMessages(chat.messages)
    setMode(chat.mode)
    setFiles(chat.files)
    setInput('')
  }

  function send(event) {
    event.preventDefault()
    if (!input.trim()) return
    setMessages((old) => [...old, { id: crypto.randomUUID(), text: input.trim() }])
    setInput('')
    inputRef.current?.focus()
  }

  function addFiles(selected) {
    setFiles((old) => [...old, ...Array.from(selected).map((file) => ({ id: crypto.randomUUID(), file }))])
  }

  return (
    <>
      <section className="ai-banner"><div className="ai-orb">✦</div><div><p>Trợ lý AI</p><b>Đồng hành học tập cá nhân</b></div><span>● Sẵn sàng hỗ trợ</span></section>
      <div className="ai-layout">
        <aside className="ai-left">
          <button className="new-chat" onClick={newChat}>⊕ <span>+ Cuộc trò<br />chuyện mới</span></button>
          <SectionCard><CardHeader icon="☷" title="Phong cách đồng hành" /><div className="style-list">{styles.map(([icon, label, tone], index) => <button aria-pressed={index === mode} className={index === mode ? 'selected ' + tone : tone} onClick={() => setMode(index)} key={label}><i>{icon}</i><b>{label}</b><span>{index === mode ? '●' : ''}</span></button>)}</div></SectionCard>
          <SectionCard><CardHeader icon="◴" title="Lịch sử trò chuyện" />{history.length ? <div className="ai-item-list">{history.map((chat) => <div className="ai-item" key={chat.id}><button className="ai-history-title" aria-pressed={activeId === chat.id} onClick={() => openChat(chat)}>{chat.messages[0].text}</button><button aria-label="Xóa cuộc trò chuyện" onClick={() => { setHistory((old) => old.filter((item) => item.id !== chat.id)); if (activeId === chat.id) setActiveId(null) }}>×</button></div>)}</div> : <div className="chat-empty"><span>□</span><b>Chưa có cuộc trò chuyện nào</b><p>Gửi một câu hỏi đầu tiên để kích hoạt trí tuệ sáng tạo!</p></div>}</SectionCard>
          <SectionCard><CardHeader icon="▧" title="Tài liệu & Đề cương" /><input ref={fileRef} hidden type="file" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} /><button className="upload-box" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}><span>⇧</span><b>Tải lên đề thi hoặc sách</b><small>Kéo thả hoặc chạm để chọn tệp</small></button><div className="ai-item-list">{files.map(({ id, file }) => <div className="ai-item" key={id}><span>{file.name}</span><button aria-label={'Xóa ' + file.name} onClick={() => setFiles((old) => old.filter((item) => item.id !== id))}>×</button></div>)}</div></SectionCard>
        </aside>
        <SectionCard className="ai-chat">
          {messages.length ? <div className="ai-messages" ref={messagesRef} role="log" aria-label="Tin nhắn trò chuyện">{messages.map((message) => <div className="ai-user-message" key={message.id}><small>Bạn</small><p>{message.text}</p></div>)}</div> : <div className="ai-greeting"><div className="ai-avatar">✦</div><p>{greetings[mode]}</p><div className="prompt-grid">{prompts.map(([icon, label]) => <button key={label} onClick={() => { setInput(label + ': '); inputRef.current?.focus() }}><i>{icon}</i><b>{label}</b><span>›</span></button>)}</div></div>}
          <form className="chat-composer" onSubmit={send}><span>⌕</span><span>Σ</span><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Câu hỏi cho trợ lý AI" placeholder="Hỏi bất kỳ điều gì..." /><span>♩</span><button disabled={!input.trim()} aria-label="Gửi câu hỏi">↑</button><small>Gợi ý: Hãy nêu rõ phần bạn chưa hiểu.</small><small>Học từng bước, hiểu thật sâu.</small></form>
        </SectionCard>
        <aside className="ai-right">
          <SectionCard><CardHeader icon="⌁" title="Cấp độ đồng hành" /><div className="level-summary"><b>LV. 1</b><span>Tân thủ <em>0 / 100 EXP</em></span><ProgressBar value={0} /></div></SectionCard>
          <SectionCard><CardHeader icon="✣" title="Thống kê tuần" /><div className="ai-stat-grid"><div><b>✓</b><strong>0</strong><span>Câu hỏi đã giải</span></div><div><b>•</b><strong>0</strong><span>Khái niệm làm chủ</span></div></div></SectionCard>
          <SectionCard><CardHeader icon="☷" title="Sổ tay & Ghi chú thông minh" /><div className="notebook-empty"><span>{notes.length ? notes.length + ' ghi chú' : <>Chưa lưu<br />mục nào</>}</span><button onClick={() => dialogRef.current?.showModal()}>Mở sổ tay</button></div><div className="ai-item-list">{notes.map((item) => <div className="ai-item" key={item.id}><span>{item.text}</span><button aria-label="Xóa ghi chú" onClick={() => setNotes((old) => old.filter((entry) => entry.id !== item.id))}>×</button></div>)}</div></SectionCard>
          <SectionCard><CardHeader icon="⚑" title="Bộ nhớ mục tiêu" /><div className="memory-box"><span>Chưa chọn mục tiêu</span><button onClick={() => onNavigate('roadmap/goal-builder')}>Thiết lập →</button></div></SectionCard>
        </aside>
      </div>
      <dialog className="ai-notebook-dialog" ref={dialogRef} aria-labelledby="ai-notebook-title">
        <form onSubmit={(event) => { event.preventDefault(); if (!note.trim()) return; setNotes((old) => [...old, { id: crypto.randomUUID(), text: note.trim() }]); setNote(''); dialogRef.current.close() }}>
          <h2 id="ai-notebook-title">Sổ tay & Ghi chú</h2>
          <textarea autoFocus aria-label="Nội dung ghi chú" placeholder="Viết ghi chú của bạn..." value={note} onChange={(event) => setNote(event.target.value)} />
          <div><button type="button" onClick={() => dialogRef.current.close()}>Đóng</button><button className="primary-button" disabled={!note.trim()}>Lưu ghi chú</button></div>
        </form>
      </dialog>
    </>
  )
}
