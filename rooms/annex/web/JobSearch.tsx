import { useEffect, useMemo, useState } from "react";
import { useNow } from "@ceo/engine/sigils/motion.tsx";
import { useAnnex } from "../data/annex.ts";
import { jobsGrowth, k, since, useJobs, type Job, type JobsProfile, type JobState } from "../data/jobs.ts";
import "./jobs.css";

/**
 * The Job search (#1000), the Annex's second pop-up: Google Jobs through SerpApi, searched once a day (and on a tap)
 * for the searches saved here, merged into one list and ranked against the profile and the resume with plain rules.
 * Laid out like a job board, because that is how jobs are read: the best matches first, each with its pay, where it
 * is, why it ranked, and where to apply, and three moves on it (Save, Applied, Dismiss). Private: a passkey session
 * only, nothing kept on the device. Every job is SerpApi's, as the last run read it; nothing is made up.
 */

type Tab = "matches" | "saved" | "applied" | "dismissed" | "setup";
const TABS: { id: Tab; label: string }[] = [
  { id: "matches", label: "Matches" },
  { id: "saved", label: "Saved" },
  { id: "applied", label: "Applied" },
  { id: "dismissed", label: "Dismissed" },
  { id: "setup", label: "Search setup" },
];
const LIST_STEP = 25;

function pay(j: Job): string | null {
  if (j.payMin !== null && j.payMax !== null) return j.payMin === j.payMax ? k(j.payMin) : `${k(j.payMin)}–${k(j.payMax)}`;
  return j.salary;
}

