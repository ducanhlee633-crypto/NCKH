/** Render Markdown nhẹ cho tin nhắn AI — không cần cài thêm lib.
 *
 * Hỗ trợ đủ những gì AI hay trả về:
 * - Tiêu đề # ## ### ####
 * - In đậm **text**, in nghiêng *text*, `code`, [link](url), URL trần
 * - Gạch đầu dòng -, *, +, danh sách số 1.
 * - Bảng GFM: | A | B | + dòng | --- | --- |
 * - Code block ``` , trích dẫn >, đường kẻ ---
 *
 * Không dùng dangerouslySetInnerHTML nên an toàn XSS —
 * mọi thứ render qua React element.
 */

const bareUrlPattern = /(https?:\/\/[^\s<>()]+)/g
const trailingPunctuation = /[.,;:!?)\]}>]+$/

function stripTrailing(url) {
  const m = String(url).match(trailingPunctuation)
  if (!m) return { url, tail: '' }
  const cut = url.length - m[0].length
  return { url: url.slice(0, cut), tail: url.slice(cut) }
}

/** Parse inline: code, bold, italic, strikethrough, link markdown, url trần. */
export function renderInline(text, keyPrefix = '') {
  const nodes = []
  // Tách [label](url) trước, giữ code/bold/italic xử lý sau trên từng đoạn.
  const mdLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  let match
  let chunkIndex = 0

  const pushFormatted = (segment, scope) => {
    // Tách `code` trước để bên trong code không parse bold/link nữa.
    const codeParts = String(segment).split(/(`[^`]+`)/g)
    codeParts.forEach((codePart, ci) => {
      if (!codePart) return
      if (codePart.startsWith('`') && codePart.endsWith('`') && codePart.length > 2) {
        nodes.push(<code key={`${scope}-code-${ci}`} className="md-code">{codePart.slice(1, -1)}</code>)
        return
      }
      // Tách URL trần.
      const urlParts = codePart.split(bareUrlPattern)
      urlParts.forEach((up, ui) => {
        if (!up) return
        if (ui % 2 === 1) {
          const { url, tail } = stripTrailing(up)
          if (!url) {
            nodes.push(<span key={`${scope}-t-${ci}-${ui}`}>{up}</span>)
            return
          }
          nodes.push(
            <a key={`${scope}-u-${ci}-${ui}`} href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>,
          )
          if (tail) nodes.push(<span key={`${scope}-ut-${ci}-${ui}`}>{tail}</span>)
          return
        }
        // Bold + italic + strikethrough trong đoạn text thường.
        const boldParts = up.split(/(\*\*[^*]+\*\*|__[^_]+__)/g)
        boldParts.forEach((bp, bi) => {
          if (!bp) return
          if ((bp.startsWith('**') && bp.endsWith('**')) || (bp.startsWith('__') && bp.endsWith('__'))) {
            const inner = bp.slice(2, -2)
            if (!inner) return
            nodes.push(
              <strong key={`${scope}-b-${ci}-${ui}-${bi}`}>{renderInlinePlain(inner, `${scope}-bi-${ci}-${ui}-${bi}`)}</strong>,
            )
            return
          }
          const italicParts = bp.split(/(\*[^*\n]+\*|_[^_\n]+_)/g)
          italicParts.forEach((ip, ii) => {
            if (!ip) return
            if ((ip.startsWith('*') && ip.endsWith('*') && ip.length > 2) || (ip.startsWith('_') && ip.endsWith('_') && ip.length > 2)) {
              nodes.push(<em key={`${scope}-i-${ci}-${ui}-${bi}-${ii}`}>{ip.slice(1, -1)}</em>)
              return
            }
            if (ip.startsWith('~~') && ip.endsWith('~~') && ip.length > 4) {
              nodes.push(<s key={`${scope}-s-${ci}-${ui}-${bi}-${ii}`}>{ip.slice(2, -2)}</s>)
              return
            }
            nodes.push(<span key={`${scope}-x-${ci}-${ui}-${bi}-${ii}`}>{ip}</span>)
          })
        })
      })
    })
  }

  const textStr = String(text ?? '')
  mdLinkPattern.lastIndex = 0
  while ((match = mdLinkPattern.exec(textStr)) !== null) {
    const before = textStr.slice(last, match.index)
    if (before) pushFormatted(before, `${keyPrefix}-pre${chunkIndex}`)
    const label = match[1]
    const { url, tail } = stripTrailing(match[2])
    nodes.push(
      <a key={`${keyPrefix}-link${chunkIndex}`} href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
    )
    if (tail) nodes.push(<span key={`${keyPrefix}-linktail${chunkIndex}`}>{tail}</span>)
    last = match.index + match[0].length
    chunkIndex += 1
  }
  const rest = textStr.slice(last)
  if (rest) pushFormatted(rest, `${keyPrefix}-rest`)
  return nodes
}

/** Dùng khi đã ở trong <strong> để tránh đệ quy vô hạn. */
function renderInlinePlain(text, scope) {
  const urlParts = String(text).split(bareUrlPattern)
  if (urlParts.length === 1) {
    const codeSafe = String(text).split(/(`[^`]+`)/g)
    return codeSafe.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return <code key={`${scope}-c${i}`} className="md-code">{part.slice(1, -1)}</code>
      }
      return <span key={`${scope}-p${i}`}>{part}</span>
    })
  }
  return urlParts.map((up, ui) => {
    if (ui % 2 === 1) {
      const { url, tail } = stripTrailing(up)
      return (
        <span key={`${scope}-u${ui}`}>
          <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
          {tail}
        </span>
      )
    }
    return <span key={`${scope}-t${ui}`}>{up}</span>
  })
}

