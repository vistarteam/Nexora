import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from './Feedback';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the value. */
  hint?: ReactNode;
  /** Small element rendered at the inline-end of the header. */
  trailing?: ReactNode;
  /** Tailwind text colour class for the value, e.g. `text-bull`. */
  tone?: string;
  loading?: boolean;
  className?: string;
}

/**
 * A single metric tile.
 *
 * Values are rendered verbatim so the caller controls formatting — this keeps
 * the component free of locale assumptions.
 */
export function StatCard({
  label,
  value,
  hint,
  trailing,
  tone = 'text-ink',
  loading = false,
  className,
}: StatCardProps): JSX.Element {
  return (
    <div className={cn('nx-card nx-card-body', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-medium text-ink-muted">{label}</p>
        {trailing}
      </div>
      {loading ? (
        <Skeleton className="mt-2" lines={1} />
      ) : (
        <p className={cn('num mt-1.5 text-lg font-semibold tracking-tight', tone)}>{value}</p>
      )}
      {hint ? <div className="mt-1 text-2xs text-ink-subtle">{hint}</div> : null}
    </div>
  );
}
