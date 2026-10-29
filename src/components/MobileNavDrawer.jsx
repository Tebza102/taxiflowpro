import { useId, useState } from "react";
import { Menu, X } from "lucide-react";

import { useBottomSheetA11y } from "../hooks/useBottomSheetA11y";

// Small screens: a compact header (menu button + current page) and a drawer
// that opens only when asked and closes after choosing a page, on the backdrop
// or on Escape. `views` is the role/module-filtered list the desktop module
// buttons use, so the drawer never shows a page the person cannot open.
export function MobileNavDrawer({ views, activeView, onNavigate, fleetName }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const close = () => setOpen(false);
  const { sheetRef } = useBottomSheetA11y({
    open,
    onClose: close,
    initialFocusSelector: "[aria-current='page']",
  });
  const current = views.find((item) => item.id === activeView);

  return (
    <>
      <header className="mobile-topbar" data-testid="mobile-topbar">
        <button
          type="button"
          className="mobile-topbar-menu"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls={open ? "mobile-nav-drawer" : undefined}
          onClick={() => setOpen(true)}
          data-testid="mobile-menu-button"
        >
          <Menu size={20} />
        </button>
        <p className="mobile-topbar-title" data-testid="mobile-page-title">
          {current?.label ?? "TaxiFlow"}
        </p>
      </header>

      {open && (
        <div className="mobile-drawer-root" role="presentation">
          <button type="button" className="mobile-drawer-backdrop" aria-label="Close menu" onClick={close} data-testid="mobile-drawer-backdrop" />
          <nav
            ref={sheetRef}
            id="mobile-nav-drawer"
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="mobile-nav-drawer"
          >
            <div className="mobile-drawer-head">
              <div>
                <p className="eyebrow">Menu</p>
                <h2 id={titleId}>{fleetName || "TaxiFlow"}</h2>
              </div>
              <button type="button" className="mobile-drawer-close" aria-label="Close menu" onClick={close}>
                <X size={20} />
              </button>
            </div>
            <ul className="mobile-drawer-list">
              {views.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === activeView ? "mobile-drawer-item active" : "mobile-drawer-item"}
                    aria-current={item.id === activeView ? "page" : undefined}
                    onClick={() => {
                      onNavigate(item.id);
                      close();
                    }}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
