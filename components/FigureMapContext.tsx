import React from 'react';
import { FigureMap } from '../types';

/**
 * The figure files the surrounding assignment refers to, so that ANY rendered
 * stem resolves its ```figure blocks without its caller having to remember.
 *
 * WHY A CONTEXT AND NOT A PROP
 *
 * `WORKORDER_AM_FIGURES_AND_FINALIZE_2026-09-21` §3.2 required every surface
 * that renders a stem to resolve first. Every export path did. **Every on-screen
 * path did not**, and the result was that after Extract figures the drawings
 * vanished from the editor and the Preview page while the exports stayed
 * correct — so the app showed the instructor something no student would ever
 * receive. Andre found it the first time he used the deployed build.
 *
 * Threading a `figures` prop through `FormattedText`, `TextAreaWithPreview`,
 * `InputWithPreview`, the Editor and the Preview page would fix those five call
 * sites and leave the sixth one, added later by someone who did not know the
 * rule, broken in exactly the same way. That is the defect this repeats, not
 * the one it fixes.
 *
 * So the map is ambient. A surface that renders an assignment wraps itself
 * once; everything inside resolves, including components that do not know
 * figures exist.
 *
 * **An empty map is the honest default.** Outside a provider,
 * `resolveFigureRefsInText` leaves a block exactly as it is rather than
 * throwing — a figure block rendered as text is visibly wrong, which is what
 * you want from a surface someone forgot to wrap, and it is what the test in
 * `tests/figure-render-tests.mjs` mutates to prove the resolve is load-bearing.
 */
export const FigureMapContext = React.createContext<FigureMap | undefined>(undefined);

/** Wrap a surface that renders an assignment's text. */
export const FigureMapProvider: React.FC<{ figures?: FigureMap; children: React.ReactNode }> =
  ({ figures, children }) => (
    <FigureMapContext.Provider value={figures}>{children}</FigureMapContext.Provider>
  );

export const useFigureMap = (): FigureMap | undefined => React.useContext(FigureMapContext);