function splitTableRow(line) {
  let trimmed = String(line).trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  // Tách theo | nhưng giữ \| (escape).
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

function isDelimiterRow(line) {
  const cells = splitTableRow(line)
  if (!cells.length) return false
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()))
}

function isTableHeader(line, nextLine) {
  return line.includes('|') && nextLine != null && isDelimiterRow(nextLine)
}

/** Parse block-level markdown thành React elements. */
export function renderMarkdownBlocks(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0

  const pushParagraph = (buffer, key) => {
    const text = buffer.join('\n').trim()
    if (!text) return
    // Xuống dòng đơn trong đoạn -> <br/> cho giống chat.
    const parts = text.split('\n')
    blocks.push(
      <p key={key} className="md-p">
        {parts.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${key}-l${li}`)}
          </span>
        ))}
      </p>,
    )
  }

  let paraBuffer = []
  const flushPara = (key) => {
    if (paraBuffer.length) {
      pushParagraph(paraBuffer, key)
      paraBuffer = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Code block ```lang ... ```
    if (trimmed.startsWith('```')) {
      flushPara(`p-${i}`)
      const lang = trimmed.slice(3).trim()
      const codeLines = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      i += 1 // bỏ dòng ``` đóng
      blocks.push(
        <pre key={`code-${blocks.length}`} className="md-pre">
          {lang && <span className="md-pre-lang">{lang}</span>}
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // Bảng GFM
    if (trimmed.includes('|') && isTableHeader(trimmed, (lines[i + 1] || '').trim())) {
      flushPara(`p-${i}`)
      const headerCells = splitTableRow(trimmed)
      const delimCells = splitTableRow((lines[i + 1] || '').trim())
      const aligns = delimCells.map((d) => {
        const t = d.trim()
        if (t.startsWith(':') && t.endsWith(':')) return 'center'
        if (t.endsWith(':')) return 'right'
        return 'left'
      })
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        // Dừng nếu gặp dòng không phải row bảng (không có | đủ).
        if (!lines[i].includes('|')) break
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push(
        <div key={`table-${blocks.length}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headerCells.map((cell, ci) => (
                  <th key={ci} style={{ textAlign: aligns[ci] || 'left' }}>
                    {renderInline(cell, `th-${blocks.length}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {headerCells.map((_, ci) => (
                    <td key={ci} style={{ textAlign: aligns[ci] || 'left' }}>
                      {renderInline(row[ci] ?? '', `td-${blocks.length}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Tiêu đề #..#### — giới hạn 4 cấp cho chat gọn.
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      flushPara(`p-${i}`)
      const level = headingMatch[1].length
      const Tag = `h${Math.min(level + 1, 4)}`
      blocks.push(
        <Tag key={`h-${blocks.length}`} className={`md-h md-h${level}`}>
          {renderInline(headingMatch[2].replace(/\s+#+\s*$/, ''), `h-${blocks.length}`)}
        </Tag>,
      )
      i += 1
      continue
    }

    // Đường kẻ --- / *** / ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara(`p-${i}`)
      blocks.push(<hr key={`hr-${blocks.length}`} className="md-hr" />)
      i += 1
      continue
    }

    // Trích dẫn > ...
    if (/^>\s?/.test(trimmed)) {
      flushPara(`p-${i}`)
      const quoteLines = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push(
        <blockquote key={`q-${blocks.length}`} className="md-quote">
          {renderInline(quoteLines.join('\n'), `q-${blocks.length}`)}
        </blockquote>,
      )
      continue
    }

    // List gạch đầu dòng / số — gom thành 1 <ul>/<ol>.
    const listMatch = line.match(/^(\s*)([-*+]\s+|\d+[.)]\s+)(.+)$/)
    if (listMatch) {
      flushPara(`p-${i}`)
      const ordered = /^\d+[.)]\s+/.test(listMatch[2])
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]\s+|\d+[.)]\s+)(.+)$/)
        if (!m) break
        // Checkbox - [ ] / - [x]
        const cbMatch = m[3].match(/^\[([ xX])\]\s+(.+)$/)
        if (cbMatch) {
          items.push({ checkbox: cbMatch[1].toLowerCase() === 'x', text: cbMatch[2] })
        } else {
          // In đậm "Bước 1:" ở đầu dòng cho nổi bật.
          items.push({ checkbox: null, text: m[3] })
        }
        i += 1
      }
      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag key={`list-${blocks.length}`} className={ordered ? 'md-ol' : 'md-ul'}>
          {items.map((item, ii) => (
            <li key={ii}>
              {item.checkbox != null && (
                <input type="checkbox" checked={item.checkbox} readOnly tabIndex={-1} />
              )}{' '}
              {renderInline(item.text, `li-${blocks.length}-${ii}`)}
            </li>
          ))}
        </ListTag>,
      )
      continue
    }

    // Dòng trống -> ngắt đoạn.
    if (trimmed === '') {
      flushPara(`p-${i}`)
      i += 1
      continue
    }

    paraBuffer.push(line)
    i += 1
  }
  flushPara(`p-end`)

  return blocks.length ? blocks : [<p key="empty" className="md-p">{renderInline(String(source ?? ''), 'empty')}</p>]
}

export default function AiMarkdown({ text }) {
  return <div className="md-body">{renderMarkdownBlocks(text)}</div>
}
