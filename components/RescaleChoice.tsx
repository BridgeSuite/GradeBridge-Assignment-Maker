import React from 'react';
import { Assignment } from '../types';
import { RescaleNotice, rescaleNotice } from '../services/exportService';

/**
 * The rescale question, asked IN THE PAGE before an export runs.
 *
 * WORKORDER_AM_GENERIC_ANSWER_PAGE_2026-09-24_SUPPLEMENT_2, item 4. The export
 * used to ask with `window.confirm`, and a browser that has started ignoring
 * dialogs answers `false` without showing anything, so the export stopped and
 * the instructor saw nothing. Exporting is a constructive action, and a
 * refusal nobody can see has no recourse; under the standing guard rule it
 * must fail open, and it cannot fail open by guessing, because nothing may
 * change marks without a person deciding. So the question is part of the page,
 * where nothing outside the page can answer it, which is the same move that
 * settled the download in the Student Submission app.
 *
 * Every button that exports goes through `withRescaleChoice`. When the totals
 * already agree, it runs the export straight away and shows nothing.
 */
export const RescaleChoicePanel: React.FC<{
  notice: RescaleNotice;
  onRescale: () => void;
  onCancel: () => void;
}> = ({ notice, onRescale, onCancel }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="rescale-choice-heading"
  >
    <div className="bg-white w-full max-w-lg rounded-lg shadow-xl p-5 sm:p-6">
      <h2 id="rescale-choice-heading" className="text-lg font-bold font-serif text-academic-900">
        Rescale the points before exporting?
      </h2>
      <p className="mt-3 text-sm text-academic-700 leading-relaxed">
        This assignment totals <strong>{notice.authoredTotal} points</strong>. The export target
        is <strong>{notice.targetPoints}</strong>. Exporting at that target changes the points of
        every part.
      </p>
      <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-academic-300 bg-white px-4 py-2 text-sm font-medium
                     text-academic-700 hover:bg-academic-50"
        >
          Cancel, and set the Target box to {notice.authoredTotal}
        </button>
        <button
          type="button"
          onClick={onRescale}
          className="rounded-md bg-academic-800 px-4 py-2 text-sm font-semibold text-white
                     hover:bg-academic-900"
        >
          Rescale to {notice.targetPoints} and export
        </button>
      </div>
      <p className="mt-3 text-xs text-academic-500">
        Cancel writes nothing. Nothing is exported until you choose.
      </p>
    </div>
  </div>
);

/**
 * `withRescaleChoice(assignment, run)` runs `run(undefined)` at once when no
 * rescale is needed, and otherwise shows the panel and runs `run(true)` only
 * when the instructor chooses to rescale. `panel` must be rendered by the page.
 */
export const useRescaleChoice = () => {
  const [pending, setPending] = React.useState<{
    notice: RescaleNotice;
    run: (rescale: boolean | undefined) => unknown;
  } | null>(null);

  const withRescaleChoice = React.useCallback(
    (assignment: Assignment, run: (rescale: boolean | undefined) => unknown) => {
      const notice = rescaleNotice(assignment);
      if (!notice) { void run(undefined); return; }
      setPending({ notice, run });
    }, []);

  const panel = pending ? (
    <RescaleChoicePanel
      notice={pending.notice}
      onRescale={() => { const { run } = pending; setPending(null); void run(true); }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { withRescaleChoice, panel };
};
