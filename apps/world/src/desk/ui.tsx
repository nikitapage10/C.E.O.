import { Decode } from "./motion.tsx";

/** The Desk's HUD pieces: tracked eyebrows with a rule, hairline panels with corner ticks, decoded titles. */

export function PageHead({ eyebrow, title, lead, aside }: { eyebrow: string; title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <p className="eyebrow">
          <Decode text={eyebrow} delay={120} speed={18} />
          <span className="eyebrow__rule" aria-hidden="true" />
        </p>
        <h1 className="desk__title" aria-label={title}>
          <Decode text={title} speed={70} />
        </h1>
        {lead && <p className="page-head__lead">{lead}</p>}
      </div>
      {aside && <div className="page-head__aside">{aside}</div>}
    </header>
  );
}

export function Panel({
  eyebrow,
  aside,
  className = "",
  children,
  label,
}: {
  eyebrow: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section className={`panel ${className}`} aria-label={label ?? eyebrow}>
      <i className="panel__tick panel__tick--tl" aria-hidden="true" />
      <i className="panel__tick panel__tick--br" aria-hidden="true" />
      <header className="panel__head">
        <h2>{eyebrow}</h2>
        <span className="panel__rule" aria-hidden="true" />
        {aside && <span className="panel__aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}
