
import React from 'react';
import { splitMath, renderTex } from '../services/mathRender';

/**
 * The app preview. It calls the same splitter and the same KaTeX renderer the
 * HTML, grader-document and PDF exports use (services/mathRender.ts), so what
 * the instructor sees here is what every export produces.
 */
export const FormattedText: React.FC<{ text: string, className?: string }> = ({ text, className = '' }) => {
  if (!text) return null;

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {splitMath(text).map((seg, index) => {
        if (seg.kind === 'text') return <span key={index}>{seg.value}</span>;

        const html = renderTex(seg.tex, seg.kind === 'display');
        return seg.kind === 'display'
          ? <div key={index} className="block my-4 text-center" dangerouslySetInnerHTML={{ __html: html }} />
          : <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
};
