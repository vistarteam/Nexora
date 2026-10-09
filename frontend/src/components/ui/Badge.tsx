import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { ANALYSIS_STATUS_LABELS, DATA_MODE_LABELS } from '../../lib/format';
import type { AnalysisStatus, DataMode } from '../../types/nexora';

export type BadgeTone = 'neutral' | 'accent' | 'bull' | 'bear' | 'warn' | 'info' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-border-strong bg-base-800 text-ink-muted',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  bull: 'border-bull/40 bg-bull/10 text-bull',
  bear: 'border-bear/40 bg-bear/10 text-bear',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  info: 'border-info/40 bg-info/10 text-info',
  danger: 'border-bear/50 bg-bear/15 text-bear',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  /** A small leading dot, useful for status pills. */
  dot?: boolean;
  title?: string;
}

export function Badge({ children, tone = 'neutral', className, dot = false, title }: BadgeProps): JSX.Element {
  return (
    <span className={cn('nx-chip', TONE_CLASSES[tone], className)} title={title}>
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/**
 * The DEMO marker.
 *
 * Every surface that can display synthetic data must show this. Making it a
 * component (rather than an ad-hoc span) means the wording and treatment stay
 * identical everywhere and are impossible to forget silently.
 */
export function DemoBadge({ label = 'دمو' }: { label?: string }): JSX.Element {
  return (
    <Badge
      tone="warn"
      dot
      title="داده‌های این بخش ساختگی و تولیدی هستند و قیمت واقعی بازار نیستند."
    >
      {label}
    </Badge>
  );
}

export function DataModeBadge({ mode }: { mode: DataMode }): JSX.Element {
  if (mode === 'demo') return <DemoBadge />;
  if (mode === 'live') return <Badge tone="bull" dot>{DATA_MODE_LABELS.live}</Badge>;
  return <Badge tone="neutral">{DATA_MODE_LABELS.none}</Badge>;
}

const STATUS_TONES: Record<AnalysisStatus, BadgeTone> = {
  ok: 'accent',
  insufficient_data: 'warn',
  unavailable: 'danger',
};

export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }): JSX.Element {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {ANALYSIS_STATUS_LABELS[status]}
    </Badge>
  );
}
