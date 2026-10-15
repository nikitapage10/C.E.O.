import { useEffect, useRef, useState } from "react";
import type { Picture } from "../foundry.ts";

/**
 * A shipped change's pictures on the Changelog (docs/FOUNDRY.md, "Pictures on every change"): a small thumbnail of the
 * first, with "+N" when there are more, that opens a viewer to page through them all. Every link has already passed
 * `pictureUrl` (foundry.ts), so only the `foundry-shots` branch of this repo is ever loaded.
 */
export function ChangePictures({ pictures, title }: { pictures: Picture[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const first = pictures[0];
  if (!first) return null;
  const more = pictures.length - 1;
  return (
    <>
      <button type="button" className="cl-shot" onClick={() => setOpen(0)} aria-haspopup="dialog" aria-label={pictures.length === 1 ? `See the picture of “${title}”` : `See ${pictures.length} pictures of “${title}”`}>
        {failed ? <PictureGlyph /> : <img src={first.src} alt="" width={96} height={60} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
        {more > 0 && (
          <span className="cl-shot__more" aria-hidden="true">
            +{more}
          </span>
        )}
      </button>
      {open !== null && <PictureViewer pictures={pictures} title={title} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Stands in for a picture GitHub couldn't serve, so no broken-image icon shows. */
function PictureGlyph() {
  return (
    <svg className="cl-shot__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="m6.5 15.5 4-4 3 3 2-2 2.5 3" />
      <circle cx="15.5" cy="9.5" r="1.2" />
    </svg>
  );
}

/** The viewer: a modal dialog in the Desk's glass. Arrows or the buttons page through; Esc, a click outside or Close shut it. */
function PictureViewer({ pictures, title, start, onClose }: { pictures: Picture[]; title: string; start: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(start);
  const [broken, setBroken] = useState<string[]>([]);
  const n = pictures.length;
  const pic = pictures[at] ?? pictures[0]!;
  const step = (by: number) => setAt((i) => (i + by + n) % n);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="pic-viewer"
      aria-labelledby="pic-viewer-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the dialog itself, not its panel, is a click on the backdrop outside it.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      onKeyDown={(e) => {
        if (n < 2) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
        }
      }}
    >
      <div className="pic-viewer__panel">
        <header className="pic-viewer__head">
          <h2 id="pic-viewer-title" className="pic-viewer__title">
            {title}
          </h2>
          <button type="button" className="pic-viewer__close" onClick={() => ref.current?.close()} aria-label="Close the pictures">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="m3 3 6 6M9 3 3 9" />
            </svg>
          </button>
        </header>
        <figure className="pic-viewer__figure">
          <div className="pic-viewer__frame">
            {broken.includes(pic.src) ? (
              <p className="pic-viewer__missing">
                <PictureGlyph />
                This picture didn’t load from GitHub.
              </p>
            ) : (
              <img key={pic.src} src={pic.src} alt={pic.alt} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken((b) => [...b, pic.src])} />
            )}
          </div>
          <figcaption className="pic-viewer__caption">
            <span className="pic-viewer__alt">{pic.alt}</span>
            {pic.note && <span className="pic-viewer__note">{pic.note}</span>}
          </figcaption>
        </figure>
        <footer className="pic-viewer__foot">
          {n > 1 ? (
            <>
              <button type="button" className="btn pic-viewer__nav" onClick={() => step(-1)} aria-label="Previous picture">
                ← Prev
              </button>
              <span className="pic-viewer__count" aria-live="polite">
                {at + 1} of {n}
              </span>
              <button type="button" className="btn pic-viewer__nav" onClick={() => step(1)} aria-label="Next picture">
                Next →
              </button>
            </>
          ) : (
            <span className="pic-viewer__count">1 picture</span>
          )}
          <a className="pic-viewer__full" href={pic.src} target="_blank" rel="noreferrer">
            Full size ↗
          </a>
        </footer>
      </div>
    </dialog>
  );
}
