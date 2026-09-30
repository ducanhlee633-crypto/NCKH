import { useEffect, useRef } from 'react'
export default function Modal({ title, onClose, children }) {
 const ref = useRef(null)
 useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close() }, [])
 return <dialog ref={ref} className="app-modal" aria-label={title} onCancel={onClose} onClick={(e) => { if(e.target === e.currentTarget) onClose() }}><div className="composer-top"><b>{title}</b><button type="button" aria-label="Đóng" onClick={onClose}>×</button></div>{children}</dialog>
}