import useStoredState from '../data/useStoredState'
import { useEffect, useRef, useState } from 'react'
import { CardHeader, SectionCard } from '../components/PageComponents'

const prompts = [['ϟ', 'Gợi ý cách giải', 'Mình học lớp …, đang làm bài … Mình đã thử … Hãy gợi ý bước tiếp theo.'], ['⌁', 'Lên kế hoạch ôn', 'Mình cần ôn môn … trước ngày … Mỗi ngày mình có … phút.'], ['▤', 'Hiểu kiến thức', 'Giải thích kiến thức … bằng một ví dụ phù hợp với lớp …'], ['✧', 'Tự kiểm tra', 'Đặt 5 câu hỏi về … để mình tự kiểm tra phần đã học.']]
const greeting = 'Bạn đang vướng ở phần nào?'

export default function AIAssistantPage() {
    const [input, setInput, inputError] = useStoredState('nhip-hoc-chat-input', '')
  const [messages, setMessages, messagesError] = useStoredState('nhip-hoc-chat-messages', [])
  const [history, setHistory, historyError] = useStoredState('nhip-hoc-chat-history', [])
  const [activeId, setActiveId, activeIdError] = useStoredState('nhip-hoc-chat-activeId', null)
  const [files, setFiles, filesError] = useStoredState('nhip-hoc-chat-files', [])
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [messages])

  function saveChat() {
    if (!messages.length) return
    const chat = { id: activeId || crypto.randomUUID(), messages, files }
    setActiveId(chat.id)
    setHistory((old) => [chat, ...old.filter((item) => item.id !== chat.id)])
  }

  function newChat() {
    saveChat()
    setActiveId(null)
    setMessages([])
    setInput('')
    setFiles([])
    inputRef.current?.focus()
  }

  function openChat(chat) {
    if (chat.id === activeId) return
    saveChat()
    setActiveId(chat.id)
    setMessages(chat.messages)
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

  return (
    <>
      {(uploadError || inputError || messagesError || historyError || activeIdError || filesError) && <p role="alert">{uploadError || inputError || messagesError || historyError || activeIdError || filesError}</p>}
      <section className="ai-banner"><div className="ai-orb">✦</div><div><h1>Trợ lý học tập</h1><p>Ghi câu hỏi, nêu cách đã làm, tìm phần cần hiểu thêm.</p></div><span>Chưa kết nối AI</span></section>
      <div className="ai-layout ai-layout-simple">
        <aside className="ai-left">
          <button className="new-chat" onClick={newChat}>＋ <span>Cuộc trò chuyện mới</span></button>
          <SectionCard><CardHeader icon="◴" title="Lịch sử trò chuyện" />{history.length ? <div className="ai-item-list">{history.map((chat) => <div className="ai-item" key={chat.id}><button className="ai-history-title" aria-pressed={activeId === chat.id} onClick={() => openChat(chat)}>{chat.messages[0].text}</button><button aria-label="Xóa cuộc trò chuyện" onClick={() => { setHistory((old) => old.filter((item) => item.id !== chat.id)); if (activeId === chat.id) setActiveId(null) }}>×</button></div>)}</div> : <div className="chat-empty"><span>□</span><b>Chưa có cuộc trò chuyện nào</b><p>Câu hỏi được lưu trên thiết bị này. Chọn cuộc trò chuyện mới để lưu vào lịch sử.</p></div>}</SectionCard>
          <SectionCard><CardHeader icon="▧" title="Tài liệu & Đề cương" /><input ref={fileRef} hidden type="file" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} /><button className="upload-box" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}><span>⇧</span><b>Tải lên đề thi hoặc sách</b><small>Kéo thả hoặc chạm để chọn tệp</small></button><div className="ai-item-list">{files.map(({ id, file }) => <div className="ai-item" key={id}><a href={file.data} download={file.name}>{file.name}</a><button aria-label={'Xóa ' + file.name} onClick={() => setFiles((old) => old.filter((item) => item.id !== id))}>×</button></div>)}</div></SectionCard>
        </aside>
        <SectionCard className="ai-chat">
          {messages.length ? <div className="ai-messages" ref={messagesRef} role="log" aria-label="Tin nhắn trò chuyện">{messages.map((message) => <div className="ai-user-message" key={message.id}><small>Bạn</small><p>{message.text}</p></div>)}</div> : <div className="ai-greeting"><div className="ai-avatar">✦</div><p>{greeting}</p><div className="prompt-grid">{prompts.map(([icon, label, prompt]) => <button key={label} onClick={() => { setInput(prompt); inputRef.current?.focus() }}><i>{icon}</i><b>{label}</b><span>›</span></button>)}</div></div>}
          <form className="chat-composer" onSubmit={send}><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Câu hỏi học tập" placeholder="Nêu môn, lớp và phần bạn chưa hiểu…" /><button disabled={!input.trim()} aria-label="Lưu câu hỏi">↑</button></form>
          <p className="ai-service-note" role="status">Câu hỏi và tài liệu chỉ được lưu trên thiết bị này. Trợ lý chưa thể trả lời khi chưa kết nối dịch vụ AI.</p>
        </SectionCard>

      </div>

    </>
  )
}


