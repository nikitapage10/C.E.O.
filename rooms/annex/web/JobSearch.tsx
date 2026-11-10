import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useNow } from "@ceo/engine/sigils/motion.tsx";
import { useAnnex } from "../data/annex.ts";
import { careerMove, jobsGrowth, k, since, useJobs, type Job, type JobsProfile, type JobsView, type JobState } from "../data/jobs.ts";
import "./jobs.css";

/**
 * The Job search (#1000), the Annex's second pop-up, in its pane of glass over the Glasshouse: Google Jobs through
 * SerpApi, searched each morning (and on a tap) for the saved searches, merged and ranked against the profile and the
 * resume with plain rules. Not a plain list: the day's best match blooms at the top in a gold ring, the pipeline
 * (new, saved, applied) runs as a lit line, every listed pay range is plotted against the floor, and the companies on
 * the list light up when they have an opening. Every job is SerpApi's, as the last run read it; nothing is made up.
 * Private: a passkey session only, nothing kept on the device.
 */

type Tab = "matches" | "saved" | "applied" | "dismissed" | "setup";
const TABS: { id: Tab; label: string }[] = [
  { id: "matches", label: "Matches" },
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "dismissed", label: "Dismissed" },
  { id: "setup", label: "Search setup" },
];
const LIST_STEP = 24;

function pay(j: Job): string | null {
  if (j.payMin !== null && j.payMax !== null) return j.payMin === j.payMax ? k(j.payMin) : `${k(j.payMin)}–${k(j.payMax)}`;
  return j.salary;
}

/** A gold ring, filled to `value` of 100, with its number in the middle. */
function Ring({ value, size, stroke = 6, label, children }: { value: number; size: number; stroke?: number; label: string; children?: ReactNode }) {
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="jb-ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff1c9" />
            <stop offset="0.55" stopColor="#e3c27a" />
            <stop offset="1" stopColor="#b8873a" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} />
        <circle
          className="jb-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="jb-ring-in">{children}</span>
    </span>
  );
}

