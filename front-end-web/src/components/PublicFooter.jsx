import { Link } from 'react-router-dom'

const currentYear = new Date().getFullYear()

export default function PublicFooter() {
  return <footer className="public-footer">
    <div className="public-footer-inner">
      <div><Link className="footer-brand" to="/"><span>JC</span> Job Connect</Link><p>Kết nối đúng người với đúng cơ hội nghề nghiệp.</p></div>
      <nav aria-label="Liên kết cuối trang"><Link to="/jobs">Việc làm</Link><Link to="/companies">Doanh nghiệp</Link><Link to="/register">Đăng ký ứng viên</Link><Link to="/register?role=RECRUITER">Dành cho nhà tuyển dụng</Link></nav>
      <p className="public-footer-note">© {currentYear} Job Connect. Nền tảng kết nối tuyển dụng.</p>
    </div>
  </footer>
}
