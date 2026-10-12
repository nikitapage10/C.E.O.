/** The Desk's shared pieces: a page head (date line, title, lead) and a titled section with a rule under its heading. */

export function PageHead({ eyebrow, title, lead, aside }: { eyebrow: string; title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head__text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="desk__title">{title}</h1>
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
      <header className="panel__head">
        <h2>{eyebrow}</h2>
        {aside && <span className="panel__aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}
