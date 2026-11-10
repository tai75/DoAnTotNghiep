import { useState } from 'react'
import { Modal } from './ui'
import { reportsApi } from '../services/api'

const reasons = [
  ['SPAM', 'Nội dung rác hoặc lặp lại'],
  ['MISLEADING', 'Thông tin sai lệch'],
  ['DISCRIMINATION', 'Nội dung phân biệt đối xử'],
  ['FRAUD', 'Có dấu hiệu lừa đảo'],
  ['OTHER', 'Lý do khác']
]

export default function ReportModal({ open, onClose, targetType, targetId, targetName, onSuccess }) {
  const [reason, setReason] = useState('MISLEADING')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (description.trim().length < 10) return setError('Vui lòng mô tả ít nhất 10 ký tự để quản trị viên có đủ thông tin xử lý.')
    setSubmitting(true)
    setError('')
    try {
      await reportsApi.create({ targetType, targetId, reason, description: description.trim() })
      setDescription('')
      onSuccess?.('Báo cáo đã được gửi. Cảm ơn bạn đã giúp Job Connect an toàn hơn.')
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return <Modal open={open} title="Báo cáo nội dung" onClose={onClose}>
    <form className="report-form" onSubmit={submit}>
      <p>Bạn đang báo cáo <strong>{targetName}</strong>. Thông tin này chỉ được dùng để kiểm duyệt.</p>
      <label>Lý do<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Mô tả chi tiết<textarea required minLength="10" maxLength="2000" rows="5" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mô tả dấu hiệu vi phạm và thông tin cần kiểm tra" /></label>
      {error && <p className="board-message error" role="alert">{error}</p>}
      <div className="admin-modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={submitting}>{submitting ? 'Đang gửi...' : 'Gửi báo cáo'}</button></div>
    </form>
  </Modal>
}
