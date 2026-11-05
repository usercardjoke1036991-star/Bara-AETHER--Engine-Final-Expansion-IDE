// Menú desplegable como overlay (portal): lista completa, sin scroll interno.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PortalMenuItem {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
  onSelect: () => void;
}

interface PortalMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  items: PortalMenuItem[];
  onClose: () => void;
  labelledBy?: string;
  /** Mueve el foco al primer ítem y lo devuelve al ancla con Esc. */
  autoFocus?: boolean;
}

export function placePortalMenu(input: {
  anchorTop: number;
  anchorBottom: number;
  anchorLeft: number;
  anchorWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { top: number; left: number; width: number; maxHeight: number | undefined; scroll: boolean } {
  const width = Math.max(240, input.anchorWidth);
  let left = input.anchorLeft;
  if (left + width > input.viewportWidth - 8) {
    left = Math.max(8, input.viewportWidth - width - 8);
  }
  const below = input.anchorBottom + 4;
  const above = input.anchorTop - input.menuHeight - 4;
  const fitsBelow = below + input.menuHeight <= input.viewportHeight - 8;
  const fitsAbove = above >= 8;
  if (fitsBelow) {
    return { top: below, left, width, maxHeight: undefined, scroll: false };
  }
  if (fitsAbove) {
    return { top: above, left, width, maxHeight: undefined, scroll: false };
  }
  return {
    top: 8,
    left,
    width,
    maxHeight: Math.max(80, input.viewportHeight - 16),
    scroll: true,
  };
}

export default function PortalMenu({
  open,
  anchor,
  items,
  onClose,
  labelledBy,
  autoFocus = false,
}: PortalMenuProps) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({
    top: 0,
    left: 0,
    width: 240,
    maxHeight: undefined as number | undefined,
    scroll: false,
  });

  useLayoutEffect(() => {
    if (!open || !anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    setPos(
      placePortalMenu({
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        anchorLeft: rect.left,
        anchorWidth: rect.width,
        menuHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
    if (autoFocus) {
      menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    }
  }, [open, anchor, items.length, autoFocus]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (autoFocus && anchor instanceof HTMLElement) {
          anchor.focus();
        }
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
  }, [open, onClose, anchor, autoFocus]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <ul
      ref={menuRef}
      className={pos.scroll ? "portal-menu portal-menu-scroll" : "portal-menu"}
      role="menu"
      aria-labelledby={labelledBy}
      style={{
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
        maxHeight: pos.maxHeight,
        overflow: pos.scroll ? "auto" : undefined,
      }}
    >
      {items.map((item) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            className={item.active ? "portal-menu-item active" : "portal-menu-item"}
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
