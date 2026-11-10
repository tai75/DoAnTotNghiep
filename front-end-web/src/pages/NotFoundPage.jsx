import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import PublicFooter from '../components/PublicFooter'
import { useAuth } from '../context/auth'
import useDocumentMeta from '../hooks/useDocumentMeta'
import '../public.css'

export default function NotFoundPage() {
  const { session, logout } = useAuth()
  useDocumentMeta('Không tìm thấy trang — Job Connect', 'Trang bạn yêu cầu không tồn tại hoặc đã được di chuyển.')
  return <AppShell user={session?.user} logout={logout}><main className="not-found-page"><p className="not-found-code">404</p><h1>Không tìm thấy trang</h1><p>Đường dẫn này không tồn tại hoặc đã được di chuyển.</p><div><Link className="primary-button" to="/">Về trang chủ</Link><Link className="secondary-button" to="/jobs">Tìm việc làm</Link></div></main><PublicFooter /></AppShell>
}
