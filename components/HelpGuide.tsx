import React from 'react';
import guideSource from '../docs/INSTRUCTOR_GUIDE.md?raw';
import { X } from 'lucide-react';
import { LaTeXCheatsheet } from './LaTeXCheatsheet';

/**
 * The instructor guide, inside the app.
 *
 * **Bundled, not fetched.** `?raw` inlines the Markdown at build time, so the
 * guide opens with the network off — which is the state an instructor is in
 * often enough to matter, and the reason not to serve it from a URL. It is also
 * why there is exactly one copy: the file in `docs/` is the guide, the README
 * points at it, and there is nowhere for a second version to drift.
 *
 * Until now the only written instructions were `README.md` on GitHub — a
 * developer's file, which said nothing about figures, the finalize lock or the
 * assignment kind. **An instructor should never need GitHub to learn how to use
 * the tool** (Andre, 2026-09-22).
 *
 * The renderer below is deliberately small. This is one known document, not
 * arbitrary Markdown from a user, so it handles exactly what the guide uses and
 * escapes everything before it touches any markup.
 */

/** Section ids the `?` links open the guide at. Kept with the headings they match. */
export const GUIDE_SECTIONS = {
  start: 'Getting started',
  kind: 'Two things to choose first',
  grading: 'Who decides the grades',
  figures: 'Figures',
  finalize: 'Finalize and Reopen',
  exports: 'What you get when you export',
  donts: 'What not to do',
  latex: 'Writing mathematics',
} as const;

export type GuideSection = keyof typeof GUIDE_SECTIONS;

export const slugFor = (heading: string): string =>
  heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `**bold**`, `*italic*` and `` `code` ``, applied after escaping. */
const inline = (text: string): string =>
  escape(text)
    .replace(/`([^`]+)`/g, '<code class="font-mono text-[0.9em] bg-academic-100 px-1 py-0.5 rounded">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-academic-900">$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

const renderGuide = (md: string): string => {
  const out: string[] = [];
  const lines = md.split('\n');
  let list: string[] = [];
  let table: string[][] = [];

  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul class="list-disc pl-6 space-y-1.5 my-3">${list.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...body] = table;
    out.push(
      '<div class="overflow-x-auto my-4"><table class="text-sm border-collapse">'
      + `<thead><tr>${head.map(c => `<th class="border border-academic-200 bg-academic-50 px-3 py-1.5 text-left font-semibold">${inline(c)}</th>`).join('')}</tr></thead>`
      + `<tbody>${body.map(r => `<tr>${r.map(c => `<td class="border border-academic-200 px-3 py-1.5 align-top">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      + '</table></div>');
    table = [];
  };

  for (const line of lines) {
    const t = line.trim();

    if (/^\|/.test(t)) {
      const cells = t.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      // The `|---|---|` separator row carries no content.
      if (!cells.every(c => /^:?-+:?$/.test(c))) table.push(cells);
      continue;
    }
    flushTable();

    if (/^- /.test(t)) { list.push(t.slice(2)); continue; }
    flushList();

    if (t === '---' || t === '') continue;

    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = slugFor(text);
      const size = level === 1 ? 'text-2xl mt-2' : level === 2 ? 'text-xl mt-8' : 'text-base mt-6';
      out.push(`<h${level} id="${id}" class="${size} font-bold font-serif text-academic-900 mb-2 scroll-mt-24">${inline(text)}</h${level}>`);
      continue;
    }

    out.push(`<p class="my-2.5 leading-relaxed">${inline(t)}</p>`);
  }
  flushList();
  flushTable();
  return out.join('');
};

const HTML = renderGuide(guideSource);

/**
 * The guide as a panel over the page, optionally scrolled to a section.
 *
 * A panel rather than a route, so that opening help never costs an instructor
 * the edit they were in the middle of.
 */
export const HelpGuide: React.FC<{
  isOpen: boolean;
  section?: GuideSection;
  onClose: () => void;
  /**
   * Opens the full LaTeX symbol reference.
   *
   * The guide's own mathematics section covers what an instructor writing a
   * question actually needs. The cheatsheet behind this button is a few hundred
   * symbols, which is a reference rather than a guide — worth keeping, not
   * worth putting in front of someone looking up how to write a subscript.
   */
  onOpenLatexReference?: () => void;
}> = ({ isOpen, section, onClose, onOpenLatexReference }) => {
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const id = section ? slugFor(GUIDE_SECTIONS[section]) : null;
    // Next frame: the panel has to exist before anything in it can be found.
    const t = window.setTimeout(() => {
      const body = bodyRef.current;
      if (!body) return;
      if (!id) { body.scrollTop = 0; return; }
      const target = body.querySelector(`#${CSS.escape(id)}`);
      if (target instanceof HTMLElement) body.scrollTop = target.offsetTop - 12;
      else body.scrollTop = 0;
    }, 0);
    return () => window.clearTimeout(t);
  }, [isOpen, section]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Using the Assignment Maker"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl max-h-full rounded-lg shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-academic-200 px-4 sm:px-6 py-3">
          <h2 className="text-base sm:text-lg font-bold font-serif text-academic-900">
            Using the Assignment Maker
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="rounded p-1.5 text-academic-500 hover:bg-academic-100 hover:text-academic-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-4 sm:px-6 py-4 text-sm text-academic-700">
          <div dangerouslySetInnerHTML={{ __html: HTML }} />
          {onOpenLatexReference && (
            <div className="mt-6 border-t border-academic-200 pt-4">
              <button
                type="button"
                onClick={onOpenLatexReference}
                className="rounded-md border border-academic-300 bg-white px-3 py-2 text-xs
                           font-semibold text-academic-700 hover:border-academic-500"
              >
                Full list of mathematical symbols
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Holds the open/closed state for the guide and supplies `useOpenHelp`.
 *
 * **At the app root, not inside `Layout`.** A page renders `Layout` as its
 * child, so a provider inside `Layout` sits BELOW the page in the tree and the
 * page's own `useOpenHelp()` reads the default no-op — which is exactly what
 * happened to the `?` links in the Editor's header before this moved. Help is
 * reachable from everywhere, so it is provided from above everything.
 */
export const HelpContext = React.createContext<(section?: GuideSection) => void>(() => {});
export const useOpenHelp = () => React.useContext(HelpContext);

export const HelpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [section, setSection] = React.useState<GuideSection | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const [latexOpen, setLatexOpen] = React.useState(false);
  const openHelp = React.useCallback((s?: GuideSection) => { setSection(s); setOpen(true); }, []);

  return (
    <HelpContext.Provider value={openHelp}>
      {children}
      <HelpGuide
        isOpen={open}
        section={section}
        onClose={() => setOpen(false)}
        onOpenLatexReference={() => { setOpen(false); setLatexOpen(true); }}
      />
      <LaTeXCheatsheet isOpen={latexOpen} onClose={() => setLatexOpen(false)} />
    </HelpContext.Provider>
  );
};

/** The small `?` beside a control, opening the guide where that control is explained. */
export const HelpLink: React.FC<{ section: GuideSection; onOpen: (s: GuideSection) => void; label?: string }> =
  ({ section, onOpen, label }) => (
    <button
      type="button"
      onClick={() => onOpen(section)}
      aria-label={label ?? `Help: ${GUIDE_SECTIONS[section]}`}
      title={label ?? `Help: ${GUIDE_SECTIONS[section]}`}
      className="inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-full border
                 border-academic-300 text-[11px] font-semibold text-academic-600
                 hover:border-academic-500 hover:text-academic-900"
    >
      ?
    </button>
  );
