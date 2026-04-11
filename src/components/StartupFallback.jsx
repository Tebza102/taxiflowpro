import {
  clearBrowserCaches,
  getSafeNavigator,
  getSafeWindow,
  unregisterAllServiceWorkers,
} from "../lib/browserRuntime";
import { readRuntimeDiagnostics } from "../lib/runtimeDiagnostics";

const formatDetailValue = (value) => {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function StartupFallback({
  title = "TaxiFlow could not finish loading.",
  message = "Open the app again, or clear the offline cache on this device before retrying.",
  showDiagnostics = true,
}) {
  const diagnostics = readRuntimeDiagnostics().slice(-6).reverse();
  const browserNavigator = getSafeNavigator();
  const browserWindow = getSafeWindow();

  const handleReload = () => {
    if (browserWindow) {
      browserWindow.location.reload();
    }
  };

  const handleResetOfflineData = async () => {
    await unregisterAllServiceWorkers();
    await clearBrowserCaches();
    handleReload();
  };

  return (
    <div className="loading-shell">
      <div className="loading-card">
        <p className="eyebrow">Startup problem</p>
        <h1>{title}</h1>
        <p className="panel-note">{message}</p>
        <div className="finance-form-meta">
          <span className="status-chip" data-tone="warning">
            {browserNavigator?.userAgent?.includes("Android") ? "Android runtime" : "Browser runtime"}
          </span>
          <span className="status-chip" data-tone="info">
            {browserNavigator?.onLine === false ? "Offline" : "Online"}
          </span>
        </div>
        <div className="finance-form-actions">
          <button type="button" className="action-button primary" onClick={handleReload}>
            Retry app
          </button>
          <button type="button" className="action-button" onClick={handleResetOfflineData}>
            Clear offline cache
          </button>
        </div>
        {showDiagnostics && diagnostics.length > 0 ? (
          <div className="list-stack" style={{ width: "100%", textAlign: "left" }}>
            {diagnostics.map((entry, index) => (
              <article key={`${entry.timestamp}-${entry.type}-${index}`} className="person-row">
                <div className="person-copy">
                  <h3>{entry.type}</h3>
                  <p>{entry.timestamp}</p>
                  {Object.entries(entry.detail ?? {}).map(([key, value]) => {
                    const text = formatDetailValue(value);

                    if (!text) {
                      return null;
                    }

                    return <p key={key}>{`${key}: ${text}`}</p>;
                  })}
                </div>
                <div className="person-metrics">
                  <span className="status-chip" data-tone={entry.level === "error" ? "danger" : "info"}>
                    {entry.level}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
