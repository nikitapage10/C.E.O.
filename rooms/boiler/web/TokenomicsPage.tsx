import { useState, type CSSProperties, type ReactNode } from "react";
import { useIsPhone } from "@ceo/engine/web/phone.ts";
import { Private } from "@ceo/engine/web/Private.tsx";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { ago } from "@ceo/desk/foundryGraph.ts";
import type { TruthRow, UsageReport, UsageRow, WasteFlag } from "../../../api/_usage/aggregate.ts";
import type { Provider } from "../../../api/_usage/prices.ts";
import { capTone, dayBars, monthVerdict, pct, perCall, PROVIDER_NAME, shortDay, tokens, usd, useTokenomics, WINDOWS, type UsageWindow } from "../data/tokenomics.ts";
import { BoilerFrame, CapBar } from "./frame.tsx";
import { ACCENT } from "./Rack.tsx";
import { SystemsNav } from "./SystemsNav.tsx";
import "./tokenomics.css";

/**
 * Boiler Room > Tokenomics (#1142): what every AI call the Function App makes costs, from its own usage ledger
 * (api/_usage/meter.ts), with Anthropic's and OpenAI's own bills beside it when their admin keys are set. A dashboard,
 * numbers first: this month against each cap, the window's spend by day, provider, feature and model, the per-call
 * averages, the top cost drivers and the waste flags worked out from the lines. On a phone (the engine's PHONE_QUERY)
 * the key numbers and the flags come first, every chart stacks in one column, and the tables become short lists.
 * Signed out it shows nothing but how to see it: no money, no models.
 */

const PROVIDERS: readonly Provider[] = ["anthropic", "google", "openai"];

export function TokenomicsPage({ now }: { now: number }) {
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  const [days, setDays] = useState<UsageWindow>(30);
  const state = useTokenomics(days, signedIn);
  const phone = useIsPhone();
  useRoomReady(state.status !== "loading");
  const report = state.status === "ready" ? state.report : null;
  const verdict = report ? monthVerdict(report) : null;

  return (
    <div className="sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <BoilerFrame
        page="tokenomics"
        tabs={<SystemsNav className="bx-tabs" />}
        title={
          report && verdict ? (
            <>
              <Private>{usd(report.month.usd)}</Private> of AI in {report.month.label.split(" ")[0]}, <em className={`is-${verdict.tone}`}>{verdict.word}</em>
            </>
          ) : (
            "Tokenomics"
          )
        }
        say="Every AI call the Function App makes, from its own ledger: tokens, cache, searches and dollars, by feature. Never a prompt or an answer."
        needs={[]}
        now={now}
        onGo={() => undefined}
      >
        <div className="tk-bar" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" className="tk-win" aria-pressed={days === w} onClick={() => setDays(w)}>
              {w} days
            </button>
          ))}
          {report ? <span className="tk-span">{report.from === report.to ? shortDay(report.to) : `${shortDay(report.from)} – ${shortDay(report.to)}`}</span> : null}
        </div>
        {state.status === "ready" ? <Board r={state.report} phone={phone} now={now} /> : <Waiting status={state.status} />}
      </BoilerFrame>
    </div>
  );
}

function Waiting({ status }: { status: "loading" | "signed-out" | "not-set-up" | "error" }) {
  const words = {
    loading: "Reading the ledger…",
    "signed-out": "Sign in with your passkey to see what the AI calls cost. Spend stays private.",
    "not-set-up": "The usage ledger isn't set up here: it needs the Desk's key and the private store.",
    error: "The ledger couldn't be read just now. It will try again when the tab opens.",
  }[status];
  return (
    <section className="bx-panel tk-wait" aria-live="polite">
      <p className="bx-note">{words}</p>
    </section>
  );
}

