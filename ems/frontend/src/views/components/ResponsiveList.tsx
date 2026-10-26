// One column definition renders a <table> at >= 640 px and a list of cards below; never both (theme.md §3).
import type { ReactNode } from "react";
import { BP, useMediaQuery } from "../../controllers/useAsync";

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "right";
}

export function ResponsiveList<T>({ rows, columns, rowKey, card, onRowClick, empty, edge, footer }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  card: (row: T) => { title: ReactNode; status?: ReactNode; detail?: ReactNode; meta?: ReactNode[]; actions?: ReactNode };
  onRowClick?: (row: T) => void;
  empty: ReactNode;
  edge?: (row: T) => "bad" | "warn" | undefined;
  footer?: ReactNode;
}) {
  const wide = useMediaQuery(BP.tablet);
  if (rows.length === 0) return empty ? <div className="list-wrap">{empty}</div> : null;

  if (wide) {
    return (
      <div className="list-wrap">
      <div className="rl-scroll">
        <table className="rl-table">
          <thead>
            <tr>{columns.map((c, i) => <th key={i} className={c.align === "right" ? "r" : undefined}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className={onRowClick ? "clickable" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c, i) => {
                  const e = i === 0 ? edge?.(r) : undefined;
                  const cls = [c.align === "right" ? "r" : "", e ? `edge-${e}` : ""].join(" ").trim();
                  return <td key={i} className={cls || undefined}>{c.cell(r)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
      </div>
    );
  }

  return (
    <div className="list-wrap">
    <ul className="rl-cards">
      {rows.map((r) => {
        const c = card(r);
        const e = edge?.(r);
        return (
          <li key={rowKey(r)} className={`rl-card${e ? ` edge-${e}` : ""}`} onClick={onRowClick ? () => onRowClick(r) : undefined}
            style={onRowClick ? { cursor: "pointer" } : undefined}>
            <header><span className="name">{c.title}</span>{c.status}</header>
            {c.detail && <div>{c.detail}</div>}
            {c.meta && <div className="meta">{c.meta.map((m, i) => <span key={i}>{m}</span>)}</div>}
            {c.actions && <div className="actions" onClick={(ev) => ev.stopPropagation()}>{c.actions}</div>}
          </li>
        );
      })}
    </ul>
    {footer}
    </div>
  );
}
