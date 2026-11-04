export default function Badge({ tone = 'default', children, ...props }) {
  return <span className={`ui-badge ui-badge-${tone}`} {...props}>{children}</span>
}
