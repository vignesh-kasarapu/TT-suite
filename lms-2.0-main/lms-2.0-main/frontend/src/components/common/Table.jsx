// Shared table shell: a sticky header row inside a bounded scroll container, so the
// header (and the page's Topbar above it) never scroll away with the rows. Callers pass
// `columns` for the header and `<tr>` elements as children for the body — deliberately
// not a fully data-driven grid, since each list in this app renders very different row
// content (avatars, inline controls, badges, etc).
export default function Table({ columns, children, maxHeight = 'max-h-[70vh]', className = '' }) {
  return (
    <div className={`overflow-auto ${maxHeight} rounded-lg border border-border ${className}`}>
      <table className="w-full min-w-[640px] border-collapse" style={{ fontSize: 'var(--font-size-2)' }}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key || col.label}
                className={`text-left px-4 py-3 font-medium text-muted whitespace-nowrap ${col.className || ''}`}
                style={{ fontSize: 'var(--font-size-1)' }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
