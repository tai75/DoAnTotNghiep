import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Avatar } from './ui'
import { messagesApi } from '../services/api'
import NotificationCenter from './NotificationCenter'
import './AppShell.css'

const roleLinks = {
  CANDIDATE: [{ to: '/jobs', label: 'Việc làm', icon: '⌕' }, { to: '/my-jobs', label: 'Việc của tôi', icon: '▣' }, { to: '/invitations', label: 'Lời mời', icon: '✉' }],
  RECRUITER: [{ to: '/recruiter', label: 'Việc làm', icon: '▤' }, { to: '/recruiter/talent', label: 'Tìm ứng viên', icon: '⌕' }, { to: '/recruiter', label: 'Việc của tôi', icon: '▣' }],
  ADMIN: [{ to: '/admin', label: 'Việc làm', icon: '▤' }, { to: '/admin', label: 'Việc của tôi', icon: '▣' }]
}

export default function AppShell({ user, logout, children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [unreadMessages, setUnreadMessages] = useState(0)
  const menuRef = useRef(null)
  const userRole = user?.role
  const links = roleLinks[userRole] || roleLinks.CANDIDATE
  const profilePath = userRole === 'CANDIDATE' ? '/profile' : userRole === 'RECRUITER' ? '/recruiter' : '/admin'
  const loginPath = `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`

  useEffect(() => {
    if (!drawerOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [drawerOpen])

  useEffect(() => {
    if (!workspaceOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('workspace-menu-open')
    const closeAfterNavigation = (event) => {
      if (event.target.closest('.recruiter-sidebar button, .admin-sidebar button')) setWorkspaceOpen(false)
    }
    document.addEventListener('click', closeAfterNavigation)
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.classList.remove('workspace-menu-open')
      document.removeEventListener('click', closeAfterNavigation)
    }
  }, [workspaceOpen])

  useEffect(() => {
    if (!['CANDIDATE', 'RECRUITER'].includes(userRole)) return undefined
    const loadUnread = () => messagesApi.unreadCount().then(({ count }) => setUnreadMessages(count)).catch(() => {})
    loadUnread()
    const timer = window.setInterval(loadUnread, 5000)
    return () => window.clearInterval(timer)
  }, [userRole])

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setDrawerOpen(false)
        setWorkspaceOpen(false)
      }
    }
    const closeOnOutsideClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('mousedown', closeOnOutsideClick)
    }
  }, [])

  function submitSearch(event) {
    event.preventDefault()
    navigate(search.trim() ? `/jobs?search=${encodeURIComponent(search.trim())}` : '/jobs')
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="app-header-inner">
        <button className="app-menu-toggle" type="button" aria-label="Mở menu điều hướng" aria-controls="app-mobile-drawer" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><span aria-hidden="true">☰</span></button>
        {user && ['RECRUITER', 'ADMIN'].includes(user.role) && <button className="app-workspace-toggle" type="button" aria-label="Mở menu quản trị" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen(true)}>☷</button>}
        <Link className="app-brand" to={user ? (user.role === 'CANDIDATE' ? '/jobs' : profilePath) : '/jobs'}><span className="app-brand-mark">JC</span><span className="app-brand-name">Job Connect</span></Link>
        <form className="app-search" onSubmit={submitSearch} role="search"><span aria-hidden="true">⌕</span><input aria-label="Tìm kiếm việc làm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm việc làm, kỹ năng..." /></form>
        <nav className="app-nav" aria-label="Điều hướng chính">{links.map((link, index) => <Link className={location.pathname === link.to && index === 0 ? 'active' : ''} key={`${link.to}-${index}`} to={link.to}><span aria-hidden="true">{link.icon}</span>{link.label}</Link>)}</nav>
        <div className="app-actions">
          {user ? <><NotificationCenter user={user} /><Link className="app-action-button" to="/messages" aria-label={`Tin nhắn${unreadMessages ? `, ${unreadMessages} chưa đọc` : ''}`}><span aria-hidden="true">✉</span>{unreadMessages > 0 && <b>{unreadMessages > 9 ? '9+' : unreadMessages}</b>}</Link><div className="app-account" ref={menuRef}><button className="app-account-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><Avatar name={user.fullName} size="sm" /><span>{user.fullName}</span><span aria-hidden="true">⌄</span></button>          {menuOpen && <div className="app-account-menu" role="menu"><Link role="menuitem" to={profilePath} onClick={() => setMenuOpen(false)}>Hồ sơ</Link>{user.role === 'CANDIDATE' && <Link role="menuitem" to="/alerts" onClick={() => setMenuOpen(false)}>Thông báo việc làm</Link>}<Link role="menuitem" to="/messages" onClick={() => setMenuOpen(false)}>Tin nhắn</Link><button role="menuitem" onClick={logout}>Đăng xuất</button></div>}</div></> : <Link className="app-login-link" to={loginPath}>Đăng nhập</Link>}
        </div>
      </div>
    </header>
    {drawerOpen && <div className="app-drawer-layer"><button className="app-drawer-overlay" type="button" aria-label="Đóng menu điều hướng" onClick={() => setDrawerOpen(false)} /><aside className="app-mobile-drawer" id="app-mobile-drawer" aria-label="Menu điều hướng"><div className="app-drawer-heading"><Link className="app-brand" onClick={() => setDrawerOpen(false)} to={user ? (user.role === 'CANDIDATE' ? '/jobs' : profilePath) : '/jobs'}><span className="app-brand-mark">JC</span><span>Job Connect</span></Link><button type="button" className="app-drawer-close" aria-label="Đóng menu" onClick={() => setDrawerOpen(false)}>×</button></div><form className="app-drawer-search" onSubmit={(event) => { setDrawerOpen(false); submitSearch(event) }} role="search"><input aria-label="Tìm kiếm việc làm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm việc làm, kỹ năng..." /><button type="submit">Tìm</button></form><nav>{links.map((link, index) => <Link className={location.pathname === link.to && index === 0 ? 'active' : ''} key={`${link.to}-drawer-${index}`} onClick={() => setDrawerOpen(false)} to={link.to}><span aria-hidden="true">{link.icon}</span>{link.label}</Link>)}<Link to="/messages" onClick={() => setDrawerOpen(false)}><span aria-hidden="true">✉</span>Tin nhắn{unreadMessages > 0 && <b>{unreadMessages}</b>}</Link>{user?.role === 'CANDIDATE' && <Link to="/alerts" onClick={() => setDrawerOpen(false)}><span aria-hidden="true">◇</span>Thông báo việc làm</Link>}</nav><div className="app-drawer-account">{user ? <><Link to={profilePath} onClick={() => setDrawerOpen(false)}><Avatar name={user.fullName} size="sm" /><span><strong>{user.fullName}</strong><small>Hồ sơ tài khoản</small></span></Link><button type="button" onClick={logout}>Đăng xuất</button></> : <Link to={loginPath} onClick={() => setDrawerOpen(false)}>Đăng nhập</Link>}</div></aside></div>}
    {workspaceOpen && <div className="app-workspace-layer"><button type="button" className="app-workspace-overlay" aria-label="Đóng menu quản trị" onClick={() => setWorkspaceOpen(false)} /><button type="button" className="app-workspace-close" aria-label="Đóng menu quản trị" onClick={() => setWorkspaceOpen(false)}>×</button></div>}
    <div className="app-content">{children}</div>
    <nav className="app-mobile-nav" aria-label="Điều hướng di động">{links.map((link, index) => <Link className={location.pathname === link.to && index === 0 ? 'active' : ''} key={`${link.to}-mobile-${index}`} to={link.to}><span aria-hidden="true">{link.icon}</span>{link.label}</Link>)}{user ? <button onClick={() => setMenuOpen((current) => !current)}><Avatar name={user.fullName} size="sm" /><span>Tài khoản</span></button> : <Link to={loginPath}><span aria-hidden="true">⇥</span>Đăng nhập</Link>}</nav>
  </div>
}
