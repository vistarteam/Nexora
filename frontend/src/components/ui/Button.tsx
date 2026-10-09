import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
  /** Rendered before the label. */
  icon?: ReactNode;
  /** Replaces the label while `loading` is true. */
  loadingLabel?: string;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'nx-btn-primary',
  secondary: 'nx-btn-secondary',
  ghost: 'nx-btn-ghost',
  danger: 'nx-btn-danger',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: '',
};

/**
 * The single button primitive.
 *
 * `loading` and `disabled` are wired to the native attribute so a button can
 * never appear clickable while its handler is running.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  loadingLabel,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(VARIANT_CLASSES[variant], SIZE_CLASSES[size], fullWidth && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span>{loadingLabel ?? children}</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
