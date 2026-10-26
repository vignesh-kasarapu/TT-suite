import { useState } from 'react';

export default function Tabs({ tabs, initialActiveKey }) {
  const [active, setActive] = useState(initialActiveKey || tabs[0].key);
  const ActiveContent = tabs.find((t) => t.key === active)?.content;

  return (
    <div>
      <div className="tabs mb-6 overflow-x-auto" role="tablist">
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.key)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div>{ActiveContent}</div>
    </div>
  );
}
