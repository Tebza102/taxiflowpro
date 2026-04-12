import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

const focusFirstInteractiveElement = (container, initialFocusSelector) => {
  if (!container) {
    return;
  }

  const preferredTarget = initialFocusSelector
    ? container.querySelector(initialFocusSelector)
    : null;

  if (preferredTarget && preferredTarget.getClientRects().length > 0) {
    preferredTarget.focus();
    return;
  }

  const fallbackTarget = container.querySelector(
    "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
  );

  fallbackTarget?.focus();
};

export function DriverFullScreenView({
  eyebrow = "Driver quick action",
  title,
  subtitle,
  badges = [],
  onBack,
  children,
  footer,
  focusKey,
  initialFocusSelector = "[data-autofocus='true']",
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousOverscrollBehavior = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";

    return () => {
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      focusFirstInteractiveElement(containerRef.current, initialFocusSelector);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusKey, initialFocusSelector]);

  return (
    <section className="driver-fullscreen-view" ref={containerRef}>
      <header className="driver-fullscreen-header">
        <button type="button" className="driver-fullscreen-back" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <div className="driver-fullscreen-title-wrap">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {subtitle ? <p className="driver-fullscreen-subtitle">{subtitle}</p> : null}
          {badges.length > 0 ? (
            <div className="driver-fullscreen-badges">
              {badges.map((badge) => (
                <span key={`${badge.label}-${badge.value}`} className="status-chip" data-tone={badge.tone}>
                  {badge.label ? `${badge.label} ${badge.value}` : badge.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      <div className="driver-fullscreen-body driver-action-panel">{children}</div>
      {footer ? <div className="driver-fullscreen-footer">{footer}</div> : null}
    </section>
  );
}
