import { useId } from "react";
import { X } from "lucide-react";
import { useBottomSheetA11y } from "../hooks/useBottomSheetA11y";

export function MobileActionScreen({
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
    <div className="mobile-action-screen-root" role="presentation">
      <section
        ref={sheetRef}
        className="mobile-action-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        <header className="mobile-action-screen-header">
          <div className="mobile-action-screen-title-wrap">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
            {subtitle ? (
              <p id={subtitleId} className="mobile-action-screen-subtitle">
                {subtitle}
              </p>
            ) : null}
            {badges.length > 0 ? (
              <div className="mobile-action-screen-badges">
                {badges.map((badge) => (
                  <span key={`${badge.label}-${badge.value}`} className="status-chip" data-tone={badge.tone}>
                    {badge.label ? `${badge.label} ${badge.value}` : badge.value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="mobile-action-screen-close"
            aria-label="Close screen"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="mobile-action-screen-body">{children}</div>

        {footer ? <div className="mobile-action-screen-footer">{footer}</div> : null}
      </section>
    </div>
  );
}
