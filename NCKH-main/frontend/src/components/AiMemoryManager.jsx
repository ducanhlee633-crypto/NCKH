import { useEffect, useState } from 'react'
import {
  createAiMemory,
  deleteAiMemory,
  fetchAiMemories,
  getSession,
  updateAiMemory,
} from '../backendApi'
import { MEMORY_CONTENT_MAX, MEMORY_MAX_PER_USER, MEMORY_TAGS, normalizeMemoryTag } from '../data/memory'
import { CardHeader, SectionCard } from './PageComponents'

const FILTERS = { all: 'Tất cả', ...Object.fromEntries(Object.entries(MEMORY_TAGS).map(([k, [label]]) => [k, label])) }

/** Quản lí trí nhớ dài hạn cho AI (bảng ai_memories).
 *  User tự thêm/sửa/xóa từng mẩu + gắn tag. Backend POST /ai/chat tự ĐỌC TRƯỚC
 *  bảng này mỗi lượt (ưu tiên lọc theo tag bằng index), nên lưu càng chuẩn thì AI nhớ càng đúng.
 */
export default function AiMemoryManager() {
  const loggedIn = !!getSession()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(loggedIn)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('info')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  async function reload(nextFilter = filter, nextQuery = query) {
    if (!getSession()) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const rows = await fetchAiMemories({
        ...(nextFilter !== 'all' ? { tag: nextFilter } : {}),
        ...(nextQuery.trim() ? { q: nextQuery.trim() } : {}),
        limit: 50,
      })
      setItems(Array.isArray(rows) ? rows : [])
    } catch (failure) {
      setError(failure.friendlyMessage || 'Không tải được trí nhớ AI.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startEdit(row) {
    setEditingId(row.id)
    setTag(normalizeMemoryTag(row.tag))
    setContent(String(row.content || ''))
    setError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setTag('info')
    setContent('')
  }

  async function save(event) {
    event?.preventDefault()
    const clean = String(content || '').trim()
    if (!clean) {
      setError('Nhập nội dung trí nhớ trước khi lưu.')
      return
    }
    if (!getSession()) {
      setError('Hãy đăng nhập để lưu trí nhớ AI lên server.')
      return
    }
    if (!editingId && items.length >= MEMORY_MAX_PER_USER) {
      setError(`Bạn đã lưu tối đa ${MEMORY_MAX_PER_USER} mẩu. Hãy xóa bớt trước khi thêm.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        const updated = await updateAiMemory(editingId, { tag, content: clean })
        setItems((old) => old.map((it) => (it.id === editingId ? updated : it)))
      } else {
        const created = await createAiMemory({ tag, content: clean })
        setItems((old) => [created, ...old].slice(0, MEMORY_MAX_PER_USER))
      }
      cancelEdit()
    } catch (failure) {
      setError(failure.friendlyMessage || 'Không lưu được trí nhớ. Thử lại sau.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    if (busyId) return
    setBusyId(id)
    setError('')
    try {
      await deleteAiMemory(id)
      setItems((old) => old.filter((it) => it.id !== id))
      if (editingId === id) cancelEdit()
    } catch (failure) {
      setError(failure.friendlyMessage || 'Không xóa được trí nhớ.')
    } finally {
      setBusyId(null)
    }
  }

  const shown = items

  return (
    <SectionCard>
      <CardHeader icon="🧠" title="Quản lí trí nhớ AI" />
      <p className="card-description">
        Lưu những điều muốn AI nhớ về bạn (tối đa {MEMORY_MAX_PER_USER} mẩu, mỗi mẩu {MEMORY_CONTENT_MAX} ký tự).
        Mỗi lần vào đoạn chat, AI đều đọc trước bảng này — ưu tiên đúng tag nên gắn tag càng chuẩn càng tốt.
      </p>
      {!loggedIn && <p className="card-description">Hãy đăng nhập để lưu trí nhớ lên server.</p>}
      <div className="memory-filters" role="group" aria-label="Lọc theo tag">
        {Object.entries(FILTERS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={filter === key ? 'selected' : ''}
            onClick={() => {
              setFilter(key)
              reload(key, query)
            }}
          >
            {key === 'all' ? '▣' : `${MEMORY_TAGS[key]?.[1] ?? ''} `}{label}
          </button>
        ))}
      </div>
      <div className="memory-search">
        <input
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              reload(filter, event.target.value)
            }
          }}
          placeholder="Tìm trong trí nhớ... (Enter để lọc)"
          aria-label="Tìm trong trí nhớ AI"
        />
        <button type="button" className="ghost-button" onClick={() => reload(filter, query)}>Tìm</button>
      </div>
      {loading ? (
        <p className="card-description">Đang tải trí nhớ…</p>
      ) : shown.length ? (
        <div className="memory-list">
          {shown.map((row) => (
            <div className="memory-item" key={row.id}>
              <span className="memory-tag" title={MEMORY_TAGS[row.tag]?.[2] ?? ''}>
                {MEMORY_TAGS[row.tag]?.[1] ?? '📝'} {MEMORY_TAGS[row.tag]?.[0] ?? row.tag}
              </span>
              <p>{row.content}</p>
              <div>
                <button type="button" className="ghost-button" onClick={() => startEdit(row)}>Sửa</button>
                <button type="button" className="ghost-button" disabled={busyId === row.id} onClick={() => remove(row.id)}>
                  {busyId === row.id ? 'Đang xóa…' : 'Xóa'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="card-description">
          {filter !== 'all' || query.trim() ? 'Không có mẩu nào khớp bộ lọc.' : 'Chưa có trí nhớ nào. Thêm mẩu đầu tiên bên dưới nhé.'}
        </p>
      )}
      <form className="memory-form" onSubmit={save}>
        <b className="setting-label">{editingId ? 'Sửa mẩu trí nhớ' : 'Thêm mẩu mới'} ({items.length}/{MEMORY_MAX_PER_USER})</b>
        <label>Tag (gắn đúng để AI tìm nhanh bằng index)
          <select value={tag} onChange={(event) => setTag(normalizeMemoryTag(event.target.value))}>
            {Object.entries(MEMORY_TAGS).map(([key, [label, emoji, desc]]) => (
              <option key={key} value={key}>{emoji} {label} — {desc}</option>
            ))}
          </select>
        </label>
        <label>Nội dung AI cần nhớ
          <textarea
            value={content}
            maxLength={MEMORY_CONTENT_MAX}
            rows={3}
            onChange={(event) => setContent(event.target.value)}
            placeholder="VD: Mình học lớp 8, thích Toán nhưng yếu Hình học, mục tiêu 8.5 cuối kỳ..."
          />
        </label>
        <small>{String(content).trim().length}/{MEMORY_CONTENT_MAX} ký tự</small>
        <div>
          {editingId && <button type="button" className="ghost-button" onClick={cancelEdit}>Hủy</button>}
          <button type="submit" className="primary-button" disabled={saving || !getSession()}>
            {saving ? 'Đang lưu…' : editingId ? '✓ Lưu sửa' : '＋ Thêm trí nhớ'}
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
    </SectionCard>
  )
}
