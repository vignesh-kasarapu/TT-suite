export default function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="empty">
      {Icon && (
        <span className="ico">
          <Icon strokeWidth={1.75} />
        </span>
      )}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  );
}
