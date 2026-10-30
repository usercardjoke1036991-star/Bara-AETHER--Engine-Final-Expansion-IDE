// Menú desplegable como overlay (portal): lista completa, sin scroll interno.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PortalMenuItem {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
}

interface PortalMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  items: PortalMenuItem[];
  onClose: () => void;
  labelledBy?: string;
}

export default function PortalMenu({ open, anchor, items, onClose, labelledBy }: PortalMenuProps) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 240 });

  useLayoutEffect(() => {
    if (!open || !anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(240, rect.width);
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    if (top + 320 > window.innerHeight) {
      top = Math.max(8, rect.top - 4);
    }
    setPos({ top, left, width });
  }, [open, anchor, items.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (menuRef.current?.contains(target) || anchor?.contains(target)) {
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onPointer, true);
    };
  }, [open, onClose, anchor]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <ul
      ref={menuRef}
      className="portal-menu"
      role="menu"
      aria-labelledby={labelledBy}
      style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
    >
      {items.map((item) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            className="portal-menu-item"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="portal-menu-label">{item.label}</span>
            {item.description ? <span className="portal-menu-desc">{item.description}</span> : null}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}

export function MenuButton({
  label,
  title,
  items,
  open,
  onOpenChange,
}: {
  label: ReactNode;
  title: string;
  items: PortalMenuItem[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {label}
      </button>
      <PortalMenu
        open={open}
        anchor={btnRef.current}
        items={items}
        onClose={() => onOpenChange(false)}
      />
    </>
  );
}
