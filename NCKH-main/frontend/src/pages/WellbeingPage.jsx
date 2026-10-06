import { useEffect, useState } from 'react'
import AiMarkdown from '../components/AiMarkdown'
import { CardHeader, PageIntro, ProgressBar, SectionCard } from '../components/PageComponents'
import { fetchStress, fetchWellbeingAdvice, getSession, onSessionChange } from '../backendApi'

const TONE = { nhe: 'mint', trung_binh: 'gold', nang: 'violet', nguy_co: 'blue' }

const PART_META = [
  { key: 'deadline', inputKey: 'deadline_count', icon: '📌', title: 'Deadline chưa xong', unit: 'cái' },
  { key: 'weekly', inputKey: 'weekly_pending', icon: '📝', title: 'Weekly còn tồn', unit: 'việc' },
  { key: 'night', inputKey: 'night_sessions', icon: '🌙', title: 'Buổi học quá 22h', unit: 'buổi/tuần' },
  { key: 'today', inputKey: 'today_pending', icon: '✅', title: 'Việc hôm nay chưa xong', unit: 'việc' },
]

function ScoreCard({ result, onAnalyze, aiLoading }) {
  if (!result) return null
  const tone = TONE[result.level] || 'blue'
  return (
    <SectionCard>
      <CardHeader icon="💚" title={'Nhịp tuần này: ' + (result.label || '')} tone={tone} />
      <p className="page-subtitle">Điểm tải {result.score}/100 — càng thấp càng thảnh thơi.</p>
      <ProgressBar value={result.score} tone={tone} />
      <h3>4 tiêu chí của điểm số</h3>
      <ul>
        {PART_META.map(meta => {
          const points = result.parts?.[meta.key] ?? 0
          const max = result.max?.[meta.key] ?? 0
          const count = result.inputs?.[meta.inputKey] ?? 0
          return (
            <li key={meta.key}>
              {meta.icon} <b>{meta.title}</b>: {points}/{max} điểm <small>({count} {meta.unit})</small>
              <ProgressBar value={max > 0 ? (points / max) * 100 : 0} tone={tone} />
            </li>
          )
        })}
      </ul>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="primary-button" onClick={onAnalyze} disabled={aiLoading}>
          {aiLoading ? 'AI đang phân tích…' : 'Nhờ AI gợi ý cách cải thiện'}
        </button>
      </div>
    </SectionCard>
  )
}

export default function WellbeingPage({ onNavigate }) {
  const [loggedIn, setLoggedIn] = useState(() => !!getSession())
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [advice, setAdvice] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => onSessionChange(session => setLoggedIn(!!session)), [])

  async function loadPersonal() {
    setLoading(true)
    setError('')
    try {
      setResult(await fetchStress())
      setAdvice('')
      setAiError('')
    } catch (failure) {
      setError(failure?.friendlyMessage || 'Không tính được nhịp học. Thử lại nhé.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (loggedIn) loadPersonal() }, [loggedIn])

  async function loadAdvice() {
    setAiLoading(true)
    setAiError('')
    try {
      const data = await fetchWellbeingAdvice()
      setAdvice(data?.advice || '')
    } catch (failure) {
      setAiError(failure?.friendlyMessage || 'AI chưa phân tích được. Thử lại nhé.')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div>
      <PageIntro
        eyebrow="Nhịp học tập"
        title="Tuần này của bạn thế nào?"
        subtitle="Mình nhìn vào deadline, việc tồn, buổi học muộn và việc hôm nay để đoán tuần này dày hay thưa."
      />
      {loggedIn ? (
        <>
          <SectionCard>
            <CardHeader icon="📊" title="Nhịp của riêng bạn" tone="mint" action={loading ? undefined : 'Tính lại'} onAction={loadPersonal} />
            {error && <p className="page-subtitle">{error}</p>}
            {loading && !result && <p className="page-subtitle">Đang nhìn lại 14 ngày gần nhất…</p>}
          </SectionCard>
          <ScoreCard result={result} onAnalyze={loadAdvice} aiLoading={aiLoading} />
          {(aiLoading || aiError || advice) && (
            <SectionCard>
              <CardHeader icon="✨" title="AI gợi ý cho bạn" tone="violet" />
              {aiLoading && !advice && <p className="page-subtitle">AI đang đọc dữ liệu học tập của bạn…</p>}
              {aiError && <p className="page-subtitle">{aiError}</p>}
              {advice && <AiMarkdown text={advice} />}
            </SectionCard>
          )}
        </>
      ) : (
        <SectionCard>
          <CardHeader icon="👋" title="Đăng nhập để xem nhịp của bạn" tone="blue" />
          <p className="page-subtitle">Đăng nhập xong mình sẽ tự tính từ dữ liệu học tập 14 ngày gần nhất của bạn.</p>
          <button type="button" className="primary-button" onClick={() => onNavigate?.('login')}>Đăng nhập</button>
        </SectionCard>
      )}
    </div>
  )
}
