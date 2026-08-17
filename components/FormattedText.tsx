
import React from 'react';
import { splitMath, renderTex, splitFigures, trimAroundFigures, figureToHtml } from '../services/mathRender';

/**
 * The app preview. It calls the same splitter and the same KaTeX renderer the
 * HTML, grader-document and PDF exports use (services/mathRender.ts), so what
 * the instructor sees here is what every export produces.
 *
 * Figures come out of the text first (services/figureBlocks.ts), before the
 * math splitter and before any escaping — an SVG that reached `splitMath` would
 * be shredded by a stray `$` in its path data, and nothing downstream would
 * notice. `useId()` gives each figure its own id namespace, so the same drawing
 * on two problems cannot capture the other's markers and gradients.
 */
export const FormattedText: React.FC<{ text: string, className?: string }> = ({ text, className = '' }) => {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  if (!text) return null;

  let figureIndex = 0;
  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {trimAroundFigures(splitFigures(text)).map((seg, index) => {
        if (seg.kind === 'figure') {
          const html = figureToHtml(seg.figure, `f${uid}-${figureIndex++}-`);
          return <div key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        }

        return splitMath(seg.value).map((m, mIndex) => {
          const key = `${index}-${mIndex}`;
          if (m.kind === 'text') return <span key={key}>{m.value}</span>;

          const html = renderTex(m.tex, m.kind === 'display');
          return m.kind === 'display'
            ? <div key={key} className="block my-4 text-center" dangerouslySetInnerHTML={{ __html: html }} />
            : <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
        });
      })}
    </div>
  );
};
