import { useEffect, useState } from 'react'
import { recruiterApi } from '../services/api'

const labels = {
  UNVERIFIED: 'Chưa xác minh',
  PENDING: 'Đang chờ duyệt',
  REJECTED: 'Đã bị từ chối'
}

export default function CompanyVerificationBanner({ user }) {
  const [company, setCompany] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (user?.role !== 'RECRUITER') return
    let active = true
    recruiterApi.company().then(async (currentCompany) => {
      if (!active) return
      setCompany(currentCompany)
      if (currentCompany.verificationStatus !== 'REJECTED') return
      try {
        const requests = await recruiterApi.verificationRequests()
        if (active) setRejectionReason(requests.find((request) => request.status === 'REJECTED')?.rejectionReason || '')
      } catch {
        if (active) setError('Không thể tải lý do từ chối. Vui lòng tải lại trang.')
      }
    }).catch(() => {})
    return () => { active = false }
  }, [user?.role])

  if (user?.role !== 'RECRUITER' || !company || company.verificationStatus === 'VERIFIED') return null

  async function submit() {
    setSending(true); setError('')
    try {
      await recruiterApi.requestVerification(crypto.randomUUID())
      setCompany(await recruiterApi.company())
      setRejectionReason('')
    } catch (requestError) { setError(requestError.message) } finally { setSending(false) }
  }

  return <section className="company-verification-banner" aria-live="polite">
    <div><strong>Trạng thái doanh nghiệp: {labels[company.verificationStatus] || company.verificationStatus}</strong><p>Bạn có thể cập nhật hồ sơ công ty và lưu tin nháp. Chỉ doanh nghiệp đã xác minh mới được gửi tin duyệt hoặc truy cập dữ liệu riêng tư của ứng viên.</p>{company.verificationStatus === 'REJECTED' && rejectionReason && <p>Lý do từ chối: {rejectionReason}</p>}{error && <small role="alert">{error}</small>}</div>
    {company.verificationStatus !== 'PENDING' && <button type="button" disabled={sending} onClick={submit}>{sending ? 'Đang gửi…' : 'Gửi yêu cầu xác minh'}</button>}
  </section>
}