/** The company's logo on a small glass tile, or its first letter when there is none (or it won't load). */
function Logo({ job, size = 40 }: { job: Job; size?: number }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="jb-logo" style={{ width: size, height: size }} aria-hidden="true">
      {job.logo && !bad ? <img src={job.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : <b>{job.company.slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}

function Actions({ job, onMark, busy }: { job: Job; onMark: (s: JobState) => void; busy: boolean }) {
  return (
    <div className="jb-acts">
      {job.state !== "saved" && job.state !== "applied" && (
        <button type="button" className="jb-btn" disabled={busy} onClick={() => onMark("saved")}>
          Save
        </button>
      )}
      {job.state !== "applied" && (
        <button type="button" className="jb-btn jb-btn--go" disabled={busy} onClick={() => onMark("applied")}>
          Applied
        </button>
      )}
      {job.state !== "dismissed" ? (
        <button type="button" className="jb-btn jb-btn--quiet" disabled={busy} onClick={() => onMark("dismissed")}>
          Dismiss
        </button>
      ) : (
        <button type="button" className="jb-btn jb-btn--quiet" disabled={busy} onClick={() => onMark("new")}>
          Restore
        </button>
      )}
    </div>
  );
}

/** Whether the job moves the career forward: a bar for the company's standing, the role's level and the pay. */
function CareerBar({ job, profile }: { job: Job; profile: JobsProfile }) {
  const c = careerMove(job, profile);
  const parts = [c.standing, c.level, ...(c.pay ? [c.pay] : [])];
  return (
    <div className={`jb-career is-${c.verdict}`} title={parts.map((p) => `${p.word} (${p.n})`).join(" · ")}>
      <span className="jb-career-w">{c.word}</span>
      <span className="jb-career-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.value} aria-label={`Career move: ${c.word}, ${c.value} of 100`}>
        <i style={{ width: `${c.value}%` }} />
      </span>
      <span className="jb-career-parts">
        {parts.map((p) => (
          <span key={p.word} className={p.n >= 70 ? "is-hi" : p.n < 45 ? "is-lo" : ""}>
            {p.word}
          </span>
        ))}
      </span>
    </div>
  );
}

function Facts({ job }: { job: Job }) {
  const p = pay(job);
  return (
    <p className="jb-facts">
      {p && <span className="jb-pay">{p}</span>}
      {job.yearsAsked ? <span className="jb-yrs">{job.yearsAsked}+ yrs</span> : null}
      {job.remote && <span className="jb-pill">Remote</span>}
      {job.posted && <span>{job.posted}</span>}
      {job.via && <span>via {job.via}</span>}
    </p>
  );
}

function JobCard({ job, profile, onMark, busy, i }: { job: Job; profile: JobsProfile; onMark: (s: JobState) => void; busy: boolean; i: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`jb-job is-${job.state}${job.hidden ? " is-hidden" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
      <div className="jb-job-top">
        <Logo job={job} />
        <div className="jb-job-head">
          <h3 className="jb-title">
            {job.link ? (
              <a href={job.link} target="_blank" rel="noreferrer noopener">
                {job.title}
              </a>
            ) : (
              job.title
            )}
          </h3>
          <p className="jb-co">
            <b>{job.company}</b>
            {job.location && <span> · {job.location}</span>}
          </p>
          {job.state !== "new" && <span className={`jb-tag jb-tag--${job.state}`}>{job.state === "saved" ? "Saved" : job.state === "applied" ? "Applied" : "Dismissed"}</span>}
        </div>
        <Ring value={job.score} size={52} stroke={4} label={`Match ${job.score} of 100`}>
          <b>{job.score}</b>
        </Ring>
      </div>
      <CareerBar job={job} profile={profile} />
      <Facts job={job} />
      {(job.why.length > 0 || job.hidden) && (
        <p className="jb-why">
          {job.hidden ? <span className="jb-hid">Hidden: {job.hidden}</span> : null}
          {job.why.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </p>
      )}
      {open && (
        <div className="jb-more">
          {job.highlights.length > 0 && (
            <ul>
              {job.highlights.map((h, n) => (
                <li key={n}>{h}</li>
              ))}
            </ul>
          )}
          {job.snippet && <p>{job.snippet}…</p>}
          {job.apply.length > 0 && (
            <p className="jb-apply">
              Apply on{" "}
              {job.apply.map((a, n) => (
                <span key={a.link}>
                  {n > 0 && ", "}
                  <a href={a.link} target="_blank" rel="noreferrer noopener">
                    {a.title}
                  </a>
                </span>
              ))}
            </p>
          )}
          <p className="jb-found">
            Found by “{job.search}” · first seen {new Date(job.firstSeen).toLocaleDateString()}
          </p>
        </div>
      )}
      <div className="jb-job-foot">
        <button type="button" className="jb-btn jb-btn--quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Less" : "Details"}
        </button>
        <Actions job={job} onMark={onMark} busy={busy} />
      </div>
    </li>
  );
}

/** The day's best match, in full, with its ring large. */
function Bloom({ job, profile, onMark, busy }: { job: Job | undefined; profile: JobsProfile; onMark: (s: JobState) => void; busy: boolean }) {
  if (!job)
    return (
      <section className="jb-glass jb-bloom is-empty" aria-label="Best match">
        <p className="jb-k">Best match</p>
        <p className="jb-note">Nothing new to rank yet. The next search will fill this in.</p>
      </section>
    );
  return (
    <section className="jb-glass jb-bloom" aria-label="Best match">
      <Ring value={job.score} size={132} stroke={9} label={`Best match, ${job.score} of 100`}>
        <b className="jb-bloom-n">{job.score}</b>
        <small>match</small>
      </Ring>
      <div className="jb-bloom-body">
        <p className="jb-k jb-bloom-k">
          <Logo job={job} size={28} /> Best match
        </p>
        <h3 className="jb-bloom-t">
          {job.link ? (
            <a href={job.link} target="_blank" rel="noreferrer noopener">
              {job.title}
            </a>
          ) : (
            job.title
          )}
        </h3>
        <p className="jb-co">
          <b>{job.company}</b>
          {job.location && <span> · {job.location}</span>}
        </p>
        <CareerBar job={job} profile={profile} />
        <Facts job={job} />
        {job.why.length > 0 && (
          <p className="jb-why">
            {job.why.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </p>
        )}
        <Actions job={job} onMark={onMark} busy={busy} />
      </div>
    </section>
  );
}

/** New, saved, applied: three lit nodes on one line, the line running toward Applied. */
function Pipeline({ n, s, a, d }: { n: number; s: number; a: number; d: number }) {
  const stages = [
    { k: "New", v: n },
    { k: "Saved", v: s },
    { k: "Applied", v: a },
  ];
  return (
    <section className="jb-glass jb-pipe" aria-label="Pipeline">
      <p className="jb-k">Pipeline</p>
      <ol className="jb-pipe-line">
        {stages.map((x, i) => (
          <li key={x.k} className={x.v ? "is-on" : ""} style={{ ["--i" as string]: i }}>
            <i aria-hidden="true" />
            <b>{x.v}</b>
            <span>{x.k}</span>
          </li>
        ))}
      </ol>
      <p className="jb-note">{d ? `${d} dismissed` : " "}</p>
    </section>
  );
}

/** Every listed pay range as a line on one scale, the floor a gold rule across them. */
function PayMap({ jobs, floor }: { jobs: Job[]; floor: number | null }) {
  const withPay = jobs.filter((j) => j.payMin !== null && j.payMax !== null).slice(0, 40);
  const none = jobs.length - withPay.length;
  if (!withPay.length)
    return (
      <section className="jb-glass jb-paymap" aria-label="Pay ranges">
        <p className="jb-k">Pay ranges</p>
        <p className="jb-note">No listed pay yet{none ? ` (${none} without pay listed)` : ""}.</p>
      </section>
    );
  const STEP = 25_000;
  const lo = Math.floor((Math.min(floor ?? Infinity, ...withPay.map((j) => j.payMin!)) * 0.95) / STEP) * STEP;
  const hi = Math.ceil((Math.max(floor ?? 0, ...withPay.map((j) => j.payMax!)) * 1.02) / STEP) * STEP;
  const W = 600;
  const row = 9;
  const H = withPay.length * row + 26;
  const x = (v: number) => 8 + ((v - lo) / (hi - lo)) * (W - 16);
  const sorted = [...withPay].sort((a, b) => b.payMax! - a.payMax!);
  const every = Math.max(1, Math.ceil((hi - lo) / STEP / 6)) * STEP;
  const ticks = Array.from({ length: Math.floor((hi - lo) / every) + 1 }, (_, i) => lo + i * every);
  return (
    <section className="jb-glass jb-paymap" aria-label="Pay ranges">
      <p className="jb-k">
        Pay ranges{" "}
        <span>
          {withPay.length} listed{none ? ` · ${none} without` : ""}
        </span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="jb-paysvg" role="img" aria-label={`Pay ranges of ${withPay.length} jobs${floor ? `, floor ${k(floor)}` : ""}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={H - 16} className="jb-pay-grid" />
            <text x={x(t)} y={H - 3} className="jb-pay-tick" textAnchor="middle">
              {k(t)}
            </text>
          </g>
        ))}
        {sorted.map((j, i) => (
          <g key={j.id} className={`jb-pay-row is-${j.state}${floor && j.payMax! < floor ? " is-under" : ""}`}>
            <title>{`${j.title} · ${j.company} · ${pay(j)}`}</title>
            <line x1={x(j.payMin!)} x2={Math.max(x(j.payMax!), x(j.payMin!) + 2)} y1={i * row + 6} y2={i * row + 6} />
            <circle cx={x(j.payMax!)} cy={i * row + 6} r={2.4} />
          </g>
        ))}
        {floor ? <line x1={x(floor)} x2={x(floor)} y1={0} y2={H - 16} className="jb-pay-floor" /> : null}
      </svg>
      {floor ? <p className="jb-note">Gold rule: your floor, {k(floor)}. Listed pay is usually base only.</p> : null}
    </section>
  );
}

