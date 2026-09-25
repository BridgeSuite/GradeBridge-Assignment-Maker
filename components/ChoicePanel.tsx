import React from 'react';
import { X } from 'lucide-react';
import { Ask, Question, UnansweredNotice, noticeQuestion } from '../services/questions';

/**
 * A question asked in the page, never by a browser dialog.
 *
 * WORKORDER_AM_NO_BROWSER_DIALOGS_2026-09-24, item 1. `window.confirm` can be
 * suppressed by the browser, and a suppressed one answers `false` without
 * showing anything, which is an answer nobody gave. Nothing outside the page
 * can answer this panel. Its buttons say what they do, so nobody has to map OK
 * and Cancel onto the message.
 *
 * Closing it without choosing (the X, or Escape) answers `null`. What `null`
 * means is decided per question in `services/questions.ts`.
 */
export const ChoicePanel: React.FC<{
  question: Question<unknown>;
  onAnswer: (value: unknown) => void;
  onDismiss: () => void;
}> = ({ question, onAnswer, onDismiss }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const tone = (t?: string) =>
      t === 'danger' ? 'bg-red-600 text-white hover:bg-red-700 border-red-600'
    : t === 'primary' ? 'bg-academic-800 text-white hover:bg-academic-900 border-academic-800'
    : 'bg-white text-academic-700 hover:bg-academic-50 border-academic-300';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="choice-panel-heading"
      data-choice-panel
    >
      <div className="bg-white w-full max-w-lg max-h-full overflow-y-auto rounded-lg shadow-xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="choice-panel-heading" className="text-lg font-bold font-serif text-academic-900">
            {question.title}
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close without choosing"
            title="Close without choosing"
            className="rounded p-1 text-academic-500 hover:bg-academic-100 hover:text-academic-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-3 space-y-2 text-sm text-academic-700 leading-relaxed">
          {question.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {question.options.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAnswer(o.value)}
              className={`rounded-md border px-4 py-2 text-sm font-semibold ${tone(o.tone)}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * `ask(question)` shows the panel and resolves to the chosen value, or `null`
 * when it is closed without one. `tell(notice)` shows a notice with one OK
 * button. `panel` must be rendered by the page.
 */
export const useChoice = () => {
  const [question, setQuestion] = React.useState<Question<unknown> | null>(null);
  // The pending resolver, in a ref rather than state: resolving a promise is a
  // side effect, and a state updater may run twice.
  const resolver = React.useRef<((value: unknown) => void) | null>(null);

  const ask = React.useCallback(
    ((q: Question<unknown>) => new Promise(resolve => {
      // A question already open is answered `null` before the new one replaces
      // it, so no caller is left waiting forever.
      resolver.current?.(null);
      resolver.current = resolve as (value: unknown) => void;
      setQuestion(q);
    })) as Ask, []);

  const tell = React.useCallback(
    (notice: UnansweredNotice) => ask(noticeQuestion(notice)).then(() => undefined), [ask]);

  const answer = React.useCallback((value: unknown) => {
    const resolve = resolver.current;
    resolver.current = null;
    setQuestion(null);
    resolve?.(value);
  }, []);

  const panel = question ? (
    <ChoicePanel question={question} onAnswer={answer} onDismiss={() => answer(null)} />
  ) : null;

  return { ask, tell, panel };
};
