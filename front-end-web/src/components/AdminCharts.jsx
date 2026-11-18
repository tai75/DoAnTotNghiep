import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const jobLabels = { DRAFT: 'Bản nháp', PENDING: 'Chờ duyệt', PUBLISHED: 'Đã đăng', CLOSED: 'Đã đóng', REJECTED: 'Bị từ chối' }
const jobColors = { DRAFT: '#64748b', PENDING: '#d97706', PUBLISHED: '#2563eb', CLOSED: '#0f766e', REJECTED: '#be123c' }
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value)
const formatPercent = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)
const noData = <p className="admin-chart-empty">Chưa có dữ liệu thống kê trong khoảng thời gian này.</p>
const invalidData = <p className="admin-chart-invalid-message">Dữ liệu biểu đồ chưa hợp lệ. Vui lòng thử tải lại.</p>

function ChartTable({ label, headings, rows }) {
  return <details className="admin-chart-table"><summary>Xem bảng số liệu</summary><div className="admin-chart-table-scroll" role="region" aria-label={label} tabIndex={0}><table><caption>{label}</caption><thead><tr>{headings.map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{rows}</tbody></table></div></details>
}

function ChartLegend({ items }) {
  return <ul className="admin-chart-legend" role="list" aria-label="Chú giải biểu đồ">{items.map(({ name, color }) => <li key={name}><i style={{ background: color }} aria-hidden="true" />{name}</li>)}</ul>
}

function ActivityChart({ rows, totals, invalid }) {
  return <section className="admin-chart-card" aria-labelledby="admin-activity-title"><h2 id="admin-activity-title">Hoạt động tuyển dụng</h2><p>Tin được tạo và đơn được nộp theo ngày do API cung cấp.</p>{invalid ? invalidData : totals.jobs + totals.applications === 0 ? noData : <><div className="admin-chart-plot"><ResponsiveContainer width="100%" height={270}><BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} minTickGap={20} /><YAxis allowDecimals={false} width={34} /><Tooltip labelFormatter={(value) => `Ngày ${value}`} formatter={(value, name) => [formatNumber(value), name]} /><Bar dataKey="jobs" name="Tin được tạo" fill="#2563eb" isAnimationActive={false} /><Bar dataKey="applications" name="Đơn được nộp" fill="#0f766e" isAnimationActive={false} /></BarChart></ResponsiveContainer></div><ChartLegend items={[{ name: 'Tin được tạo', color: '#2563eb' }, { name: 'Đơn được nộp', color: '#0f766e' }]} /><ChartTable label="Số tin được tạo và đơn được nộp theo ngày" headings={['Ngày', 'Tin được tạo', 'Đơn được nộp']} rows={rows.map((row) => <tr key={row.date}><th scope="row">{row.date}</th><td>{formatNumber(row.jobs)}</td><td>{formatNumber(row.applications)}</td></tr>)} /></>}</section>
}

function AccountsChart({ rows, totals, invalid }) {
  return <section className="admin-chart-card" aria-labelledby="admin-accounts-title"><h2 id="admin-accounts-title">Tài khoản mới</h2><p>Số tài khoản được tạo theo ngày; không phải tổng tài khoản tích lũy.</p>{invalid ? invalidData : totals.users === 0 ? noData : <><div className="admin-chart-plot"><ResponsiveContainer width="100%" height={270}><LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} minTickGap={20} /><YAxis allowDecimals={false} width={34} /><Tooltip labelFormatter={(value) => `Ngày ${value}`} formatter={(value, name) => [formatNumber(value), name]} /><Line dataKey="users" name="Tất cả" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} /><Line dataKey="candidates" name="Ứng viên" stroke="#0f766e" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /><Line dataKey="recruiters" name="Nhà tuyển dụng" stroke="#d97706" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div><ChartLegend items={[{ name: 'Tất cả', color: '#1d4ed8' }, { name: 'Ứng viên', color: '#0f766e' }, { name: 'Nhà tuyển dụng', color: '#d97706' }]} /><ChartTable label="Số tài khoản mới theo ngày và vai trò hiện tại" headings={['Ngày', 'Tất cả', 'Ứng viên', 'Nhà tuyển dụng', 'Quản trị viên']} rows={rows.map((row) => <tr key={row.date}><th scope="row">{row.date}</th><td>{formatNumber(row.users)}</td><td>{formatNumber(row.candidates)}</td><td>{formatNumber(row.recruiters)}</td><td>{formatNumber(row.admins)}</td></tr>)} /></>}</section>
}

function StatusChart({ donut, total, invalid }) {
  const colors = donut.map((item) => ({ name: jobLabels[item.status], color: jobColors[item.status] }))
  return <section className="admin-chart-card admin-chart-card--status" aria-labelledby="admin-status-title"><h2 id="admin-status-title">Trạng thái tin tuyển dụng trong kỳ</h2><p>Phân bố trạng thái hiện tại của các tin được tạo trong khoảng thời gian đang xem.</p>{invalid ? invalidData : total === 0 ? noData : <><div className="admin-donut-layout"><div className="admin-chart-plot admin-chart-plot--donut"><ResponsiveContainer width="100%" height={270}><PieChart><Pie data={donut} dataKey="count" nameKey="status" innerRadius={58} outerRadius={88} paddingAngle={2} isAnimationActive={false}>{donut.map((item) => <Cell key={item.status} fill={jobColors[item.status]} />)}</Pie><Tooltip formatter={(value, status) => [`${formatNumber(value)} tin (${formatPercent(value / total * 100)}%)`, jobLabels[status] || status]} /></PieChart></ResponsiveContainer></div><ChartLegend items={colors} /></div><ChartTable label="Trạng thái hiện tại của tin được tạo trong kỳ" headings={['Trạng thái', 'Số tin', 'Tỷ lệ']} rows={donut.map((item) => <tr key={item.status}><th scope="row">{jobLabels[item.status]}</th><td>{formatNumber(item.count)}</td><td>{formatPercent(item.count / total * 100)}%</td></tr>)} /></>}</section>
}

export default function AdminCharts({ data }) {
  if (data.status === 'invalid') return <section className="admin-chart-invalid" role="alert"><h2>Thống kê theo thời gian</h2><p>Dữ liệu thống kê chưa hợp lệ. Vui lòng thử tải lại sau.</p></section>
  return <div className="admin-chart-grid"><ActivityChart rows={data.rows} totals={data.totals} invalid={data.charts.activity === 'invalid'} /><AccountsChart rows={data.rows} totals={data.totals} invalid={data.charts.accounts === 'invalid'} /><StatusChart donut={data.donut} total={data.totals.jobs} invalid={data.charts.status === 'invalid'} /></div>
}
