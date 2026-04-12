import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { StartupFallback } from "./components/StartupFallback";
import { canUseServiceWorker, clearBrowserCaches, getSafeWindow, unregisterAllServiceWorkers } from "./lib/browserRuntime";
import { attachGlobalRuntimeDiagnostics, logStartupError, logStartupEvent } from "./lib/runtimeDiagnostics";
import "./styles.css";

const App = React.lazy(() => {
  logStartupEvent("app-module-load-start");
  return import("./App")
    .then((module) => {
      logStartupEvent("app-module-load-success");
      return module;
    })
    .catch((error) => {
      logStartupError("app-module-load-failed", error);
      throw error;
    });
});

attachGlobalRuntimeDiagnostics();
logStartupEvent("bootstrap-start");

const browserWindow = getSafeWindow();

const resetOfflineStateIfRequested = async () => {
  if (!browserWindow) {
    return;
  }

  const url = new URL(browserWindow.location.href);
  if (url.searchParams.get("reset-sw") !== "1") {
    return;
  }

  logStartupEvent("service-worker-reset-requested");
  await unregisterAllServiceWorkers();
  await clearBrowserCaches();
  url.searchParams.delete("reset-sw");
  browserWindow.location.replace(url.toString());
};

const registerServiceWorker = () => {
  if (!canUseServiceWorker()) {
    logStartupEvent("service-worker-unsupported");
    return;
  }

  const browserNavigator = navigator;
  const browserWindowRef = getSafeWindow();
  const runRegistration = () => {
    browserNavigator.serviceWorker
      .register("/sw.js", {
        updateViaCache: "none",
      })
      .then((registration) => {
        logStartupEvent("service-worker-registered", {
          scope: registration.scope,
        });
      })
      .catch((error) => {
        logStartupError("service-worker-register-failed", error);
      });
  };

  if (!browserWindowRef) {
    return;
  }

  browserWindowRef.addEventListener("load", () => {
    if ("requestIdleCallback" in browserWindowRef) {
      browserWindowRef.requestIdleCallback(runRegistration, { timeout: 4000 });
      return;
    }

    browserWindowRef.setTimeout(runRegistration, 1200);
  });
};

const mount = async () => {
  try {
    await resetOfflineStateIfRequested();

    const rootElement = document.getElementById("root");

    if (!rootElement) {
      throw new Error("React root element was not found.");
    }

    registerServiceWorker();
    logStartupEvent("bootstrap-render");

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <Suspense
            fallback={
              <StartupFallback
                title="TaxiFlow is starting."
                message="The app is loading core modules for this device."
                showDiagnostics={false}
              />
            }
          >
            <App />
          </Suspense>
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    logStartupError("bootstrap-failed", error);

    const rootElement = document.getElementById("root");
    if (rootElement) {
      ReactDOM.createRoot(rootElement).render(
        <StartupFallback
          title="TaxiFlow could not start."
          message={error.message ?? "Startup failed before the app could render."}
        />,
      );
    }
  }
};

void mount();
