import React from "react";
import { StartupFallback } from "./StartupFallback";
import { logStartupError } from "../lib/runtimeDiagnostics";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, errorInfo) {
    logStartupError("react-error-boundary", error, {
      componentStack: errorInfo?.componentStack ?? null,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <StartupFallback
          title="TaxiFlow hit a runtime error."
          message={this.state.error?.message ?? "A startup error stopped the app on this device."}
        />
      );
    }

    return this.props.children;
  }
}
