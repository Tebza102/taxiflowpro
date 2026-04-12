import { CheckCircle2, Loader2 } from "lucide-react";

export function DriverQuickActionButton({
  label,
  meta,
  icon: Icon,
  tone = "info",
  active = false,
  loading = false,
  success = false,
  disabled = false,
  onClick,
}) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      className="driver-quick-action-button"
      data-tone={tone}
      data-active={active ? "true" : "false"}
      data-success={success ? "true" : "false"}
      data-loading={loading ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      disabled={isDisabled}
      aria-busy={loading ? "true" : "false"}
      aria-disabled={isDisabled ? "true" : "false"}
      onClick={onClick}
    >
      <span className="driver-quick-action-icon">
        {loading ? <Loader2 size={18} className="driver-quick-action-spinner" /> : <Icon size={18} />}
      </span>
      <span className="driver-quick-action-copy">
        <strong>{label}</strong>
        {meta ? <span>{meta}</span> : null}
      </span>
      <span className="driver-quick-action-state">
        {loading ? "Opening..." : success ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
      </span>
    </button>
  );
}
