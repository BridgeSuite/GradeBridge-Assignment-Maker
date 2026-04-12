import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { FormattedText } from './FormattedText';
import { LaTeXCheatsheet } from './LaTeXCheatsheet';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }> = ({ variant = 'primary', className = '', ...props }) => {
  const baseStyle = "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors";
  const variants = {
    primary: "bg-academic-800 text-white hover:bg-academic-900 focus:ring-academic-700",
    secondary: "bg-white text-academic-700 border border-academic-300 hover:bg-academic-50 focus:ring-academic-500",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
    ghost: "text-academic-600 hover:text-academic-900 hover:bg-academic-100 shadow-none"
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
  <div className={`bg-white shadow rounded-lg p-6 border border-academic-200 ${className}`}>
    {children}
  </div>
);

export const Layout: React.FC<{ children: React.ReactNode; title?: string; action?: React.ReactNode }> = ({ children, title, action }) => {
  const [showLatexHelp, setShowLatexHelp] = useState(false);

  return (
    <div className="min-h-screen bg-academic-50 flex flex-col">
      <header className="bg-white border-b border-academic-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3">
              <div className="flex flex-col">
                <h1 className="text-lg font-bold text-academic-900">Veri<span className="text-[#00A4E4]">Q</span>Ai</h1>
                <span className="text-xs text-academic-500">Assignment Manager</span>
              </div>
            </Link>
            {/* LaTeX Help Button */}
            <button
              onClick={() => setShowLatexHelp(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-academic-600 hover:text-academic-900 hover:bg-academic-100 rounded-md transition-colors"
              title="LaTeX Math Help"
            >
              <HelpCircle className="w-4 h-4" />
              <span>LaTeX Help</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile LaTeX Help Button */}
            <button
              onClick={() => setShowLatexHelp(true)}
              className="sm:hidden p-2 text-academic-600 hover:text-academic-900 hover:bg-academic-100 rounded-md transition-colors"
              title="LaTeX Math Help"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            {action && <div>{action}</div>}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {title && <h2 className="text-2xl font-bold text-academic-900 mb-6 font-serif">{title}</h2>}
        {children}
      </main>
      <footer className="bg-academic-800 text-academic-300 py-8 border-t border-academic-700">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm">
          <p>&copy; {new Date().getFullYear()} GradeBridge AI. Client-side Assignment Management.</p>
        </div>
      </footer>

      {/* LaTeX Cheatsheet Modal */}
      <LaTeXCheatsheet isOpen={showLatexHelp} onClose={() => setShowLatexHelp(false)} />
    </div>
  );
};

// TextArea with LaTeX Preview
export const TextAreaWithPreview: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }> = ({ label, className = '', value, ...props }) => {
  const textVal = (value || '') as string;
  const hasLatex = textVal.includes('$') || textVal.includes('\\');
  const showPreview = textVal.trim().length > 0 && hasLatex;

  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-academic-700 mb-1">{label}</label>}
      <textarea className={`w-full bg-white text-academic-900 rounded-md border-academic-300 shadow-sm focus:border-academic-500 focus:ring-academic-500 sm:text-sm py-2 px-3 border resize-y ${className}`} value={value} {...props} />
      {showPreview && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-xs text-blue-600 mb-1 font-bold uppercase">LaTeX Preview:</p>
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
        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-xs text-blue-600 mb-1 font-bold uppercase">LaTeX Preview:</p>
          <div className="prose prose-sm max-w-none">
            <FormattedText text={textVal} />
          </div>
        </div>
      )}
    </div>
  );
};
