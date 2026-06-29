"use client";

import { Component, type ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

// Internal props that include WithTranslation for the wrapped version
type InternalErrorBoundaryProps = ErrorBoundaryProps & Partial<WithTranslation>;

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component - catches rendering errors to prevent app crashes
 *
 * Used to wrap components that may cause crashes, such as file previews, complex UI, etc.
 */
export class ErrorBoundary extends Component<
  InternalErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: InternalErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);

    // Save error info to session storage for debugging
    try {
      sessionStorage.setItem(
        "error-boundary-log",
        JSON.stringify({
          error: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Helper method to access t function
  get t() {
    // withTranslation HOC always provides t, but we need to handle the case where it might not
    return this.props.t || ((key: string) => key);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback or default error UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full flex-col items-center justify-center p-8 text-center">
          <div className="flex max-w-md flex-col items-center">
            <div className="bg-red-500/10 mb-4 flex size-20 items-center justify-center rounded-full">
              <RemixIcon
                name="error_warning"
                size="size-10"
                className="text-red-500"
              />
            </div>
            <h3 className="text-foreground mb-2 text-lg font-medium">
              {this.t("common.errorBoundary.title")}
            </h3>
            <p className="text-muted-foreground mb-4 text-sm">
              {this.state.error?.message ||
                this.t("common.errorBoundary.unknownError")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={this.handleReset}
                className="gap-2"
              >
                <RemixIcon name="refresh" size="size-4" />
                {this.t("common.errorBoundary.retry")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                {this.t("common.errorBoundary.refreshPage")}
              </Button>
            </div>
            {this.state.error && (
              <details className="mt-4 w-full text-left">
                <summary className="text-muted-foreground cursor-pointer text-xs hover:text-foreground">
                  {this.t("common.errorBoundary.viewDetails")}
                </summary>
                <pre className="mt-2 overflow-auto rounded-md bg-muted p-2 text-xs">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Functional error boundary wrapper - for HOC or hooks
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
) {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

// Export with withTranslation HOC
const ErrorBoundaryWithI18n = withTranslation()(ErrorBoundary);
export default ErrorBoundaryWithI18n;
