import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "[data-autofocus='true']",
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const isVisibleElement = (element) =>
  Boolean(
    element &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );

const getFocusableElements = (container) =>
  [...(container?.querySelectorAll?.(FOCUSABLE_SELECTOR) ?? [])].filter(isVisibleElement);

const focusFirstInteractiveElement = (container, initialFocusSelector) => {
  if (!container) {
    return;
  }

  const preferredTarget = initialFocusSelector
    ? container.querySelector(initialFocusSelector)
    : null;

  if (isVisibleElement(preferredTarget)) {
    preferredTarget.focus();
    return;
  }

  const [firstFocusable] = getFocusableElements(container);
  if (firstFocusable) {
    firstFocusable.focus();
    return;
  }

  if (!container.hasAttribute("tabindex")) {
    container.setAttribute("tabindex", "-1");
  }
  container.focus();
};

export function useBottomSheetA11y({
  open,
  onClose,
  focusKey,
  initialFocusSelector = "[data-autofocus='true']",
} = {}) {
  const sheetRef = useRef(null);
  const lastFocusedElementRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    lastFocusedElementRef.current = document.activeElement;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousOverscrollBehavior = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";

    return () => {
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      focusFirstInteractiveElement(sheetRef.current, initialFocusSelector);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusKey, initialFocusSelector, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const sheetElement = sheetRef.current;
      const focusableElements = getFocusableElements(sheetElement);

      if (focusableElements.length === 0) {
        event.preventDefault();
        sheetElement?.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === firstFocusable || !sheetElement?.contains(activeElement)) {
          event.preventDefault();
          lastFocusable.focus();
        }
        return;
      }

      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      return undefined;
    }

    const lastFocusedElement = lastFocusedElementRef.current;
    if (typeof lastFocusedElement?.focus === "function") {
      lastFocusedElement.focus();
    }
    lastFocusedElementRef.current = null;
    return undefined;
  }, [open]);

  return { sheetRef };
}
