import { useId } from "react";
import { X } from "lucide-react";
import { useBottomSheetA11y } from "../hooks/useBottomSheetA11y";

export function MobileBottomSheet({
  open,
  eyebrow = "Driver quick action",
  title,
  subtitle,
  badges = [],
  onClose,
  children,
  footer,
  focusKey,
  initialFocusSelector,
}) {
  const titleId = useId();
  const subtitleId = useId();
  const { sheetRef } = useBottomSheetA11y({
    open,
    onClose,
    focusKey,
    initialFocusSelector,
  });

  if (!open) {
    return null;
  }

  return (
    <div className="mobile-sheet-root" role="presentation">
      <button
        type="button"
        className="mobile-sheet-backdrop"
        aria-label="Close panel"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        <header className="mobile-sheet-header">
          <div className="mobile-sheet-grab" aria-hidden="true" />
          <div className="mobile-sheet-title-wrap">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h3 id={titleId}>{title}</h3>
            {subtitle ? (
              <p id={subtitleId} className="mobile-sheet-subtitle">
                {subtitle}
              </p>
            ) : null}
            {badges.length > 0 ? (
              <div className="mobile-sheet-badges">
                {badges.map((badge) => (
                  <span key={`${badge.label}-${badge.value}`} className="status-chip" data-tone={badge.tone}>
                    {badge.label ? `${badge.label} ${badge.value}` : badge.value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="mobile-sheet-close" aria-label="Close sheet" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="mobile-sheet-body driver-action-panel">{children}</div>

        {footer ? <div className="mobile-sheet-footer">{footer}</div> : null}
      </section>
    </div>
  );
}
