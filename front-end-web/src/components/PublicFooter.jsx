import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth'
import './PublicFooter.css'

const currentYear = new Date().getFullYear()

const publicLinks = [
  { to: '/jobs', label: 'Tìm việc làm' },
  { to: '/companies', label: 'Khám phá doanh nghiệp' }
]

const roleLinks = {
  CANDIDATE: {
    title: 'Dành cho ứng viên',
    links: [
      { to: '/profile', label: 'Hồ sơ cá nhân' },
      { to: '/my-jobs?tab=saved', label: 'Việc làm đã lưu' },
      { to: '/my-jobs?tab=applied', label: 'Đơn ứng tuyển' }
    ]
  },
  RECRUITER: {
    title: 'Dành cho nhà tuyển dụng',
    links: [
      { to: '/recruiter?section=jobs', label: 'Đăng tin tuyển dụng' },
      { to: '/recruiter?section=applications', label: 'Quản lý ứng viên' },
      { to: '/recruiter/talent', label: 'Tìm kiếm ứng viên' },
      { to: '/recruiter?section=company', label: 'Hồ sơ doanh nghiệp' }
    ]
  },
  ADMIN: {
    title: 'Quản trị',
    links: [
      { to: '/admin?section=overview', label: 'Tổng quan hệ thống' },
      { to: '/admin?section=verification', label: 'Xác minh doanh nghiệp' },
      { to: '/admin?section=jobs', label: 'Duyệt tin tuyển dụng' },
      { to: '/admin?section=reports', label: 'Báo cáo vi phạm' }
    ]
  }
}

function FooterLinks({ title, links }) {
  return <nav className="public-footer-group" aria-label={title}>
    <h2>{title}</h2>
    <ul>{links.map(({ to, label }) => <li key={to}><Link to={to}>{label}</Link></li>)}</ul>
  </nav>
}

export default function PublicFooter() {
  const { session } = useAuth()
  const role = session?.user?.role
  const group = roleLinks[role]

  return <footer className="public-footer">
    <div className="public-footer-inner">
      <div className="public-footer-intro">
        <Link className="footer-brand" to="/" aria-label="Job Connect — Trang chủ"><span aria-hidden="true">JC</span><strong>Job Connect</strong></Link>
        <p>Kết nối ứng viên và nhà tuyển dụng qua việc làm, hồ sơ và quy trình tuyển dụng.</p>
      </div>
      <FooterLinks title="Khám phá" links={publicLinks} />
      {group ? <FooterLinks title={group.title} links={group.links} /> : <FooterLinks title="Tham gia" links={[{ to: '/register', label: 'Tạo tài khoản' }, { to: '/login', label: 'Đăng nhập' }]} />}
      <div className="public-footer-bottom">
        <p>© {currentYear} Job Connect.</p>
        <span>Nền tảng kết nối tuyển dụng.</span>
      </div>
    </div>
  </footer>
}
