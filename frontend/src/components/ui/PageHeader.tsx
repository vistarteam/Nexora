import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Buttons or filters rendered at the inline-end. */
  actions?: ReactNode;
  /** Badges rendered under the title. */
  badges?: ReactNode;
}

/** Shared page header so every screen has the same rhythm and hierarchy. */
export function PageHeader({ title, description, actions, badges }: PageHeaderProps): JSX.Element {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-ink sm:text-xl">{title}</h1>
          {badges}
        </div>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-xs leading-6 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
