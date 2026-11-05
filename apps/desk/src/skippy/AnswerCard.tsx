import type { AskedCard } from "./asked.ts";
import "./skippy.css";

const num = (n: number | null) => (n === null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * A submind's answer card (#341), in place of the pending bubble: the numbers side by side (for the Green, Sleeper's
 * and FantasyPros' projections), the verdict, what decided it, and a Sources footer.
 */
export function AnswerCard({ card }: { card: AskedCard }) {
  return (
    <div className="skp-card">
      <p className="skp-card__verdict">{card.verdict}</p>
      {card.rows.length > 0 && (
        <table className="skp-card__nums">
          <thead>
            <tr>
              <th scope="col">
                <span className="skp-sr">Player or option</span>
              </th>
              {card.cols.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, i) => (
                  <td key={i}>{num(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {card.metrics.length > 0 && (
        <ul className="skp-card__metrics">
          {card.metrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {card.sources.length > 0 && (
        <p className="skp-card__sources">
          <b>Sources</b> {card.sources.join(" · ")}
        </p>
      )}
    </div>
  );
}
