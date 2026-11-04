export default function Skeleton({ width = '100%', height = 16, className = '' }) {
  return <span className={`ui-skeleton ${className}`.trim()} style={{ width, height }} aria-hidden="true" />
}
