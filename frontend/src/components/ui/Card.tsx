import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds the accent rail used to mark status-bearing panels. */
  rail?: boolean;
}

export function Card({ children, className, rail = false }: CardProps): JSX.Element {
  return <section className={cn('nx-card', rail && 'nx-rail', className)}>{children}</section>;
}

export interface CardHeaderProps {
  title: string;
  description?: string;
  /** Rendered at the opposite edge (badges, actions). */
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps): JSX.Element {
  return (
    <header className={cn('nx-card-header', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-2xs leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('nx-card-body', className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <footer className={cn('border-t border-border px-4 py-3 sm:px-5', className)}>{children}</footer>
  );
}
