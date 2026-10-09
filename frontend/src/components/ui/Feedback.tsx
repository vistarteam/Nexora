import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from './Button';

/** Inline spinner with an optional label. */
export function Spinner({ label, className }: { label?: string; className?: string }): JSX.Element {
  return (
    <div role="status" className={cn('flex items-center gap-2 text-xs text-ink-muted', className)}>
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-accent/70 border-t-transparent"
      />
      {label ? <span>{label}</span> : <span className="sr-only">در حال بارگذاری</span>}
    </div>
  );
}

/** Grey placeholder block, used to keep layout stable while loading. */
export function Skeleton({
  className,
  lines = 1,
}: {
  className?: string;
  lines?: number;
}): JSX.Element {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn('nx-skeleton h-3.5', index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** A block of skeleton rows sized for a table. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }): JSX.Element {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div key={columnIndex} className="nx-skeleton h-3.5" />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 py-10 text-center', className)}>
      {icon ? <div className="mb-3 text-ink-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-2xs leading-6 text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  error: ApiError | Error | null;
  /** Retry handler; the button only renders when provided. */
  onRetry?: () => void;
  title?: string;
  className?: string;
}

/**
 * Error state.
 *
 * Renders the message the API actually returned (those are written for users),
 * plus the error code for support conversations. Field-level validation issues
 * are listed so the user can fix the input rather than guess.
 */
export function ErrorState({ error, onRetry, title, className }: ErrorStateProps): JSX.Element {
  const apiError = error instanceof ApiError ? error : null;
  const message = error?.message ?? 'خطای نامشخصی رخ داد.';

  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-bear/35 bg-bear/[0.07] px-4 py-4 text-start',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-bear/50 text-2xs text-bear"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-bear">{title ?? 'دریافت اطلاعات ناموفق بود'}</p>
          <p className="mt-1 text-2xs leading-6 text-ink-muted">{message}</p>

          {apiError && apiError.details.length > 0 ? (
            <ul className="mt-2 space-y-1 text-2xs text-ink-muted">
              {apiError.details.slice(0, 6).map((issue) => (
                <li key={`${issue.path}-${issue.message}`} className="flex gap-1.5">
                  <span aria-hidden="true">•</span>
                  <span className="ltr-data">{issue.path}</span>
                  <span>—</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {apiError && apiError.code ? (
            <p className="mt-2 text-2xs text-ink-subtle">
              کد خطا: <span className="ltr-data">{apiError.code}</span>
            </p>
          ) : null}

          {apiError?.isNetworkError ? (
            <p className="mt-2 text-2xs leading-6 text-ink-subtle">
              مطمئن شوید بک‌اند روی پورت ۴۰۰۰ در حال اجراست
              (<span className="ltr-data">npm run dev:backend</span>).
            </p>
          ) : null}

          {onRetry ? (
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                تلاش مجدد
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Standard loading / error / empty / content switch.
 * Centralising the order of these checks keeps every page consistent.
 */
export function AsyncBoundary({
  loading,
  error,
  isEmpty,
  emptyState,
  onRetry,
  children,
  loadingState,
}: {
  loading: boolean;
  error: ApiError | Error | null;
  isEmpty?: boolean;
  emptyState?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
  loadingState?: ReactNode;
}): JSX.Element {
  if (loading && !error) return <>{loadingState ?? <Skeleton lines={4} />}</>;
  if (error) return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
  if (isEmpty && emptyState) return <>{emptyState}</>;
  return <>{children}</>;
}
