import { useEffect, useRef, useState } from 'react'
import { CardHeader, SectionCard } from '../components/PageComponents'

const durations = [25 * 60, 5 * 60, 15 * 60]
const modeLabels = ['Tập trung 25’', 'Nghỉ 5’', 'Nghỉ 15’']
const today = () => new Date().toLocaleDateString('en-CA')

export default function PomodoroPage({ onNavigate }) {
  const [mode, setMode] = useState(0)
  const [remaining, setRemaining] = useState(durations[0])
  const [running, setRunning] = useState(false)
  const [stats, setStats] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nhip-hoc-focus'))
      if (saved?.date === today() && Number.isInteger(saved.sessions) && saved.sessions >= 0) return saved
    } catch { /* Storage may be unavailable. */ }
    return { date: today(), sessions: 0 }
  })
  const [sound, setSound] = useState(null)
  const [soundError, setSoundError] = useState('')
  const deadline = useRef(null)
  const audio = useRef(null)

  useEffect(() => {
    try { localStorage.setItem('nhip-hoc-focus', JSON.stringify(stats)) } catch { /* Keep in-memory statistics. */ }
  }, [stats])

  useEffect(() => {
    if (!running) return
    const tick = () => {
      if (deadline.current === null) return
      const seconds = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
      setRemaining(seconds)
      if (seconds > 0) return
      deadline.current = null
      setRunning(false)
      if (mode === 0) {
        setStats((old) => ({ date: today(), sessions: (old.date === today() ? old.sessions : 0) + 1 }))
        setMode(1)
        setRemaining(durations[1])
        deadline.current = Date.now() + durations[1] * 1000
        setRunning(true)
      }
    }
    const interval = setInterval(tick, 200)
    return () => clearInterval(interval)
  }, [running, mode])

  useEffect(() => () => { audio.current?.close() }, [])

  function reset(nextMode = mode) {
    deadline.current = null
    setRunning(false)
    setMode(nextMode)
    setRemaining(durations[nextMode])
  }

  function toggleTimer() {
    if (running) {
      setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)))
      deadline.current = null
      setRunning(false)
    } else {
      const seconds = remaining || durations[mode]
      setRemaining(seconds)
      deadline.current = Date.now() + seconds * 1000
      setRunning(true)
    }
  }

  async function toggleSound(nextSound) {
    const previous = audio.current
    audio.current = null
    previous?.close()
    setSoundError('')
    if (sound === nextSound) { setSound(null); return }
    let context
    try {
      context = new AudioContext()
      audio.current = context
      setSound(nextSound)
      await context.resume()
      if (audio.current !== context) return
      const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate)
      const data = buffer.getChannelData(0)
      const random = new Uint32Array(8192)
      let smooth = 0
      for (let i = 0; i < data.length; i++) {
        if (i % random.length === 0) crypto.getRandomValues(random)
        const noise = random[i % random.length] / 0xffffffff * 2 - 1
        smooth = (smooth + noise * 0.02) / 1.02
        data[i] = nextSound === 'rain' ? noise : smooth * 5
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = nextSound === 'rain' ? 4500 : 900
      const gain = context.createGain()
      gain.gain.value = nextSound === 'rain' ? 0.12 : 0.35
      source.connect(filter).connect(gain).connect(context.destination)
      if (nextSound === 'waves') {
        const wave = context.createOscillator()
        const depth = context.createGain()
        wave.frequency.value = 0.12
        depth.gain.value = 0.25
        wave.connect(depth).connect(gain.gain)
        wave.start()
      }
      source.start()
    } catch {
      context?.close()
      if (audio.current === context) {
        audio.current = null
        setSound(null)
        setSoundError('Không thể phát âm thanh trên trình duyệt này.')
      }
    }
  }

  const sessions = stats.date === today() ? stats.sessions : 0
  const minutes = sessions * 25
  const cycle = sessions ? (sessions - 1) % 4 + 1 : 0
  const time = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`

  return (
    <>
      <PageHeading />
      <div className="focus-layout">
        <SectionCard className="focus-card">
          <CardHeader icon="◷" title="Phòng tập trung" tone="blue" />
          <div className="segmented-control">{modeLabels.map((label, index) => <button key={label} className={mode === index ? 'selected' : ''} aria-pressed={mode === index} onClick={() => reset(index)}>{label}</button>)}</div>
          <div className="focus-ring" style={{ background: `conic-gradient(var(--blue) 0 ${remaining / durations[mode] * 100}%, var(--line) 0 100%)` }}><div><strong role="timer" aria-label="Thời gian còn lại">{time}</strong><span>{running ? (mode === 0 ? 'Đang tập trung' : 'Đang nghỉ ngơi') : remaining === 0 ? 'Đã hoàn thành' : remaining === durations[mode] ? 'Sẵn sàng bắt đầu' : 'Đã tạm dừng'}</span></div></div>
          <div className="cycle-row"><span>Chu kỳ phiên hôm nay</span><b>{cycle} / 4</b></div><div className="cycle-dots">{[0, 1, 2, 3].map((index) => <i key={index} className={index < cycle ? 'completed' : ''} />)}</div>
          <div className="focus-actions"><button className="primary-button" onClick={toggleTimer}>{running ? 'Ⅱ Tạm dừng' : '▶ Bắt đầu'}</button><button className="icon-button" onClick={() => reset()} aria-label="Đặt lại thời gian">↻</button></div>
        </SectionCard>
        <aside className="focus-side">
          <SectionCard><CardHeader icon="♧" title="Bạn bè" /><div className="online-row"><span>0 trực tuyến</span><button className="ghost-button" onClick={() => onNavigate('friends')}>♧ Mời bạn</button></div></SectionCard>
          <SectionCard><CardHeader icon="▤" title="Thống kê" tone="mint" /><div className="focus-stats"><div><b>⌛</b><strong>{Math.floor(minutes / 60)} giờ {minutes % 60} phút</strong></div><div><b>♧</b><strong>{sessions} lần</strong></div></div></SectionCard>
        </aside>
      </div>
      <SectionCard className="sound-card"><CardHeader icon="♧" title="Âm thanh" /><div className="sound-options">{[['rain', '🌧️ Mưa'], ['waves', '≋ Sóng']].map(([value, label]) => <button key={value} aria-pressed={sound === value} onClick={() => toggleSound(value)}>{label}{sound === value ? ' · Đang phát' : ''}</button>)}</div>{soundError && <p role="alert">{soundError}</p>}</SectionCard>
    </>
  )
}

function PageHeading() {
  return <div className="simple-heading"><div><p className="eyebrow">⏱️ NHỊP HỌC TẬP TRUNG</p><h1>Phòng tập trung</h1><p className="page-subtitle">Học 25 phút, nghỉ 5 phút. Tập trung vào một việc mỗi lần.</p></div><div className="focus-tip">💡 Mẹo: Để điện thoại xa tầm tay</div></div>
}