function Board({ r, phone, now }: { r: UsageReport; phone: boolean; now: number }) {
  const t = r.totals;
  if (!t.calls && !r.month.calls) {
    return (
      <section className="bx-panel tk-wait">
        <p className="bx-note">No AI calls in the ledger yet for these {r.days} days. Each call the Function App makes adds a line as it happens.</p>
        <TruthPanel rows={r.truth} now={now} />
      </section>
    );
  }
  const call = perCall(t);
  return (
    <>
      <div className="tk-kpis">
        <Kpi k="This month" v={<Private>{usd(r.month.usd)}</Private>} sub={<>heading for <Private>{usd(r.month.projected)}</Private></>} />
        <Kpi k={`${r.days} days`} v={<Private>{usd(t.usd)}</Private>} sub={`${t.calls.toLocaleString("en-US")} calls`} />
        <Kpi k="Per call" v={<Private>{usd(call.usd)}</Private>} sub={`${tokens(call.tokensIn)} in · ${tokens(call.tokensOut)} out`} />
        <Kpi k="Cache hit" v={pct(t.cacheHit)} sub={`${tokens(t.cacheRead)} read back`} tone={t.cacheRead + t.cacheWrite === 0 ? undefined : t.cacheHit < 0.3 ? "warn" : "ok"} />
        {phone ? null : <Kpi k="Failed" v={t.errors ? String(t.errors) : "none"} sub={t.calls ? `${pct(t.errors / t.calls)} of calls` : ""} tone={t.errors ? "warn" : "ok"} />}
      </div>

      <Flags flags={r.flags} />

      <div className="tk-grid">
        <section className="bx-panel" aria-labelledby="tk-caps-h">
          <header className="bx-ph">
            <h2 id="tk-caps-h">Against the caps</h2>
            <span className="bx-psub">{r.month.label} · the ledger's sum, each cap's own meter is the stop</span>
          </header>
          <ul className="tk-caps">
            {r.caps.map((c) => {
              const tone = capTone(c.usd, c.cap);
              return (
                <li key={c.id} className={`is-${tone}`}>
                  <b>{c.label}</b>
                  <span className="bx-fig">
                    <Private>{usd(c.usd)}</Private> / <Private>{usd(c.cap)}</Private>
                  </span>
                  <CapBar share={c.cap > 0 ? c.usd / c.cap : null} tone={tone} />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="bx-panel" aria-labelledby="tk-day-h">
          <header className="bx-ph">
            <h2 id="tk-day-h">By day</h2>
            <span className="bx-psub">dollars a day, by provider</span>
          </header>
          <DayChart r={r} phone={phone} />
          <Legend r={r} />
        </section>
      </div>

      <div className="tk-grid">
        <section className="bx-panel" aria-labelledby="tk-prov-h">
          <header className="bx-ph">
            <h2 id="tk-prov-h">By provider</h2>
            <span className="bx-psub">the ledger, and the bill where the provider tells it</span>
          </header>
          <ul className="tk-prov">
            {r.byProvider.map((p) => (
              <ProviderRow key={p.key} row={p} truth={r.truth.find((x) => x.provider === p.key)} total={t.usd} now={now} />
            ))}
          </ul>
        </section>

        <section className="bx-panel" aria-labelledby="tk-drv-h">
          <header className="bx-ph">
            <h2 id="tk-drv-h">Top cost drivers</h2>
            <span className="bx-psub">feature and model</span>
          </header>
          <ol className="tk-drivers">
            {r.drivers.map((d) => (
              <li key={d.key}>
                <b title={d.key}>{d.key}</b>
                <span className="tk-share" aria-hidden="true">
                  <i style={{ "--v": t.usd > 0 ? d.usd / t.usd : 0 } as CSSProperties} />
                </span>
                <span className="bx-fig">
                  <Private>{usd(d.usd)}</Private>
                </span>
                <small>
                  {d.calls} calls · <Private>{usd(perCall(d).usd)}</Private> each
                </small>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Table title="By feature" id="tk-feat" rows={r.byFeature} phone={phone} total={t.usd} />
      <Table title="By model" id="tk-model" rows={r.byModel} phone={phone} total={t.usd} />
      <TruthPanel rows={r.truth} now={now} />
    </>
  );
}

function Kpi({ k, v, sub, tone }: { k: string; v: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <section className={`bx-panel tk-kpi ${tone ? `is-${tone}` : ""}`}>
      <p className="bx-k">{k}</p>
      <p className="tk-v">{v}</p>
      {sub ? <p className="bx-note">{sub}</p> : null}
    </section>
  );
}

function Flags({ flags }: { flags: readonly WasteFlag[] }) {
  return (
    <section className="bx-panel tk-flags" aria-labelledby="tk-flags-h">
      <header className="bx-ph">
        <h2 id="tk-flags-h">Waste flags</h2>
        <span className="bx-psub">{flags.length ? `${flags.length} worked out from the calls` : "none: no repeats, cache misses, oversized asks or costly failures"}</span>
      </header>
      {flags.length ? (
        <ul>
          {flags.map((f, i) => (
            <li key={`${f.kind}-${f.feature ?? i}`} className={`is-${f.tone}`}>
              <i className="bx-dot" aria-hidden="true" />
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const DAY_W = 640;
const DAY_H = 150;

function DayChart({ r, phone }: { r: UsageReport; phone: boolean }) {
  const bars = dayBars(r);
  const max = Math.max(...bars.map((b) => b.total), 0);
  const w = phone ? 340 : DAY_W;
  const h = phone ? 120 : DAY_H;
  const step = w / Math.max(1, bars.length);
  const bw = Math.max(1, step * 0.72);
  const peak = bars.reduce((best, b) => (b.total > best.total ? b : best), bars[0] ?? { day: "", total: 0, parts: [] });
  return (
    <figure className="tk-day">
      <svg viewBox={`0 0 ${w} ${h + 16}`} preserveAspectRatio="none" role="img" aria-label={max > 0 ? `Spend by day; the highest was ${shortDay(peak.day)}` : "No spend in this window"}>
        <line className="tk-axis" x1="0" x2={w} y1={h + 0.5} y2={h + 0.5} />
        {bars.map((b, i) => {
          let y = h;
          return (
            <g key={b.day}>
              <title>{`${shortDay(b.day)}: ${usd(b.total)}`}</title>
              {b.parts.map((p) => {
                const ph = max > 0 ? (p.usd / max) * (h - 6) : 0;
                if (ph <= 0) return null;
                y -= ph;
                return <rect key={p.provider} className={`tk-p-${p.provider}`} x={i * step + (step - bw) / 2} y={y} width={bw} height={Math.max(1, ph - 0.5)} />;
              })}
            </g>
          );
        })}
        <text className="tk-tick" x="0" y={h + 13}>
          {shortDay(r.from)}
        </text>
        <text className="tk-tick" x={w} y={h + 13} textAnchor="end">
          {shortDay(r.to)}
        </text>
      </svg>
      <figcaption className="bx-note">
        {max > 0 ? (
          <>
            Highest day {shortDay(peak.day)}, <Private>{usd(peak.total)}</Private>.
          </>
        ) : (
          "Nothing spent in this window."
        )}
      </figcaption>
    </figure>
  );
}

function Legend({ r }: { r: UsageReport }) {
  return (
    <ul className="tk-legend">
      {PROVIDERS.map((p) => (
        <li key={p}>
          <i className={`tk-p-${p}`} aria-hidden="true" />
          {PROVIDER_NAME[p]} <Private>{usd(r.byProvider.find((x) => x.key === p)?.usd ?? 0)}</Private>
        </li>
      ))}
    </ul>
  );
}

function ProviderRow({ row, truth, total, now }: { row: UsageRow; truth?: TruthRow; total: number; now: number }) {
  const p = row.key as Provider;
  return (
    <li>
      <i className={`tk-sw tk-p-${p}`} aria-hidden="true" />
      <b>{PROVIDER_NAME[p]}</b>
      <span className="bx-fig">
        <Private>{usd(row.usd)}</Private>
      </span>
      <small>
        {row.calls} calls · {total > 0 ? pct(row.usd / total) : "0%"} of spend{row.errors ? ` · ${row.errors} failed` : ""}
      </small>
      <small className="tk-truth">{truthWords(truth, now)}</small>
    </li>
  );
}

function truthWords(t: TruthRow | undefined, now: number) {
  if (!t) return null;
  if (t.state === "ledger") return "No usage API: the ledger is the record. Visual QA's Gemini runs in GitHub Actions, outside it.";
  if (t.state === "waiting") return "The provider's own numbers wait for its admin key.";
  if (t.state === "failed" && t.billed === null) return `The last pull of its numbers failed${t.pulledAt ? ` ${ago(t.pulledAt, now)}` : ""}.`;
  return (
    <>
      Billed <Private>{usd(t.billed ?? 0)}</Private> on the days it has reported, the ledger <Private>{usd(t.ledger)}</Private>: <Private>{usd(t.gap ?? 0)}</Private> the ledger doesn't see.
    </>
  );
}

const SHOW = 8;

function Table({ title, id, rows, phone, total }: { title: string; id: string; rows: readonly UsageRow[]; phone: boolean; total: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="bx-panel" aria-labelledby={`${id}-h`}>
      <header className="bx-ph">
        <h2 id={`${id}-h`}>{title}</h2>
        <span className="bx-psub">{rows.length} · dollars, calls and per-call averages</span>
      </header>
      {phone ? (
        <ul className="tk-list">
          {shown.map((r) => {
            const c = perCall(r);
            return (
              <li key={r.key}>
                <b title={r.key}>{r.key}</b>
                <span className="bx-fig">
                  <Private>{usd(r.usd)}</Private>
                </span>
                <small>
                  {r.calls} calls · <Private>{usd(c.usd)}</Private> each · {tokens(c.tokensIn)} in, {tokens(c.tokensOut)} out
                  {r.cacheRead + r.cacheWrite > 0 ? ` · cache ${pct(r.cacheHit)}` : ""}
                  {r.errors ? ` · ${r.errors} failed` : ""}
                </small>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="tk-tw">
          <table className="tk-table">
            <thead>
              <tr>
                <th scope="col">{title.replace("By ", "")}</th>
                <th scope="col">Spend</th>
                <th scope="col">Share</th>
                <th scope="col">Calls</th>
                <th scope="col">Per call</th>
                <th scope="col">In / call</th>
                <th scope="col">Out / call</th>
                <th scope="col">Cache hit</th>
                <th scope="col">Searches</th>
                <th scope="col">Failed</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const c = perCall(r);
                return (
                  <tr key={r.key}>
                    <th scope="row" title={r.key}>
                      {r.provider ? <i className={`tk-sw tk-p-${r.provider}`} aria-hidden="true" /> : null}
                      {r.key}
                    </th>
                    <td>
                      <Private>{usd(r.usd)}</Private>
                    </td>
                    <td>{total > 0 ? pct(r.usd / total) : "–"}</td>
                    <td>{r.calls.toLocaleString("en-US")}</td>
                    <td>
                      <Private>{usd(c.usd)}</Private>
                    </td>
                    <td>{tokens(c.tokensIn)}</td>
                    <td>{tokens(c.tokensOut)}</td>
                    <td className={r.cacheRead + r.cacheWrite > 0 && r.cacheHit < 0.3 ? "is-warn" : undefined}>{r.cacheRead + r.cacheWrite > 0 ? pct(r.cacheHit) : "–"}</td>
                    <td>{r.searches || "–"}</td>
                    <td className={r.errors ? "is-warn" : undefined}>{r.errors || "–"}</td>
                    <td>{r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)} s` : `${r.ms} ms`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > SHOW ? (
        <button type="button" className="bx-fold tk-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Fewer" : `All ${rows.length}`}
        </button>
      ) : null}
    </section>
  );
}

function TruthPanel({ rows, now }: { rows: readonly TruthRow[]; now: number }) {
  return (
    <section className="bx-panel" aria-labelledby="tk-truth-h">
      <header className="bx-ph">
        <h2 id="tk-truth-h">The bill against the ledger</h2>
        <span className="bx-psub">pulled nightly from each provider's admin usage API</span>
      </header>
      <ul className="tk-billed">
        {rows.map((t) => (
          <li key={t.provider} className={`is-${t.state === "ok" ? (t.gap !== null && t.billed ? (Math.abs(t.gap) > Math.max(0.5, t.billed * 0.2) ? "warn" : "ok") : "ok") : t.state === "failed" ? "fail" : "wait"}`}>
            <i className="bx-dot" aria-hidden="true" />
            <b>{PROVIDER_NAME[t.provider]}</b>
            <p className="bx-note">{truthWords(t, now)}</p>
            {t.models.length ? (
              <ul className="tk-models">
                {t.models.map((m) => (
                  <li key={m.model}>
                    <span title={m.model}>{m.model}</span>
                    <span>
                      billed <Private>{usd(m.billed)}</Private> · ledger <Private>{usd(m.ledger)}</Private>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="bx-note">What the ledger can't see: anything run on the same accounts outside the Function App, such as Claude Code sessions, CI, Visual QA and the Mac.</p>
    </section>
  );
}
