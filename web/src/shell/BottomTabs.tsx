import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { BottomTab } from "./layoutState";

const TAB_SLOT_PX = 112;

export function partitionTabs<T>(tabs: readonly T[], slots: number): { shown: T[]; overflow: T[] } {
  if (!Number.isFinite(slots) || slots >= tabs.length) {
    return { shown: [...tabs], overflow: [] };
  }
  const shownCount = Math.max(1, Math.floor(slots));
  return { shown: tabs.slice(0, shownCount), overflow: tabs.slice(shownCount) };
}

interface BottomTabStripProps {
  tabs: ReadonlyArray<readonly [BottomTab, string]>;
  active: BottomTab;
  onSelect: (id: BottomTab) => void;
  /** Huecos medidos. Si no llega, se miden en el contenedor. */
  slots?: number;
  controls: ReactNode;
}

export default function BottomTabStrip({
  tabs,
  active,
  onSelect,
  slots,
  controls,
}: BottomTabStripProps) {
  const host = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(slots ?? tabs.length);
  const [menu, setMenu] = useState(false);

  useLayoutEffect(() => {
    if (slots !== undefined) {
      setMeasured(slots);
      return undefined;
    }
    const el = host.current;
    if (!el) {
      return undefined;
    }
    const measure = () => {
      const width = el.clientWidth;
      if (width <= 0) {
        setMeasured(tabs.length);
        return;
      }
      setMeasured(Math.max(1, Math.floor(width / TAB_SLOT_PX)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [slots, tabs.length]);

  const { shown, overflow } = partitionTabs(tabs, measured);
  const overflowActive = overflow.some(([id]) => id === active);

  return (
    <div className="bottom-bar">
      <div className="bottom-tabs" role="tablist" ref={host}>
        {shown.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            className={active === id ? "active" : undefined}
            title={label}
            onClick={() => onSelect(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="bottom-controls">
        {overflow.length > 0 ? (
          <button
            type="button"
            aria-label="Más pestañas"
            aria-expanded={menu}
            className={overflowActive ? "active" : undefined}
            onClick={() => setMenu((open) => !open)}
          >
            »
          </button>
        ) : null}
        {controls}
        {menu && overflow.length > 0 ? (
          <ul className="bottom-tab-menu" role="menu">
            {overflow.map(([id, label]) => (
              <li key={id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={active === id ? "active" : undefined}
                  onClick={() => {
                    onSelect(id);
                    setMenu(false);
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
