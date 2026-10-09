import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { cn } from '../../lib/cn';

/* ------------------------------------------------------------------ *
 * Field wrapper
 * ------------------------------------------------------------------ */

export interface FieldProps {
  label: string;
  /** Hint rendered under the control; also used for validation messages. */
  hint?: string;
  /** Renders the hint in the error colour. */
  invalid?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, invalid = false, children, className }: FieldProps): JSX.Element {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="nx-label">
        {label}
      </label>
      {children({ id, ...(hintId ? { 'aria-describedby': hintId } : {}), invalid })}
      {hint ? (
        <p
          id={hintId}
          className={cn('mt-1.5 text-2xs leading-5', invalid ? 'text-bear' : 'text-ink-subtle')}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Text input
 * ------------------------------------------------------------------ */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid = false, className, ...rest }: InputProps): JSX.Element {
  return (
    <input
      className={cn('nx-input', invalid && 'border-bear/60 focus:border-bear', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Select
 * ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
  /** Optional secondary text shown in the option label. */
  hint?: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  invalid?: boolean;
}

export function Select({ options, invalid = false, className, ...rest }: SelectProps): JSX.Element {
  return (
    <select
      className={cn('nx-select', invalid && 'border-bear/60', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.hint ? `${option.label} — ${option.hint}` : option.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ *
 * Toggle
 * ------------------------------------------------------------------ */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledHint?: string;
}

/** A real switch element with correct ARIA semantics. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  disabledHint,
}: ToggleProps): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-2xs leading-5 text-ink-muted">{description}</p>
        ) : null}
        {disabled && disabledHint ? (
          <p className="mt-0.5 text-2xs leading-5 text-warn">{disabledHint}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition',
          checked ? 'border-accent/60 bg-accent/30' : 'border-border-strong bg-base-800',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-[1.125rem] w-[1.125rem] rounded-full transition-all',
            // The knob sits at the inline-start when on, which is the right-hand
            // side in this RTL layout.
            checked ? 'start-0.5 bg-accent' : 'end-0.5 bg-ink-subtle',
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Segmented control
 * ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  ariaLabel: string;
  className?: string;
}

/**
 * A radio group rendered as a segmented control.
 * Uses `radiogroup` semantics so keyboard and screen-reader behaviour is native.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-lg border border-border bg-base-900 p-1',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition',
              selected
                ? 'bg-accent/15 text-accent shadow-sm'
                : 'text-ink-muted hover:bg-base-800 hover:text-ink',
              option.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
