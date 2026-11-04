export default function EmptyState({ title, description, action }) {
  return <div className="ui-empty-state" role="status"><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>
}
