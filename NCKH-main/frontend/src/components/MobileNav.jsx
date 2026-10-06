import { useEffect, useState } from 'react'
import { navigationItems, utilityItems } from '../data/navigation'
import Icon from './Icon'

// 4 tab chính dùng nhiều nhất + 1 tab "Thêm" mở bottom-sheet.
// Giữ nguyên label/path desktop để không lệch IA, chỉ đổi cách trình bày trên mobile.
const PRIMARY_PATHS = ['dashboard', 'schedule', 'weekly-tasks', 'pomodoro']

function findItem(path) {
  return [...navigationItems, ...utilityItems].find((item) => item.path === path)
}

export default function MobileNav({ currentPage, onNavigate }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const primary = PRIMARY_PATHS.map(findItem).filter(Boolean)
  // Các trang còn lại vào sheet "Thêm", giữ thứ tự desktop.
  const secondary = [...navigationItems, ...utilityItems].filter(
    (item) => !PRIMARY_PATHS.includes(item.path),
  )
  const moreActive = secondary.some((item) => item.path === currentPage)

  // Khóa cuộn nền khi mở sheet, đóng bằng Escape.
  useEffect(() => {
    if (!moreOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const go = (path) => {
    setMoreOpen(false)
    onNavigate(path)
  }

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Điều hướng chính trên điện thoại">
        {primary.map((item) => {
          const active = currentPage === item.path
          return (
            <button
              key={item.path}
              type="button"
              className={'mobile-tab' + (active ? ' active' : '')}
              aria-current={active ? 'page' : undefined}
              onClick={() => go(item.path)}
            >
              <span className="mobile-tab-icon"><Icon name={item.path} size={22} /></span>
              <span className="mobile-tab-label">{shortLabel(item)}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={'mobile-tab' + (moreActive ? ' active' : '')}
          aria-current={moreActive ? 'page' : undefined}
          aria-expanded={moreOpen}
          aria-controls="mobile-more-sheet"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span className="mobile-tab-icon"><Icon name="more" size={22} /></span>
          <span className="mobile-tab-label">Thêm</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
      )}
      <section
        id="mobile-more-sheet"
        className={'mobile-more-sheet' + (moreOpen ? ' open' : '')}
        role="dialog"
        aria-modal="true"
        aria-label="Thêm mục"
        aria-hidden={moreOpen ? undefined : true}
      >
        <div className="mobile-more-handle" aria-hidden="true" />
        <div className="mobile-more-head">
          <b>Khám phá Nhịp Học</b>
          <button type="button" className="mobile-more-close" onClick={() => setMoreOpen(false)} aria-label="Đóng menu thêm">
            ×
          </button>
        </div>
        <div className="mobile-more-list">
          {secondary.map((item) => {
            const active = currentPage === item.path
            return (
              <button
                key={item.path}
                type="button"
                className={'mobile-more-item' + (active ? ' active' : '')}
                aria-current={active ? 'page' : undefined}
                onClick={() => go(item.path)}
                tabIndex={moreOpen ? 0 : -1}
              >
                <span className="mobile-more-icon"><Icon name={item.path} size={20} /></span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}

// Nhãn ngắn cho tab đáy 360px không bị tràn (giữ nghĩa gốc).
function shortLabel(item) {
  if (item.path === 'dashboard') return 'Góc học tập'
  if (item.path === 'schedule') return 'Lịch học'
  if (item.path === 'weekly-tasks') return 'Việc tuần'
  if (item.path === 'pomodoro') return 'Tập trung'
  return item.label
}
