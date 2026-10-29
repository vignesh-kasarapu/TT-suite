import { useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { GhostButton } from '../common/GlassButton';

/**
 * A dropdown of a simple master list (departments, regions) with "+" to add a new entry and
 * a pencil to rename the selected one, both inline. `onCreate(name)` / `onRename(id, name)`
 * return the saved item ({ id, name }); the parent refreshes its list.
 */
export default function MasterPicker({ id, label, items, value, onChange, onCreate, onRename, emptyLabel, required = false }) {
  const [mode, setMode] = useState(null); // null | 'add' | 'rename'
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const selected = items.find((item) => String(item.id) === String(value));
  const noun = label.toLowerCase();

  const open = (next) => {
    setMode(next);
    setName(next === 'rename' ? selected?.name || '' : '');
    setError(null);
  };

  const save = async () => {
    if (!name.trim()) {
      setError(`Enter a ${noun} name.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = mode === 'add' ? await onCreate(name.trim()) : await onRename(selected.id, name.trim());
      onChange(String(item.id));
      setMode(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {mode ? (
        <div className="flex gap-2">
          <input id={id} className="input flex-1" autoFocus value={name} maxLength={100}
            placeholder={mode === 'add' ? `New ${noun} name` : `Rename ${selected?.name}`}
            data-testid={`${id}-name`}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') { e.preventDefault(); setMode(null); }
            }} />
          <GhostButton type="button" onClick={save} disabled={busy} title="Save" aria-label={`Save ${noun}`}
            data-testid={`${id}-save`}>
            <Check className="w-4 h-4" />
          </GhostButton>
          <GhostButton type="button" onClick={() => setMode(null)} disabled={busy} title="Cancel" aria-label="Cancel">
            <X className="w-4 h-4" />
          </GhostButton>
        </div>
      ) : (
        <div className="flex gap-2">
          <select id={id} className="input flex-1" value={value} required={required}
            onChange={(e) => onChange(e.target.value)}>
            <option value="">{emptyLabel}</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <GhostButton type="button" onClick={() => open('add')} title={`Add a ${noun}`} aria-label={`Add a ${noun}`}
            data-testid={`${id}-add`}>
            <Plus className="w-4 h-4" />
          </GhostButton>
          <GhostButton type="button" onClick={() => open('rename')} disabled={!selected}
            title={selected ? `Rename ${selected.name}` : `Select a ${noun} to rename it`} aria-label={`Rename ${noun}`}
            data-testid={`${id}-rename`}>
            <Pencil className="w-4 h-4" />
          </GhostButton>
        </div>
      )}
      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}