function JobCard({ job, onMark, busy }: { job: Job; onMark: (s: JobState) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const p = pay(job);
  return (
    <li className={`jb-job is-${job.state}${job.hidden ? " is-hidden" : ""}`}>
      <div className="jb-score" title="How well it matches your searches, words, pay floor and resume" aria-label={`Match ${job.score} of 100`}>
        <b>{job.score}</b>
        <i style={{ height: `${job.score}%` }} />
      </div>
      <div className="jb-main">
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
          {job.remote && <span className="jb-tag">Remote</span>}
          {job.state !== "new" && <span className={`jb-tag jb-tag--${job.state}`}>{job.state === "saved" ? "Saved" : job.state === "applied" ? "Applied" : "Dismissed"}</span>}
        </p>
        <p className="jb-facts">
          {p && <span className="jb-pay">{p}</span>}
          {job.schedule && <span>{job.schedule}</span>}
          {job.posted && <span>Posted {job.posted}</span>}
          {job.via && <span>via {job.via}</span>}
        </p>
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
                {job.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            {job.snippet && <p>{job.snippet}…</p>}
            {job.apply.length > 0 && (
              <p className="jb-apply">
                Apply on{" "}
                {job.apply.map((a, i) => (
                  <span key={a.link}>
                    {i > 0 && ", "}
                    <a href={a.link} target="_blank" rel="noreferrer noopener">
                      {a.title}
                    </a>
                  </span>
                ))}
              </p>
            )}
            <p className="jb-found">Found by “{job.search}” · first seen {new Date(job.firstSeen).toLocaleDateString()}</p>
          </div>
        )}
        <div className="jb-acts">
          <button type="button" className="jb-btn jb-btn--quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Less" : "More"}
          </button>
          {job.state !== "saved" && (
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
      </div>
    </li>
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
  const [daily, setDaily] = useState(profile.daily);
  const [resume, setResume] = useState("");
  const edit = (i: number, patch: Partial<(typeof searches)[number]>) => setSearches((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const save = () =>
    onSave({ searches: searches.filter((s) => s.q.trim()), minSalary: floor ? Number(floor.replace(/[^\d]/g, "")) || null : null, prefer: splitWords(prefer), avoid: splitWords(avoid), daily });

  return (
    <div className="jb-setup">
      <section className="jb-card">
        <h3 className="jb-h3">Searches</h3>
        <p className="jb-note">Each search is one SerpApi search per run, six at most. Leave the place empty to search anywhere; tick Remote for work-from-home only.</p>
        <ol className="jb-searches">
          {searches.map((s, i) => (
            <li key={i}>
              <input className="jb-in" value={s.q} onChange={(e) => edit(i, { q: e.target.value })} placeholder="Job title, e.g. Technical Program Manager" aria-label={`Search ${i + 1}: what`} maxLength={120} />
              <input className="jb-in" value={s.location} onChange={(e) => edit(i, { location: e.target.value })} placeholder="Place, e.g. Denver, Colorado" aria-label={`Search ${i + 1}: where`} maxLength={120} />
              <label className="jb-check">
                <input type="checkbox" checked={s.remote} onChange={(e) => edit(i, { remote: e.target.checked })} /> Remote
              </label>
              <button type="button" className="jb-btn jb-btn--quiet" onClick={() => setSearches((x) => x.filter((_, n) => n !== i))} aria-label={`Remove search ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        {searches.length < 6 && (
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
          {hasResume ? "A resume is on file. " : "No resume yet. "}Paste it as plain text to rank jobs by how well their words match it. It is kept in C.E.O.'s private store, read only in a passkey session, and never leaves Azure.
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

  const list = useMemo(() => {
    if (!view) return [];
    const want: JobState[] = tab === "saved" ? ["saved"] : tab === "applied" ? ["applied"] : tab === "dismissed" ? ["dismissed"] : ["new", "saved"];
    const q = query.trim().toLowerCase();
    return view.jobs.filter(
      (j) => want.includes(j.state) && (showHidden || !j.hidden || tab !== "matches") && (!remoteOnly || j.remote) && (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)),
    );
  }, [view, tab, showHidden, remoteOnly, query]);

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

  const last = view.runs[0];
  const counts = (s: JobState) => view.jobs.filter((j) => j.state === s).length;
  const hiddenN = view.jobs.filter((j) => j.hidden && (j.state === "new" || j.state === "saved")).length;
  const newToday = last ? view.jobs.filter((j) => j.firstSeen === last.at).length : 0;
  const perRun = view.profile.searches.length;
  const left = view.budget - view.used;

  return (
    <section className="jb" aria-label="Job search">
      <header className="jb-head">
        <div>
          <h2 className="jb-title-h">Job search</h2>
          <p className="jb-sub">Google Jobs through SerpApi · ranked against your search, pay floor and resume</p>
        </div>
        <div className="jb-fresh" aria-live="polite">
          {!view.configured ? (
            <b className="jb-warn">SerpApi's key isn't set yet</b>
          ) : last ? (
            <span>
              Last searched {since(now - Date.parse(last.at))} ({last.by === "schedule" ? "daily run" : "by hand"}) · {last.added} new of {last.found}
              {last.error ? ` · ${last.error}` : ""}
            </span>
          ) : (
            <span>Not searched yet</span>
          )}
          {said && <span className="jb-said">{said}</span>}
          <button type="button" className="jb-btn jb-btn--go" disabled={busy || !view.configured || !perRun || left < perRun} onClick={() => void send({ action: "run" })} title={`Uses ${perRun} of this month's searches`}>
            {busy ? "Searching…" : "Search now"}
          </button>
        </div>
      </header>

      <dl className="jb-stats">
        <div>
          <dt>New matches</dt>
          <dd>{counts("new") - view.jobs.filter((j) => j.state === "new" && j.hidden).length}</dd>
          <small>{newToday ? `${newToday} from the last run` : " "}</small>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{counts("saved")}</dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd>{counts("applied")}</dd>
        </div>
        <div>
          <dt>Searches this month</dt>
          <dd>
            {view.used}
            <span> / {view.budget}</span>
          </dd>
          <small>
            <span className="jb-meter" aria-hidden="true">
              <i style={{ width: `${view.budget ? Math.min(100, (view.used / view.budget) * 100) : 0}%` }} />
            </span>
            {view.account?.left !== null && view.account?.left !== undefined ? `SerpApi plan: ${view.account.left} left` : " "}
          </small>
        </div>
        <div>
          <dt>Next daily run</dt>
          <dd className="jb-dd-sm">{view.nextRun ? new Date(view.nextRun).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "Off"}</dd>
          <small>{perRun ? `${perRun} ${perRun === 1 ? "search" : "searches"} a run` : "add a search"}</small>
        </div>
      </dl>

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
        <Setup key={JSON.stringify(view.profile)} profile={view.profile} hasResume={view.hasResume} busy={busy} onSave={(p) => void send({ action: "profile", profile: p })} onResume={(t) => void send({ action: "resume", text: t })} />
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
              {list.slice(0, shown).map((j) => (
                <JobCard key={j.id} job={j} busy={busy} onMark={(state) => void send({ action: "mark", id: j.id, state })} />
              ))}
            </ol>
          ) : (
            <p className="jb-empty">
              {tab === "matches" ? (perRun ? (last ? "No matches with these filters." : "No jobs yet. Search now, or wait for the daily run.") : "Add a search in Search setup to start.") : `Nothing ${tab} yet.`}
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
