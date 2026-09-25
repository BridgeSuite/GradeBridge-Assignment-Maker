import React from 'react';
import { FigureFile } from '../types';
import { FigureRef, figureDataUri, figureSvgSource } from '../services/figureRefs';
import { figureLabel, splitFigures } from '../services/figureBlocks';
import { inlineFigureBlocker } from '../services/figureExtract';
import { Input, TextArea } from './Common';
import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import { HelpLink, useOpenHelp } from './HelpGuide';

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
  const openHelp = useOpenHelp();

  return (
    <div className="rounded-lg border border-academic-200 bg-academic-50/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-4 h-4 text-academic-500 shrink-0" />
          <span className="text-sm font-medium text-academic-800">{label}</span>
          <HelpLink section="figures" onOpen={openHelp} label="Help: replacing a figure" />
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
                ? <div className="w-full max-h-36 [&>svg]:w-full [&>svg]:max-h-36 [&>svg]:max-w-full [&>svg]:h-auto"
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

/**
 * A drawing that is still part of the problem text, with its own Replace.
 *
 * Supplement 2, item 6. A `FigureCard` exists only for a ```figure reference
 * block, and every drawing an instructor authors or imports arrives as an
 * inline ```svg fence, which only **Extract figures** turns into a reference
 * and a file. So until extraction had run there was no card and nothing to
 * replace, and nothing in the page said so: an instructor had to know the
 * order. This card is shown for every inline drawing instead, and choosing a
 * file runs the extraction for this one drawing on the spot, then replaces it.
 * There is no order to get wrong.
 *
 * A drawing that cannot become a file says why here, before anyone tries, and
 * what would fix it. Extraction changes nothing students see.
 */
export const InlineFigureCard: React.FC<{
  figureNumber: number;
  problemNumber: number;
  /** The drawing's own `<title>`, or the image's alt text. */
  title: string;
  /** The SVG to show as the thumbnail, or null for an image. */
  svg: string | null;
  /** The image source, for an image rather than a drawing. */
  imageUrl?: string;
  /** Why it cannot be replaced from here, or null when it can. */
  blocker: string | null;
  onReplace: (file: File) => void;
}> = ({ figureNumber, problemNumber, title, svg, imageUrl, blocker, onReplace }) => {
  const label = `Figure ${figureNumber} in Problem ${problemNumber}`;
  const openHelp = useOpenHelp();

  return (
    <div className="rounded-lg border border-academic-200 bg-academic-50/60 p-3 sm:p-4" data-inline-figure-card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-4 h-4 text-academic-500 shrink-0" />
          <span className="text-sm font-medium text-academic-800">{label}</span>
          <HelpLink section="figures" onOpen={openHelp} label="Help: replacing a figure" />
          {title && <span className="text-xs text-academic-500 truncate">{title}</span>}
        </div>
        {!blocker && (
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
        )}
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-4">
        <div className="sm:w-48 shrink-0">
          <div className="rounded border border-academic-200 bg-white p-2 flex items-center
                          justify-center min-h-[6rem] max-h-40 overflow-hidden">
            {svg
              ? <div className="w-full max-h-36 [&>svg]:w-full [&>svg]:max-h-36 [&>svg]:max-w-full [&>svg]:h-auto"
                     dangerouslySetInnerHTML={{ __html: svg }} />
              : imageUrl
                ? <img src={imageUrl} alt={title} className="max-h-36 max-w-full object-contain" />
                : <span className="text-xs text-academic-400">No preview</span>}
          </div>
        </div>
        <div className="flex-1 min-w-0 text-xs text-academic-600 leading-relaxed">
          {blocker ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              This figure cannot be replaced from here because {blocker}.
              {svg && ' Add a <title> and a <desc> to the drawing in the problem text above, and the Replace button appears.'}
            </p>
          ) : (
            <p>
              This drawing is part of the problem text. <strong>Replace image</strong> turns it into
              a file first and then swaps it, which changes nothing students see. Its title and
              description can be edited once it has been replaced.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * One `InlineFigureCard` for every drawing still inline in a problem's text,
 * numbered after the problem's figure files (`refCount`). A component rather
 * than a block inside the Editor so the suite can render it with real problem
 * text: the Editor loads its assignment after mounting, which a server render
 * never reaches.
 */
export const InlineFigureCards: React.FC<{
  problemNumber: number;
  description: string;
  refCount: number;
  onReplace: (figureIndex: number, label: string, file: File) => void;
}> = ({ problemNumber, description, refCount, onReplace }) => {
  const inline = splitFigures(description || '')
    .filter((s): s is Extract<ReturnType<typeof splitFigures>[number], { kind: 'figure' }> => s.kind === 'figure');
  if (!inline.length) return null;
  return (
    <div className="mt-3 space-y-3">
      {inline.map((seg, fIndex) => {
        const figureNumber = refCount + fIndex + 1;
        const label = `Figure ${figureNumber} in Problem ${problemNumber}`;
        return (
          <InlineFigureCard
            key={`inline-${fIndex}`}
            figureNumber={figureNumber}
            problemNumber={problemNumber}
            title={figureLabel(seg.figure)}
            svg={seg.figure.form === 'svg' ? seg.figure.svg : null}
            imageUrl={seg.figure.form === 'svg' ? undefined : seg.figure.url}
            blocker={inlineFigureBlocker(seg)}
            onReplace={f => onReplace(fIndex, label, f)}
          />
        );
      })}
    </div>
  );
};
