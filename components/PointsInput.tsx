import React from 'react';
import { parsePoints, POINTS_ACCEPTED } from '../services/pointsService';

/**
 * A points field that never stores a number other than the one typed.
 *
 * It replaced `<Input type="number">` read through `parseInt`, which turned
 * `0.5` into 0 as it was typed: the decimal point and the digit after it were
 * discarded, the total fell by half a point, and nothing on screen said so
 * (EEC130A HW1, 2026-09-27).
 *
 * What is typed is kept as text. When it parses to a value on the 0.25 grid it
 * is committed; when it does not, the field turns red, names what is accepted,
 * and NOTHING is stored: the assignment keeps its previous value until the
 * field holds a valid one. A half-typed `2.` is shown as in progress, not
 * stored as 2. Leaving the field while it is invalid puts back the stored
 * value, so what is on screen and what is saved never disagree after focus
 * moves on.
 *
 * `positive` refuses 0, for the Target box.
 */
export const PointsInput: React.FC<{
  value: number;
  onCommit: (n: number) => void;
  positive?: boolean;
  className?: string;
  title?: string;
  placeholder?: string;
  'aria-label'?: string;
}> = ({ value, onCommit, positive, className = '', title, placeholder, ...rest }) => {
  const [text, setText] = React.useState(String(value));
  const [focused, setFocused] = React.useState(false);

  // An outside change (Rescale, import, a type pill) replaces the text, unless
  // the author is mid-edit in this very field.
  React.useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);

  const parsed = parsePoints(text);
  const error = parsed === null
    ? POINTS_ACCEPTED
    : positive && parsed <= 0 ? 'The target must be more than 0.' : null;

  return (
    <span className="relative inline-block w-full">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        title={error ?? title}
        placeholder={placeholder}
        aria-label={rest['aria-label'] ?? title}
        aria-invalid={error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (error) setText(String(value)); }}
        onChange={e => {
          const t = e.target.value;
          setText(t);
          const n = parsePoints(t);
          if (n !== null && !(positive && n <= 0) && n !== value) onCommit(n);
        }}
        className={`w-full bg-white text-academic-900 rounded-md shadow-sm sm:text-sm py-2 px-3 border ${
          error ? 'border-red-600 ring-2 ring-red-500 bg-red-50 text-red-800 focus:border-red-600 focus:ring-red-500 focus:outline-none' :'border-academic-300 focus:border-academic-500 focus:ring-academic-500'
        } ${className}`}
      />
      {error && (
        <span role="alert" className="absolute right-0 top-full mt-1 z-20 w-56 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 shadow">
          Not saved. {error}
        </span>
      )}
    </span>
  );
};
