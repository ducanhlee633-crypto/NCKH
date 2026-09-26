export function CardHeader({ icon, title, tone = 'blue', action, onAction }) {
  return (
    <div className="card-header">
      <div className="header-title">
        <span className={'header-icon ' + tone}>{icon}</span>
        <h2>{title}</h2>
      </div>
      {action && <button className="small-action" onClick={onAction}>＋ {action}</button>}
    </div>
  )
}

export function EmptyState({ icon, title, button, tone = 'blue' }) {
  return (
    <div className={'empty-state ' + tone}>
      <div className="empty-icon">{icon}</div>
      <p>{title}</p>
      {button && <button className="outline-button">＋ {button}</button>}
    </div>
  )
}

export function PageIntro({ eyebrow, title, subtitle, action, onAction, children }) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children || (action && <button className="primary-button" onClick={onAction}>＋ {action}</button>)}
    </div>
  )
}

export function SectionCard({ children, className = '', id }) {
  return <section className={'dashboard-card ' + className} id={id}>{children}</section>
}

export function ProgressBar({ value = 0, tone = 'blue' }) {
  return <div className={'progress-line ' + tone}><i style={{ width: value + '%' }} /></div>
}

export function SegmentedControl({ items, active = 0 }) {
  return <div className="segmented-control">{items.map((item, index) => <button className={index === active ? 'selected' : ''} key={item}>{item}</button>)}</div>
}
