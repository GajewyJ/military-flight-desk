import React from 'react';

/** Joins class names, skipping empty ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Black label-tape strip for the title of a sheet. */
export const Tape: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={cx('cond inline-block bg-ink text-on-ink text-[11px] font-bold px-2 py-0.5 rounded-sm', className)}>
    {children}
  </span>
);

interface BlockProps {
  label: string;
  /** Short note at the right of the label line. */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * One ruled box of a form or sheet: a small label in the top-left corner and the content under
 * it. In the flight plan form the boxes are numbered automatically (see .numbered in index.css).
 */
export const Block: React.FC<BlockProps> = ({ label, hint, children, className }) => (
  <section className={cx('px-2 pt-1.5 pb-2 border-b border-rule last:border-b-0', className)}>
    <div className="cond flex items-baseline justify-between gap-2 text-[10px] text-ink-3 mb-1">
      <span className="bx-num">{label}</span>
      {hint && <span className="font-mono normal-case tracking-normal truncate">{hint}</span>}
    </div>
    {children}
  </section>
);

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** Value shown after the label (such as "2 passes"). */
  sub?: string;
  disabled?: boolean;
  title?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (id: T) => void;
  options: Array<SegmentOption<T>>;
  ariaLabel: string;
  disabled?: boolean;
  /** 'col' stacks the choices. */
  layout?: 'row' | 'col';
}

/** Paper-form choices: a square box with an X marks the selected one. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  layout = 'row',
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('flex', layout === 'col' ? 'flex-col' : 'flex-row flex-wrap gap-x-4 gap-y-1')}
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        const off = disabled || opt.disabled;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={off}
            title={opt.title}
            onClick={() => onChange(opt.id)}
            className={cx(
              'flex items-center gap-2 py-0.5 text-left',
              off ? 'cursor-not-allowed text-ink-3' : 'cursor-pointer hover:text-accent'
            )}
          >
            <span
              className={cx(
                'w-[15px] h-[15px] shrink-0 border-[1.5px] bg-inset flex items-center justify-center text-[13px] font-bold leading-none',
                off ? 'border-ink-3' : 'border-ink'
              )}
            >
              {selected ? 'X' : ''}
            </span>
            <span className="font-semibold">{opt.label}</span>
            {opt.sub && <span className="font-mono text-[11px] text-ink-3">{opt.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One label / value row of a data block. */
export const DataRow: React.FC<{ label: string; children: React.ReactNode; tone?: 'warn' | 'alert' | 'ok' }> = ({
  label,
  children,
  tone,
}) => (
  <div className="flex items-baseline gap-2 py-0.5 border-b border-dotted border-rule last:border-b-0">
    <span className="cond w-20 shrink-0 text-[10px] text-ink-3">{label}</span>
    <span
      className={cx(
        'min-w-0 font-mono text-[12px] font-bold',
        tone === 'warn' && 'text-warn',
        tone === 'alert' && 'text-alert',
        tone === 'ok' && 'text-ok'
      )}
    >
      {children}
    </span>
  </div>
);
