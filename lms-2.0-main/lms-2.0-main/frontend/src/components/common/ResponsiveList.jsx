import useMediaQuery, { BREAKPOINTS } from '../../hooks/useMediaQuery';

/**
 * One column definition renders a <table> at >= 640px and a <ul> of cards below —
 * the DOM is switched via useMediaQuery, never both rendered (ui-theme/theme.md §3).
 *
 * columns: [{ key, label, render?(row), numeric?, nowrap? }]
 * rowKey: (row) => string | number
 * getUrgency?: (row) => 'breached' | 'near' | undefined — drawn as an edge mark
 * renderCard?: (row) => node — full custom card body; falls back to a label/value dump of `columns`
 * empty: node shown when rows is empty
 */
export default function ResponsiveList({ columns, rows, rowKey, getUrgency, renderCard, empty = null }) {
  const isWide = useMediaQuery(BREAKPOINTS.tablet);

  if (!rows || rows.length === 0) return empty;

  if (isWide) {
    return (
      <div className="rl-scroll">
        <table className="rl-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.numeric ? 'r' : ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} data-urgency={getUrgency?.(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.numeric ? 'r' : ''} ${c.nowrap ? 'nowrap' : ''}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="rl-cards">
      {rows.map((row) => (
        <li key={rowKey(row)} data-urgency={getUrgency?.(row)} className="rl-card">
          {renderCard
            ? renderCard(row)
            : columns.map((c) => (
              <div key={c.key}>
                <span className="muted small">{c.label}: </span>
                {c.render ? c.render(row) : row[c.key]}
              </div>
            ))}
        </li>
      ))}
    </ul>
  );
}
