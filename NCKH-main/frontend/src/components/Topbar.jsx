import useStoredState from '../data/useStoredState'
import { defaultSettings, gradeLabel } from '../data/settings'
import { navigationItems, utilityItems } from '../data/navigation'
import Icon from './Icon'

export default function Topbar({ currentPage, onNavigate, user, onLogout }) {
  const [profile] = useStoredState('nhip-hoc-settings', defaultSettings)
  const page = [...navigationItems, ...utilityItems].find(item => item.path === currentPage)
  return <header className="study-header">
    <div className="study-breadcrumb"><Icon name={currentPage} size={18} /><span>Không gian học tập</span><span aria-hidden="true">/</span><b>{page?.label || 'Mục tiêu'}</b></div>
    <div className="auth-account"><span>{user?.name}</span><button className="ghost-button" onClick={onLogout}>Đăng xuất</button>
    <button className="student-profile-chip" onClick={() => onNavigate('settings')}><Icon name="book" size={17} />{profile.grade ? gradeLabel(profile.grade) : 'Chọn lớp của bạn'}</button></div>
  </header>
}
