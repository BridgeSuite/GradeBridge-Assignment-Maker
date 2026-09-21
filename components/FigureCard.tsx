import React from 'react';
import { FigureFile } from '../types';
import { FigureRef, figureDataUri, figureSvgSource } from '../services/figureRefs';
import { Input, TextArea } from './Common';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';

/**
 * A refused upload, waiting on the instructor.
 *
 * `convertible` is what turns the panel from a plain refusal into an offer.
 */
export interface FigureRefusal {
  messages: string[];
  convertible: boolean;
}

/**
 * One figure's controls, shown INSIDE the problem the figure belongs to.
 *
 * They used to live in a Figures panel up in the settings area, a long way from
 * the question the drawing appears in, and the Replace control was a small
 * text-style label. Andre had to hunt for it the first time he used the app.
 * Controls for a thing belong next to the thing.
 *
 * The thumbnail is the part that matters most: it is how an instructor knows
 * which drawing they are about to replace, and — after a replace or a
 * conversion — how they see what they got before deciding they are happy with
 * it.
 */
export const FigureCard: React.FC<{
  figureNumber: number;
  problemNumber: number;
  refBlock: FigureRef;
  file?: FigureFile;
  refusal?: FigureRefusal;
  busy?: boolean;
  onReplace: (file: File) => void;
  onConvert: () => void;
  onDismissRefusal: () => void;
  onTitleChange: (value: string) => void;
  onDescChange: (value: string) => void;
}> = ({ figureNumber, problemNumber, refBlock, file, refusal, busy,
        onReplace, onConvert, onDismissRefusal, onTitleChange, onDescChange }) => {
  const label = `Figure ${figureNumber} in Problem ${problemNumber}`;

  return (
    <div className="rounded-lg border border-academic-200 bg-academic-50/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-4 h-4 text-academic-500 shrink-0" />
          <span className="text-sm font-medium text-academic-800">{label}</span>
          {file && (
            <span className="text-xs text-academic-500 font-mono truncate">{file.filename}</span>
          )}
        </div>

        {/* A real button rather than a text link. Replacing a drawing is the
            action this card exists for, and it should look like one. */}
        <label className="inline-flex items-center gap-1.5 shrink-0 cursor-pointer rounded-md
                          bg-academic-700 px-3 py-2 text-xs font-semibold text-white
                          hover:bg-academic-800 focus-within:ring-2 focus-within:ring-academic-500">
          <RefreshCw className="w-3.5 h-3.5" />
          Replace image
          <input
            type="file"
            accept=".svg,.png,.jpg,.jpeg"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onReplace(f);
            }}
          />
        </label>
      </div>

      {/* THE REFUSAL, IN THE CARD, WITH REAL BUTTONS.
          It was `window.confirm`, with the two choices spelled out inside the
          message as "OK — convert it" and "Cancel — leave it". Andre found
          that kind of pop-up hard to follow: the browser's box labels its
          buttons OK and Cancel whatever the message says they mean, so the
          instructor has to hold the mapping in their head. Buttons that say
          what they do need no mapping. */}
      {refusal && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          {refusal.messages.map((m, i) => (
            <p key={i} className="text-sm text-amber-900 leading-relaxed">{m}</p>
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            {refusal.convertible && (
              <button
                type="button"
                disabled={busy}
                onClick={onConvert}
                className="rounded-md bg-academic-700 px-3 py-2 text-xs font-semibold text-white
                           hover:bg-academic-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? 'Converting…' : 'Convert to greyscale'}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onDismissRefusal}
              className="rounded-md border border-academic-300 bg-white px-3 py-2 text-xs
                         font-semibold text-academic-700 hover:border-academic-500
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stacks on a narrow window; side by side once there is room. */}
      <div className="mt-3 flex flex-col sm:flex-row gap-4">
        <div className="sm:w-48 shrink-0">
          <div className="rounded border border-academic-200 bg-white p-2 flex items-center
                          justify-center min-h-[6rem] max-h-40 overflow-hidden">
            {file ? (
              file.format === 'svg'
                ? <div className="max-h-36 [&>svg]:max-h-36 [&>svg]:max-w-full [&>svg]:h-auto"
                       dangerouslySetInnerHTML={{ __html: figureSvgSource(file) }} />
                : <img src={figureDataUri(file)} alt={refBlock.title}
                       className="max-h-36 max-w-full object-contain" />
            ) : (
              <span className="text-xs text-academic-400 text-center px-2">
                No image file for this figure yet
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <Input label="Title" value={refBlock.title} onChange={e => onTitleChange(e.target.value)} />
          <TextArea
            label="Description (used when the drawing can't be shown)"
            rows={2}
            value={refBlock.desc}
            onChange={e => onDescChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};
