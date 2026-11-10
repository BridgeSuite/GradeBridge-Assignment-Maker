import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpCircle, Home } from 'lucide-react';
import { FormattedText } from './FormattedText';
import { hasFigure } from '../services/figureBlocks';
import { useOpenHelp } from './HelpGuide';
import { hasFigureRef } from '../services/figureRefs';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent' }> = ({ variant = 'primary', className = '', ...props }) => {
  // ucdavis.edu buttons: 5px corners, bold. Navy (its btn--alt) is the
  // ordinary action; gold (its btn--primary) is the one that finishes the job.
  const baseStyle = "inline-flex items-center justify-center px-4 py-2 text-sm font-bold rounded-[5px] focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors";
  const variants = {
    primary: "bg-academic-800 text-white hover:bg-academic-900 focus:ring-academic-700",
    secondary: "bg-white text-academic-700 border border-academic-300 hover:bg-academic-50 focus:ring-academic-500",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
    ghost: "text-academic-600 hover:text-academic-900 hover:bg-academic-100 shadow-none",
    // Aggie Gold, for the one action that finishes the job on a screen.
    accent: "bg-gold-500 text-academic-800 hover:bg-gold-400 focus:ring-gold-500"
  };

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props} />
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="w-full">
    {label && <label className="block text-sm font-medium text-academic-700 mb-1">{label}</label>}
    <input className={`w-full bg-white text-academic-900 rounded-md border-academic-300 shadow-sm focus:border-academic-500 focus:ring-academic-500 sm:text-sm py-2 px-3 border ${className}`} {...props} />
  </div>
);

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="w-full">
    {label && <label className="block text-sm font-medium text-academic-700 mb-1">{label}</label>}
    <textarea className={`w-full bg-white text-academic-900 rounded-md border-academic-300 shadow-sm focus:border-academic-500 focus:ring-academic-500 sm:text-sm py-2 px-3 border ${className}`} {...props} />
  </div>
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }> = ({ label, className = '', children, ...props }) => (
  <div className="w-full">
    {label && <label className="block text-sm font-medium text-academic-700 mb-1">{label}</label>}
    <select className={`w-full bg-white text-academic-900 rounded-md border-academic-300 shadow-sm focus:border-academic-500 focus:ring-academic-500 sm:text-sm py-2 px-3 border ${className}`} {...props}>
      {children}
    </select>
  </div>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white shadow-sm rounded-xl p-6 border border-academic-200 ${className}`}>
    {children}
  </div>
);

/**
 * What the home screen is called: its own heading, and the label of every
 * control that goes back to it, so the control names a destination and not a
 * direction. The home screen is where the final deliverable is exported.
 */
export const HOME_SCREEN_NAME = 'Assignment Dashboard';

export const Layout: React.FC<{ children: React.ReactNode; title?: string; action?: React.ReactNode }> = ({ children, title, action }) => {
  // The panel and its state live at the app root (`HelpProvider`), so every
  // page gets the same one and a page's own `?` links work as well as the
  // header's. The header just asks for it to open.
  const openHelp = useOpenHelp();
  // THE WAY HOME, LABELLED (Supplement 2, item 5). The wordmark below has
  // always linked to `/`, but with no label and nothing saying it navigates,
  // so an instructor who did not already know was stranded on the editor,
  // where "Cancel" is the only other road home and does not read as "go to
  // where I export". Shown on every screen except the home screen itself.
  const atHome = useLocation().pathname === '/';

  return (
    <div className="min-h-screen bg-academic-50 flex flex-col">
      <header className="bg-aggie-500 text-white shadow sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3" title={`Go to the ${HOME_SCREEN_NAME}`}>
              <div className="flex flex-col">
                <h1 className="text-lg font-extrabold text-gold-500">BridgeSuite</h1>
                <span className="text-xs text-white/80">Assignment Manager</span>
              </div>
            </Link>
            {/* ONE PLACE TO LOOK. This was "LaTeX Help", which is the only
                thing the app ever offered an instructor and covers the
                smallest of their questions. LaTeX is now a section of the
                guide rather than the whole of the help. */}
            <button
              onClick={() => openHelp()}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15 rounded-[5px] transition-colors"
              title="How to use the Assignment Maker"
            >
              <HelpCircle className="w-4 h-4" />
              <span>Help</span>
            </button>
            {!atHome && (
              <Link
                to="/"
                data-home-link
                aria-label={`Go to the ${HOME_SCREEN_NAME}`}
                title={`Go to the ${HOME_SCREEN_NAME}, where assignments are exported`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white whitespace-nowrap
                           bg-academic-800 rounded-[5px] hover:bg-academic-900
                           transition-colors"
              >
                <Home className="w-4 h-4" />
                <span>{HOME_SCREEN_NAME}</span>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* The same button on a narrow window, where the label will not fit. */}
            <button
              onClick={() => openHelp()}
              className="sm:hidden p-2 text-white hover:bg-white/15 rounded-[5px] transition-colors"
              title="How to use the Assignment Maker"
              aria-label="Help"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            {action && <div>{action}</div>}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {title && (
          <div className="mb-6">
            <h2 className="text-3xl font-extrabold text-aggie-500">{title}</h2>
            <div className="mt-2 flex gap-1.5" aria-hidden="true">
              {[0, 1, 2, 3, 4].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-gold-500" />)}
            </div>
          </div>
        )}
        {children}
      </main>
      <footer className="bg-academic-700 text-white/80 py-8">
        {/* ATTRIBUTION, on every screen (WORKORDER_ATTRIBUTION_AND_THIRD_PARTY_NOTICES_2026-09-27).
            It used to read "© {current year} GradeBridge AI", which named the
            wrong copyright holder with a year that changed by itself; the
            Regents line sat only inside the privacy notice, under "Disclaimer". */}
        <div className="max-w-7xl mx-auto px-4 text-center text-sm" data-attribution>
          <p>
            Copyright &copy; 2026 The Regents of the University of California. Made available under the MIT License.
            {' '}
            <Link to="/notices" className="underline underline-offset-2 hover:text-white" data-notices-link>Notices</Link>
          </p>
        </div>
      </footer>

    </div>
  );
};

// TextArea with LaTeX Preview
export const TextAreaWithPreview: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }> = ({ label, className = '', value, ...props }) => {
  const textVal = (value || '') as string;
  // A figure block carries neither a `$` nor a backslash, so it needs asking
  // for by name — otherwise a stem that is nothing but a circuit shows no preview.
  // A figure block carries neither a `$` nor a backslash, and it is not a
  // figure as far as `figureBlocks.ts` is concerned either, so both have to be
  // asked — otherwise a stem that is nothing but a referenced circuit shows no
  // preview at all.
  const hasLatex = textVal.includes('$') || textVal.includes('\\')
    || hasFigure(textVal) || hasFigureRef(textVal);
  const showPreview = textVal.trim().length > 0 && hasLatex;

  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-academic-700 mb-1">{label}</label>}
      <textarea className={`w-full bg-white text-academic-900 rounded-md border-academic-300 shadow-sm focus:border-academic-500 focus:ring-academic-500 sm:text-sm py-2 px-3 border resize-y ${className}`} value={value} {...props} />
      {showPreview && (
        <div className="mt-1.5 pl-3 pr-2 py-1 border-l-2 border-gold-500 text-academic-900" data-latex-preview>
          <span className="sr-only">Preview: </span>
          <div className="prose prose-sm max-w-none">
            <FormattedText text={textVal} />
          </div>
        </div>
      )}
    </div>
  );
};

// Input with LaTeX Preview
export const InputWithPreview: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, className = '', value, ...props }) => {
  const textVal = (value || '') as string;
  const showPreview = textVal && (textVal.includes('$') || textVal.includes('\\'));

  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-academic-700 mb-1">{label}</label>}
      <input className={`w-full bg-white text-academic-900 rounded-md border-academic-300 shadow-sm focus:border-academic-500 focus:ring-academic-500 sm:text-sm py-2 px-3 border ${className}`} value={value} {...props} />
      {showPreview && (
        <div className="mt-1.5 pl-3 pr-2 py-1 border-l-2 border-gold-500 text-academic-900" data-latex-preview>
          <span className="sr-only">Preview: </span>
          <div className="prose prose-sm max-w-none">
            <FormattedText text={textVal} />
          </div>
        </div>
      )}
    </div>
  );
};
