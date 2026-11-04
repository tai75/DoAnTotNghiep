export default function Avatar({ name = '', src, size = 'md', ...props }) {
  return src
    ? <img className={`ui-avatar ui-avatar-${size}`} src={src} alt={name} {...props} />
    : <span className={`ui-avatar ui-avatar-${size}`} aria-label={name} {...props}>{name.trim().charAt(0).toUpperCase() || 'U'}</span>
}
