export default function Card({ className = '', children, ...props }) {
  return <section className={`ui-card ${className}`.trim()} {...props}>{children}</section>
}
