import { HOUSES, LINEAGES, RELATIONSHIP_LABEL, relationshipsOf } from "@ceo/core";
import { useState, type ReactNode } from "react";
import { useCast } from "../cast/castStore.ts";
import { useWorld } from "../store.ts";

/**
 * The dossier on whoever you've selected: their House, their family, their habits and their history.
 * Takes the place of Signals while someone is selected; Esc or S puts Signals back.
 */
export function Dossier({ id, open }: { id: string; open: boolean }) {
  const cast = useCast((s) => s.cast);
  const openStudio = useCast((s) => s.openStudio);
  const selectAgent = useWorld((s) => s.selectAgent);
  const rt = useWorld((s) => s.lattice.agents[id]);
  const [houseOpen, setHouseOpen] = useState(false);
  const p = cast.profiles[id];
  if (!p) return null;
  const house = HOUSES[p.lineage];
  const lore = p.lore;
  const rels = relationshipsOf(cast, id);
  const accent = p.look.accent;

  return (
    <section className={`rail dossier ${open ? "rail--open" : ""}`} aria-label={`Dossier: ${p.name}`}>
      <div className="dossier__head">
        <p className="eyebrow">Dossier</p>
        <button className="dossier__close" onClick={() => selectAgent(null)} aria-label="Close dossier">
          ×
        </button>
      </div>
      <h2 className="dossier__name">
        <i className="ring" style={{ boxShadow: `0 0 8px ${accent}` }} />
        {p.name}
      </h2>
      {lore.title && <p className="dossier__title">{lore.title}</p>}
      <p className="dossier__meta">
        {p.role}
        {rt ? ` · ${rt.activity}` : ""}
        {lore.epoch ? ` · ${lore.epoch}` : ""}
      </p>

      <div className="dossier__body">
        <button className={`house ${houseOpen ? "house--open" : ""}`} onClick={() => setHouseOpen(!houseOpen)} aria-expanded={houseOpen}>
          <span className="house__name" style={{ color: LINEAGES[p.lineage].accent }}>
            {house.name}, {house.epithet}
          </span>
          <span className="house__words">“{house.words}”</span>
          <span className="house__lineage">
            {LINEAGES[p.lineage].name} · {houseOpen ? "− less" : "+ the House"}
          </span>
        </button>
        {houseOpen && (
          <div className="house__more">
            <p>
              <b>Sigil</b> {house.sigil}
            </p>
            <p>
              <b>Seat</b> {house.seat}
            </p>
            <p>
              <b>Founder</b> {house.founder}
            </p>
            <p>{house.history}</p>
            <p>
              <b>Rivals</b> {house.rivals}
            </p>
          </div>
        )}

        {lore.origin && <Field label="Origin">{lore.origin}</Field>}
        {lore.kin && <Field label="Kin">{lore.kin}</Field>}
        {p.personality.bio && <Field label="Now">{p.personality.bio}</Field>}
        {p.personality.catchphrase && <p className="dossier__quote">“{p.personality.catchphrase}”</p>}
        {p.personality.traits.length > 0 && <p className="dossier__traits">{p.personality.traits.join(" · ")}</p>}

        {lore.quirks.length > 0 && <List label="Quirks" items={lore.quirks} />}
        {(lore.likes.length > 0 || lore.dislikes.length > 0) && (
          <div className="dossier__pair">
            {lore.likes.length > 0 && <List label="Likes" items={lore.likes} />}
            {lore.dislikes.length > 0 && <List label="Dislikes" items={lore.dislikes} />}
          </div>
        )}

        {rels.length > 0 && (
          <div className="dossier__field">
            <p className="eyebrow">Relationships</p>
            <ul className="dossier__rels">
              {rels.map((r) => {
                const other = cast.profiles[r.other];
                return (
                  <li key={r.index}>
                    <span className="dossier__relkind">{RELATIONSHIP_LABEL[r.kind]}</span>{" "}
                    <button className="link" onClick={() => selectAgent(r.other)}>
                      {other?.name ?? r.other}
                    </button>
                    {other && <span className="dossier__relhouse"> of {HOUSES[other.lineage].name}</span>}
                    {r.note && <span className="dossier__relnote">{r.note}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {lore.chronicle.length > 0 && (
          <div className="dossier__field">
            <p className="eyebrow">Chronicle</p>
            <ol className="dossier__chronicle">
              {lore.chronicle.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <button className="dossier__edit tracked" onClick={() => openStudio(id)}>
        Edit in studio · E
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dossier__field">
      <p className="eyebrow">{label}</p>
      <p className="dossier__text">{children}</p>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="dossier__field">
      <p className="eyebrow">{label}</p>
      <ul className="dossier__list">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
