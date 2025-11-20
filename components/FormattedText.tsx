
import React from 'react';

export const FormattedText: React.FC<{ text: string, className?: string }> = ({ text, className = '' }) => {
  if (!text) return null;

  // Split text by $$...$$ (block) and $...$ (inline) delimiters
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g);

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {parts.map((part, index) => {
        // Block Math
        if (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) {
          const math = part.slice(2, -2);
          try {
            if (typeof window !== 'undefined' && (window as any).katex) {
              const html = (window as any).katex.renderToString(math, {
                throwOnError: false,
                displayMode: true,
                output: 'html'
              });
              return <div key={index} className="block my-4 text-center" dangerouslySetInnerHTML={{ __html: html }} />;
            }
          } catch (e) {
            return <span key={index} className="text-red-500">{part}</span>;
          }
        }
        // Inline Math
        else if (part.startsWith('$') && part.endsWith('$') && part.length >= 2) {
          const math = part.slice(1, -1);
          try {
            if (typeof window !== 'undefined' && (window as any).katex) {
              const html = (window as any).katex.renderToString(math, {
                throwOnError: false,
                displayMode: false,
                output: 'html'
              });
              return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
            }
          } catch (e) {
            return <span key={index} className="text-red-500">{part}</span>;
          }
        }
        // Plain Text
        return <span key={index}>{part}</span>;
      })}
    </div>
  );
};
