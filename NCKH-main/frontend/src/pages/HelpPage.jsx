import { useCallback, useEffect, useState } from 'react'
import useStoredState from '../data/useStoredState'
import { createFeedback, deleteFeedback, fetchFeedbacks, getSession } from '../backendApi'
import { CardHeader, PageIntro, SectionCard } from '../components/PageComponents'

const faqs = [
  { question: 'Nên bắt đầu học ở đâu?', answer: 'Mở Lộ trình, chọn một mục tiêu cụ thể rồi dành thời gian cho từng bước nhỏ. Bạn có thể bắt đầu bằng một môn cần cải thiện.', route: 'roadmap', label: 'Xem lộ trình' },
  { question: 'Pomodoro là gì?', answer: 'Chia thời gian thành những phiên tập trung 25 phút, xen kẽ 5 phút nghỉ. Sau 4 phiên, hãy nghỉ dài hơn để nạp lại năng lượng.', route: 'pomodoro', label: 'Xem phòng tập trung' },
  { question: 'Theo dõi bài tập và lịch học ở đâu?', answer: 'Lịch học tập hợp thời khóa biểu và bài tập sắp đến hạn để bạn dễ sắp xếp thời gian.', route: 'schedule', label: 'Xem lịch học' },
  { question: 'Xem tiến bộ của mình ở đâu?', answer: 'Tiến bộ của bạn là nơi nhìn lại thời gian học, nhịp học theo môn và các cột mốc duy trì thói quen.', route: 'stats', label: 'Xem thống kê' },
]

export default function HelpPage() {
  // Nháp trên thiết bị (giữ lại khi đang gõ / mất mạng).
  const [draft, saveDraft, draftError] = useStoredState('nhip-hoc-feedback-draft', '')
  const [message, setMessage] = useState(draft)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sent, setSent] = useState(false)

  // Góp ý đã gửi lên server (chỉ khi đã đăng nhập).
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(!!getSession())
  const [loadError, setLoadError] = useState('')
  const [deleting, setDeleting] = useState({})

  const loggedIn = !!getSession()

  const reload = useCallback(async () => {
    if (!getSession()) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      setItems(await fetchFeedbacks())
    } catch (failure) {
      setLoadError(failure.friendlyMessage || 'Không tải được góp ý.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleSubmit(event) {
    event.preventDefault()
    const text = message.trim()
    if (!text || sending) return
    // Chưa đăng nhập: giữ hành vi cũ (lưu nháp trên thiết bị).
    if (!getSession()) {
      if (saveDraft(text)) setSent(true)
      return
    }
    setSending(true)
    setSendError('')
    try {
      await createFeedback(text)
      setMessage('')
      saveDraft('')
      setSent(true)
      await reload()
    } catch (failure) {
      setSendError(failure.friendlyMessage || 'Không gửi được góp ý. Vui lòng thử lại.')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(id) {
    if (deleting[id]) return
    setDeleting(previous => ({ ...previous, [id]: true }))
    try {
      await deleteFeedback(id)
      setItems(previous => previous.filter(item => item.id !== id))
    } catch (failure) {
      setLoadError(failure.friendlyMessage || 'Không xóa được góp ý.')
    } finally {
      setDeleting(previous => {
        const next = { ...previous }
        delete next[id]
        return next
      })
    }
  }

  return (
    <>
      <PageIntro eyebrow="LÀM QUEN VỚI NHỊP HỌC" title="Trợ giúp" subtitle="Một vài gợi ý để bạn làm quen với góc học tập mới." />
      <div className="help-grid">
        <SectionCard>
          <CardHeader icon="?" title="Câu hỏi thường gặp" />
          {faqs.map((faq) => <details className="faq-item" key={faq.route}><summary>{faq.question}<span aria-hidden="true">＋</span></summary><p>{faq.answer}</p><a href={'#' + faq.route}>{faq.label} →</a></details>)}
        </SectionCard>
        <SectionCard className="feedback-card">
          <CardHeader icon="✦" title="Ghi lại góp ý" tone="violet" />
          <p>Điều gì sẽ giúp trải nghiệm học tập của bạn tốt hơn?</p>
          <form onSubmit={handleSubmit}><textarea required maxLength={2000} aria-label="Nội dung góp ý" placeholder="Điều bạn muốn cải thiện…" value={message} onChange={event => { setMessage(event.target.value); setSent(false); setSendError('') }} /><button className="primary-button" disabled={!message.trim() || sending}>{sending ? 'Đang gửi…' : 'Gửi góp ý'}</button></form>
          <p role="status">{sent ? (loggedIn ? 'Đã gửi góp ý. Cảm ơn bạn!' : 'Đã lưu góp ý trên thiết bị này.') : (loggedIn ? 'Góp ý sẽ được gửi đến nhà phát triển.' : 'Góp ý được lưu riêng trên thiết bị, chưa gửi đến nhà phát triển.')}</p>
          {(sendError || draftError) && <p role="alert">{sendError || draftError}</p>}
          {loggedIn && (
            <div className="feedback-list">
              <b>Góp ý đã gửi</b>
              {loading ? <p>Đang tải…</p> : loadError ? <p role="alert">{loadError}</p> : items.length === 0 ? <p>Chưa có góp ý nào.</p> : (
                <ul>
                  {items.map(item => (
                    <li key={item.id}>
                      <span>{item.message}</span>
                      <button className="ghost-button" disabled={!!deleting[item.id]} onClick={() => handleDelete(item.id)}>Xóa</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SectionCard>
      </div>
      <SectionCard className="contact-card"><div><span aria-hidden="true">📖</span><b>Cùng khám phá Nhịp Học</b><p>Tìm một cách học phù hợp với chính mình.</p></div><a className="ghost-button" href="#dashboard">Về góc học tập →</a></SectionCard>
    </>
  )
}
