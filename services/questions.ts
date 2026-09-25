// =====================================================
// EVERY QUESTION THE APP ASKS, AND WHAT AN UNANSWERED ONE DOES
// =====================================================
// WORKORDER_AM_NO_BROWSER_DIALOGS_2026-09-24, item 1.
//
// The app used to ask six questions with `window.confirm`. A browser that has
// begun ignoring dialogs still HAS `confirm`, and it returns `false` without
// drawing anything, so the answer the code received was one nobody gave. Chrome
// starts doing this on a page that has already shown several dialogs, which is
// exactly an instructor re-importing `.md` files while they author. The export
// path had the same defect and was fixed in Supplement 2 item 4; this is the
// rest of the class.
//
// Every question is now asked in the page (`components/ChoicePanel.tsx`), and
// its answer comes back as a value, or `null` when the panel was closed without
// one. What `null` means is decided here, once per question, by the standing
// guard rule:
//
//   DESTRUCTIVE (the two deletes): fail CLOSED. No answer, nothing deleted.
//     Nothing needs saying, because nothing happened.
//
//   CONSTRUCTIVE (the two import overwrites, the input-mode switch, Reopen):
//     fail VISIBLY. No answer, the action does not happen, AND the instructor
//     is told what did not happen and why, in the page. An import that quietly
//     became a copy, or a switch that quietly did not happen, is the defect.
//
// Pure: no React and no DOM, so the suite can drive every path with no answer.

/** One button in the panel. `value` is what `ask` resolves to when it is pressed. */
export interface ChoiceOption<T> {
  label: string;
  value: T;
  tone?: 'primary' | 'danger' | 'secondary';
}

export interface Question<T> {
  title: string;
  /** Paragraphs, in order. */
  body: string[];
  options: ChoiceOption<T>[];
}

/** Asks in the page. Resolves to the chosen value, or `null` if closed unanswered. */
export type Ask = <T>(question: Question<T>) => Promise<T | null>;

/** What the instructor is told when a constructive question went unanswered. */
export interface UnansweredNotice { title: string; body: string[] }

/** A notice is a question with one button that only closes it. */
export const noticeQuestion = (n: UnansweredNotice): Question<true> =>
  ({ title: n.title, body: n.body, options: [{ label: 'OK', value: true, tone: 'primary' }] });

// ---- The two deletes: destructive, fail closed ------------------------------

export const deleteQuestion = (title: string): Question<boolean> => ({
  title: 'Delete this assignment?',
  body: [`"${title}" will be removed from this browser. This cannot be undone.`,
    'An exported copy you have already downloaded is not affected.'],
  options: [
    { label: 'Keep it', value: false, tone: 'secondary' },
    { label: 'Delete it', value: true, tone: 'danger' },
  ],
});

/** True only when the instructor pressed Delete. Any other outcome deletes nothing. */
export const askDelete = async (ask: Ask, title: string): Promise<boolean> =>
  (await ask(deleteQuestion(title))) === true;

// ---- The two import overwrites: constructive, fail visibly -----------------

export type ImportCollision = 'overwrite' | 'copy';

export const importCollisionQuestion = (name: string): Question<ImportCollision> => ({
  title: 'This assignment already exists',
  body: [`"${name}" is already in this browser.`,
    'Replace it with the file you are importing, or keep both, with the import saved as a separate copy.'],
  options: [
    { label: 'Keep both', value: 'copy', tone: 'secondary' },
    { label: 'Replace the existing one', value: 'overwrite', tone: 'primary' },
  ],
});

/**
 * The instructor's choice, or `null` with the notice to show. `null` means
 * NOTHING is imported: before this change the unanswered case silently saved
 * a copy, so an instructor who meant to replace ended up with two, and did not
 * know which one they were editing.
 */
export const askImportCollision = async (ask: Ask, name: string):
  Promise<{ choice: ImportCollision; notice: null } | { choice: null; notice: UnansweredNotice }> => {
  const choice = await ask(importCollisionQuestion(name));
  if (choice === 'overwrite' || choice === 'copy') return { choice, notice: null };
  return {
    choice: null,
    notice: {
      title: 'Nothing was imported',
      body: [`"${name}" already exists, and the question whether to replace it or keep both was closed without an answer.`,
        'The file was not imported, and the existing assignment is unchanged. Import the file again to choose.'],
    },
  };
};

// ---- The input-mode switch: constructive, fail visibly --------------------

export const modeSwitchQuestion = (
  fromLabel: string, toLabel: string, targetMedium: string, stranded: string[],
): Question<'switch' | 'stay'> => ({
  title: `Switch to ${toLabel}?`,
  body: [
    `${stranded.length} sub-part${stranded.length === 1 ? '' : 's'} will be converted to ${targetMedium}:`,
    ...stranded,
    'Names, descriptions, points, rubrics and grader notes are kept. Image page counts and the previous grading mode are dropped.',
  ],
  options: [
    { label: `Stay ${fromLabel}`, value: 'stay', tone: 'secondary' },
    { label: `Convert and switch to ${toLabel}`, value: 'switch', tone: 'primary' },
  ],
});

export const askModeSwitch = async (
  ask: Ask, fromLabel: string, toLabel: string, targetMedium: string, stranded: string[],
): Promise<{ proceed: boolean; notice: UnansweredNotice | null }> => {
  const choice = await ask(modeSwitchQuestion(fromLabel, toLabel, targetMedium, stranded));
  if (choice === 'switch') return { proceed: true, notice: null };
  if (choice === 'stay') return { proceed: false, notice: null };
  return {
    proceed: false,
    notice: {
      title: `Still ${fromLabel}`,
      body: [`The switch to ${toLabel} was not made, because the question was closed without an answer. Nothing was converted.`,
        'Choose the mode again to switch.'],
    },
  };
};

// ---- Reopen: constructive, fail visibly -----------------------------------

export const reopenQuestion = (warning: string): Question<boolean> => ({
  title: 'Reopen this assignment?',
  body: warning.split(/\n\n+/),
  options: [
    { label: 'Keep it finalized', value: false, tone: 'secondary' },
    { label: 'Reopen', value: true, tone: 'primary' },
  ],
});

export const askReopen = async (ask: Ask, warning: string):
  Promise<{ proceed: boolean; notice: UnansweredNotice | null }> => {
  const choice = await ask(reopenQuestion(warning));
  if (choice === true) return { proceed: true, notice: null };
  if (choice === false) return { proceed: false, notice: null };
  return {
    proceed: false,
    notice: {
      title: 'Still finalized',
      body: ['The assignment was not reopened, because the question was closed without an answer. Nothing changed, and nothing was recorded.',
        'Press Reopen again to reopen it.'],
    },
  };
};