/** The companies on the list, lit by how many of their openings are in the results. */
function Constellation({ companies, jobs }: { companies: string[]; jobs: Job[] }) {
  if (!companies.length) return null;
  const count = (c: string) => jobs.filter((j) => j.company.toLowerCase().includes(c.toLowerCase()) && j.state !== "dismissed").length;
  const list = companies.map((c) => ({ c, n: count(c) })).sort((a, b) => b.n - a.n);
  return (
    <section className="jb-glass jb-stars" aria-label="Your companies">
      <p className="jb-k">
        Your companies <span>{list.filter((x) => x.n).length} hiring in your results</span>
      </p>
      <ul>
        {list.map(({ c, n }) => (
          <li key={c} className={n ? "is-lit" : ""}>
            <i aria-hidden="true" />
            {/^[a-z\s]+$/.test(c) ? c.replace(/\b\w/g, (m) => m.toUpperCase()) : c}
            {n ? <b>{n}</b> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** This month's searches as a ring, with the next run and Search now. */
function Budget({ view, busy, onRun, now }: { view: JobsView; busy: boolean; onRun: () => void; now: number }) {
  const saved = view.profile.searches.length;
  const perRun = Math.min(7, saved);
  const left = view.budget - view.used;
  const last = view.runs[0];
  return (
    <section className="jb-glass jb-budget" aria-label="Searches">
      <Ring value={view.budget ? (view.used / view.budget) * 100 : 0} size={88} stroke={6} label={`${view.used} of ${view.budget} searches used this month`}>
        <b>{view.used}</b>
        <small>of {view.budget}</small>
      </Ring>
      <div>
        <p className="jb-k">Searches this month</p>
        <p className="jb-note">
          {view.account?.left != null ? `SerpApi plan: ${view.account.left} left. ` : ""}
          {view.nextRun ? `Next run ${new Date(view.nextRun).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}, ${perRun} of ${saved}.` : "The daily run is off."}
        </p>
        <p className="jb-note">
          {!view.configured
            ? "SerpApi's key isn't set yet."
            : last
              ? `Last searched ${since(now - Date.parse(last.at))}: ${last.added} new of ${last.found}${last.error ? ` · ${last.error}` : ""}.`
              : "Not searched yet."}
        </p>
        <button type="button" className="jb-btn jb-btn--go" disabled={busy || !view.configured || !perRun || left < perRun} onClick={onRun} title={`Uses ${perRun} of this month's searches`}>
          {busy ? "Searching…" : "Search now"}
        </button>
      </div>
    </section>
  );
}

const joinWords = (w: string[]) => w.join(", ");
const splitWords = (s: string) =>
  s
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);

function Setup({ profile, hasResume, busy, onSave, onResume }: { profile: JobsProfile; hasResume: boolean; busy: boolean; onSave: (p: JobsProfile) => void; onResume: (t: string) => void }) {
  const [searches, setSearches] = useState(profile.searches.length ? profile.searches : [{ q: "", location: "", remote: false }]);
  const [floor, setFloor] = useState(profile.minSalary ? String(profile.minSalary) : "");
  const [prefer, setPrefer] = useState(joinWords(profile.prefer));
  const [avoid, setAvoid] = useState(joinWords(profile.avoid));
  const [companies, setCompanies] = useState(joinWords(profile.companies));
  const [near, setNear] = useState(joinWords(profile.near));
  const [big, setBig] = useState(joinWords(profile.big));
  const [rising, setRising] = useState(joinWords(profile.rising));
  const [daily, setDaily] = useState(profile.daily);
  const [years, setYears] = useState(profile.years ? String(profile.years) : "");
  const [applied, setApplied] = useState(profile.applied.map((a) => `${a.company}: ${a.title}`).join("\n"));
  const [resume, setResume] = useState("");
  const edit = (i: number, patch: Partial<(typeof searches)[number]>) => setSearches((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const save = () =>
    onSave({
      searches: searches.filter((s) => s.q.trim()),
      minSalary: floor ? Number(floor.replace(/[^\d]/g, "")) || null : null,
      prefer: splitWords(prefer),
      avoid: splitWords(avoid),
      companies: splitWords(companies),
      near: splitWords(near),
      big: splitWords(big),
      rising: splitWords(rising),
      daily,
      years: Number(years) || null,
      applied: applied.split("\n").flatMap((l) => {
        const at = l.indexOf(":");
        return at > 0 ? [{ company: l.slice(0, at).trim(), title: l.slice(at + 1).trim() }] : [];
      }),
    });

  return (
    <div className="jb-setup">
      <section className="jb-card">
        <h3 className="jb-h3">Searches</h3>
        <p className="jb-note">
          Up to 16 searches. Each run does 7 of them in turn (one SerpApi search each), so a longer list comes round every few days. Leave the place empty to search anywhere; tick Remote for
          work-from-home only.
        </p>
        <ol className="jb-searches">
          {searches.map((s, i) => (
            <li key={i}>
              <input
                className="jb-in"
                value={s.q}
                onChange={(e) => edit(i, { q: e.target.value })}
                placeholder="Job title, e.g. Technical Program Manager"
                aria-label={`Search ${i + 1}: what`}
                maxLength={120}
              />
              <input
                className="jb-in"
                value={s.location}
                onChange={(e) => edit(i, { location: e.target.value })}
                placeholder="Place, e.g. Denver, Colorado"
                aria-label={`Search ${i + 1}: where`}
                maxLength={120}
              />
              <label className="jb-check">
                <input type="checkbox" checked={s.remote} onChange={(e) => edit(i, { remote: e.target.checked })} /> Remote
              </label>
              <button type="button" className="jb-btn jb-btn--quiet" onClick={() => setSearches((x) => x.filter((_, n) => n !== i))} aria-label={`Remove search ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        {searches.length < 16 && (
          <button type="button" className="jb-btn" onClick={() => setSearches((x) => [...x, { q: "", location: "", remote: false }])}>
            Add a search
          </button>
        )}
      </section>
      <section className="jb-card jb-grid2">
        <label className="jb-field">
          <span>Pay floor, a year</span>
          <input className="jb-in" inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="e.g. 180000" />
          <small>Hides jobs whose listed pay tops out below it. Jobs with no pay listed still show.</small>
        </label>
        <label className="jb-field">
          <span>Your years of experience</span>
          <input className="jb-in" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 10" />
          <small>Jobs rank by the years they ask for, not by their title's level.</small>
        </label>
        <label className="jb-field">
          <span>Daily run</span>
          <span className="jb-check">
            <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} /> Search once a day, early morning
          </span>
          <small>Uses one search per saved search, inside this month's budget.</small>
        </label>
        <label className="jb-field">
          <span>Words that lift a job</span>
          <textarea className="jb-in" rows={3} value={prefer} onChange={(e) => setPrefer(e.target.value)} placeholder="Comma-separated, e.g. platform, AI, roadmap, startup" />
        </label>
        <label className="jb-field">
          <span>Words that hide a job</span>
          <textarea className="jb-in" rows={3} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="Comma-separated: companies, industries or kinds of role to skip" />
          <small>Matched as whole words in the title or company.</small>
        </label>
        <label className="jb-field jb-wide">
          <span>Companies you'd most like</span>
          <textarea className="jb-in" rows={2} value={companies} onChange={(e) => setCompanies(e.target.value)} placeholder="Comma-separated; their jobs rise to the top" />
        </label>
        <label className="jb-field">
          <span>Big companies</span>
          <textarea className="jb-in" rows={3} value={big} onChange={(e) => setBig(e.target.value)} placeholder="Comma-separated; rank first after your own list" />
        </label>
        <label className="jb-field">
          <span>Rising companies</span>
          <textarea className="jb-in" rows={3} value={rising} onChange={(e) => setRising(e.target.value)} placeholder="Comma-separated startups on the up; rank next" />
        </label>
        <label className="jb-field jb-wide">
          <span>Close to home</span>
          <input className="jb-in" value={near} onChange={(e) => setNear(e.target.value)} placeholder="Comma-separated places, e.g. Denver, Boulder, Colorado" />
          <small>Jobs here rank first, then hybrid ones, then remote.</small>
        </label>
        <label className="jb-field jb-wide">
          <span>Already applied to</span>
          <textarea
            className="jb-in"
            rows={6}
            value={applied}
            onChange={(e) => setApplied(e.target.value)}
            placeholder={"One per line, Company: Title\ne.g. Northwind: Technical Program Manager, Security"}
          />
          <small>A found job matching one of these goes straight to Applied instead of showing as new.</small>
        </label>
      </section>
      <div className="jb-row">
        <button type="button" className="jb-btn jb-btn--go" disabled={busy} onClick={save}>
          Save the search
        </button>
      </div>
      <section className="jb-card">
        <h3 className="jb-h3">Resume</h3>
        <p className="jb-note">
          {hasResume ? "A resume is on file. " : "No resume yet. "}Paste it as plain text to rank jobs by how well their words match it. It is kept in C.E.O.'s private store, read only in a passkey
          session, and never leaves Azure.
        </p>
        <textarea className="jb-in" rows={6} value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste your resume here" maxLength={20_000} />
        <div className="jb-row">
          <button type="button" className="jb-btn jb-btn--go" disabled={busy || !resume.trim()} onClick={() => (onResume(resume), setResume(""))}>
            Save resume
          </button>
          {hasResume && (
            <button type="button" className="jb-btn jb-btn--quiet" disabled={busy} onClick={() => onResume("")}>
              Remove resume
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function JobSearch() {
  const { load, view, busy, said, refresh, send } = useJobs();
  const now = useNow(30_000);
  const setGrowth = useAnnex((s) => s.setGrowth);
  const [tab, setTab] = useState<Tab>("matches");
  const [showHidden, setShowHidden] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(LIST_STEP);

  useEffect(() => {
    void refresh();
    // A run may land from the timer while the page is open: look again every ten minutes (one private-store read).
    const t = window.setInterval(() => void refresh(), 600_000);
    return () => window.clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const g = jobsGrowth(view);
    if (g) setGrowth("jobs", g);
  }, [view, setGrowth]);
  // A first visit with nothing saved opens on the setup.
  useEffect(() => {
    if (view && !view.profile.searches.length) setTab("setup");
  }, [view]);

  const live = useMemo(() => (view ? view.jobs.filter((j) => (j.state === "new" || j.state === "saved") && !j.hidden) : []), [view]);
  const best = useMemo(() => live.filter((j) => j.state === "new").sort((a, b) => b.score - a.score)[0], [live]);
  const list = useMemo(() => {
    if (!view) return [];
    const want: JobState[] = tab === "saved" ? ["saved"] : tab === "applied" ? ["applied"] : tab === "dismissed" ? ["dismissed"] : ["new", "saved"];
    const q = query.trim().toLowerCase();
    return view.jobs.filter(
      (j) =>
        want.includes(j.state) &&
        (showHidden || !j.hidden || tab !== "matches") &&
        (!remoteOnly || j.remote) &&
        (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) &&
        !(tab === "matches" && j.id === best?.id && !q && !remoteOnly),
    );
  }, [view, tab, showHidden, remoteOnly, query, best]);

  if (load === "idle" || load === "loading") return <div className="desk__loading" role="status" aria-label="Loading" />;
  if (load === "signed-out")
    return (
      <section className="jb" aria-label="Job search">
        <p className="jb-empty">The Job search is private. Sign in with your passkey to see it.</p>
      </section>
    );
  if (load === "failed" || !view)
    return (
      <section className="jb" aria-label="Job search">
        <p className="jb-empty">
          The Job search isn't reachable right now.{" "}
          <button type="button" className="jb-link" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      </section>
    );

  const counts = (s: JobState) => view.jobs.filter((j) => j.state === s).length;
  const hiddenN = view.jobs.filter((j) => j.hidden && (j.state === "new" || j.state === "saved")).length;
  const mark = (j: Job) => (state: JobState) => void send({ action: "mark", id: j.id, state });
  const saved = view.profile.searches.length;

  return (
    <section className="jb" aria-label="Job search">
      <header className="jb-head">
        <div>
          <p className="jb-k">Google Jobs · SerpApi · ranked on your experience, pay floor and resume</p>
          <h2 className="jb-hero">
            <b>{live.filter((j) => j.state === "new").length}</b> new matches
            {view.profile.searches.length ? <span> across {saved} searches</span> : null}
          </h2>
        </div>
        {said && <span className="jb-said">{said}</span>}
      </header>

      <div className="jb-top">
        <Bloom job={best} profile={view.profile} onMark={(s) => best && mark(best)(s)} busy={busy} />
        <div className="jb-side">
          <Pipeline n={counts("new")} s={counts("saved")} a={counts("applied")} d={counts("dismissed")} />
          <Budget view={view} busy={busy} onRun={() => void send({ action: "run" })} now={now} />
        </div>
      </div>

      <div className="jb-mid">
        <PayMap jobs={live} floor={view.profile.minSalary} />
        <Constellation companies={view.profile.companies} jobs={view.jobs} />
      </div>

      <nav className="jb-tabs" role="tablist" aria-label="Which jobs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="jb-tab"
            onClick={() => {
              setTab(t.id);
              setShown(LIST_STEP);
            }}
          >
            {t.label}
            {t.id === "saved" || t.id === "applied" || t.id === "dismissed" ? <b>{counts(t.id)}</b> : null}
          </button>
        ))}
      </nav>

      {tab === "setup" ? (
        <Setup
          key={JSON.stringify(view.profile)}
          profile={view.profile}
          hasResume={view.hasResume}
          busy={busy}
          onSave={(p) => void send({ action: "profile", profile: p })}
          onResume={(t) => void send({ action: "resume", text: t })}
        />
      ) : (
        <>
          <div className="jb-filters">
            <input className="jb-in jb-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title, company or place" aria-label="Filter jobs" />
            <label className="jb-check">
              <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Remote only
            </label>
            {tab === "matches" && hiddenN > 0 && (
              <label className="jb-check">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show {hiddenN} hidden
              </label>
            )}
          </div>
          {list.length ? (
            <ol className="jb-list">
              {list.slice(0, shown).map((j, i) => (
                <JobCard key={j.id} job={j} profile={view.profile} i={i} busy={busy} onMark={mark(j)} />
              ))}
            </ol>
          ) : (
            <p className="jb-empty">
              {tab === "matches"
                ? saved
                  ? view.runs.length
                    ? "No other matches with these filters."
                    : "No jobs yet. Search now, or wait for the morning run."
                  : "Add a search in Search setup to start."
                : `Nothing ${tab} yet.`}
            </p>
          )}
          {list.length > shown && (
            <button type="button" className="jb-btn jb-more-btn" onClick={() => setShown((n) => n + LIST_STEP)}>
              Show {Math.min(LIST_STEP, list.length - shown)} more
            </button>
          )}
          {view.runs.length > 0 && (
            <details className="jb-runs">
              <summary>Recent runs</summary>
              <ol>
                {view.runs.slice(0, 10).map((r) => (
                  <li key={r.at}>
                    <span>{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    <span>{r.by === "schedule" ? "Daily" : "By hand"}</span>
                    <span>
                      {r.searches} {r.searches === 1 ? "search" : "searches"} · {r.found} found · {r.added} new
                    </span>
                    {r.error && <span className="jb-warn">{r.error}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
