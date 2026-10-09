import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary.
 *
 * A render-time crash with no boundary leaves the user staring at a white
 * screen; this at least names the failure, keeps the message in Persian, and
 * offers a reload. The stack is logged to the console for developers.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[nexora] unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-lg rounded-card border border-bear/35 bg-bear/[0.07] p-5 text-center">
          <p className="text-sm font-semibold text-bear">خطای غیرمنتظره در رابط کاربری</p>
          <p className="mt-2 text-2xs leading-6 text-ink-muted">
            صفحه به‌درستی اجرا نشد. جزئیات فنی در کنسول مرورگر ثبت شده است. با بارگذاری مجدد، برنامه
            دوباره راه‌اندازی می‌شود.
          </p>
          <p className="ltr-data mt-3 break-words rounded-lg border border-border bg-base-900/60 p-2.5 text-start text-2xs text-ink-subtle">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="nx-btn-primary mt-4"
          >
            بارگذاری مجدد
          </button>
        </div>
      </div>
    );
  }
}
