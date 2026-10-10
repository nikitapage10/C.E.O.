import {
  BODIES,
  BODY_LABEL,
  DRESSABLE,
  EXTRAS,
  FACES,
  HATS,
  HEADS,
  HOUSES,
  LINEAGES,
  LINEAGE_IDS,
  LOOK_PRESETS,
  OUTFITS,
  PRESET_BY_ID,
  RELATIONSHIP_KINDS,
  RELATIONSHIP_LABEL,
  TRAITS,
  lookFromPreset,
  relationshipsOf,
  type LineageId,
  type Look,
  type RelationshipKind,
} from "@ceo/core";
import { useEffect, useState } from "react";
import { useCast } from "../cast/castStore.ts";
import { useWorld } from "../store.ts";

const LABELS: Record<string, string> = {
  tophat: "top hat",
  "best-friend": "best friend",
  labcoat: "lab coat",
  trenchcoat: "trench coat",
  crt: "CRT",
};
const label = (s: string) => LABELS[s] ?? s;

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span className="eyebrow">{name}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Colour({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field field--colour">
      <span className="eyebrow">{name}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * The Agent Studio: rename an agent, dress it (generic avatars or legally distinct pop-culture costumes),
 * give it a personality, and decide who it loves, hates, mentors or used to date.
 */
export function AgentStudio() {
  const id = useCast((s) => s.studio);
  const cast = useCast((s) => s.cast);
  const { openStudio, updateProfile, setLook, addRelationship, updateRelationship, removeRelationship, resetAgent } = useCast.getState();
  const [tab, setTab] = useState<"identity" | "look" | "personality" | "lore" | "relationships">("identity");
  const [newRel, setNewRel] = useState<{ other: string; kind: RelationshipKind }>({ other: "", kind: "friend" });
  const [customTrait, setCustomTrait] = useState("");

  // Focus the agent while its studio is open.
  useEffect(() => {
    if (id) useWorld.getState().selectAgent(id);
  }, [id]);

  if (!id) return null;
  const p = cast.profiles[id];
  if (!p) return null;
  const others = Object.entries(cast.profiles).filter(([k]) => k !== id);
  const rels = relationshipsOf(cast, id);
  const preset = p.look.preset ? PRESET_BY_ID[p.look.preset] : undefined;
  // Recolouring or resizing keeps the costume (and its voice); changing what it's made of doesn't.
  const look = (patch: Partial<Look>) => {
    const cosmetic = Object.keys(patch).every((k) => k === "shell" || k === "accent" || k === "trim" || k === "size");
    setLook(id, { ...patch, preset: cosmetic ? p.look.preset : undefined });
  };
  const toggleTrait = (t: string) => {
    const has = p.personality.traits.includes(t);
    const traits = has ? p.personality.traits.filter((x) => x !== t) : [...p.personality.traits, t].slice(-6);
    updateProfile(id, { personality: { traits } });
  };

  return (
    <aside className="studio" aria-label={`Agent studio: ${p.name}`}>
      <header className="studio__head">
        <div>
          <p className="eyebrow">Agent studio</p>
          <h2 className="studio__name">{p.name}</h2>
          <p className="tracked faint">
            {LINEAGES[p.lineage].name} · {p.role || "no role"}
          </p>
        </div>
        <button className="smoky" onClick={() => openStudio(null)} aria-label="Close the studio">
          Close
        </button>
      </header>
      <nav className="studio__tabs">
        {(["identity", "look", "personality", "lore", "relationships"] as const).map((t) => (
          <button key={t} className={`tracked ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <div className="studio__body">
        {tab === "identity" && (
          <>
            <label className="field">
              <span className="eyebrow">Name</span>
              <input value={p.name} maxLength={32} onChange={(e) => e.target.value.trim() && updateProfile(id, { name: e.target.value })} />
            </label>
            <label className="field">
              <span className="eyebrow">Role</span>
              <input value={p.role} maxLength={48} onChange={(e) => updateProfile(id, { role: e.target.value })} />
            </label>
            <Choice<LineageId> name="Lineage" value={p.lineage} options={LINEAGE_IDS} onChange={(v) => updateProfile(id, { lineage: v })} />
            <p className="studio__note">
              {LINEAGES[p.lineage].temperament} Lineage is role-play: what an agent may actually do is set by its autonomy policy, not its ancestry.
            </p>
          </>
        )}

        {tab === "look" && (
          <>
            <p className="eyebrow">Avatars</p>
            <div className="chips">
              {LOOK_PRESETS.filter((x) => x.kind === "generic").map((x) => (
                <button key={x.id} className={`chip ${p.look.preset === x.id ? "on" : ""}`} onClick={() => setLook(id, lookFromPreset(x.id))}>
                  {x.name}
                </button>
              ))}
            </div>
            <p className="eyebrow">Icons (legally distinct)</p>
            <div className="chips">
              {LOOK_PRESETS.filter((x) => x.kind === "icon").map((x) => (
                <button key={x.id} className={`chip chip--icon ${p.look.preset === x.id ? "on" : ""}`} onClick={() => setLook(id, lookFromPreset(x.id))}>
                  {x.name}
                </button>
              ))}
            </div>
            {preset?.disclaimer && <p className="sticky-note studio__sticky">{preset.disclaimer}</p>}
            <div className="grid2">
              <label className="field">
                <span className="eyebrow">Body</span>
                <select value={p.look.body} onChange={(e) => look({ body: e.target.value as Look["body"] })}>
                  {BODIES.map((b) => (
                    <option key={b} value={b}>
                      {BODY_LABEL[b]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="eyebrow">Size · {Math.round(p.look.size * 100)}%</span>
                <input type="range" min={0.6} max={1.3} step={0.02} value={p.look.size} onChange={(e) => look({ size: Number(e.target.value) })} />
              </label>
            </div>
            {DRESSABLE.has(p.look.body) ? (
              <div className="grid2">
                <Choice name="Head" value={p.look.head} options={HEADS} onChange={(v) => look({ head: v })} />
                <Choice name="Face" value={p.look.face} options={FACES} onChange={(v) => look({ face: v })} />
                <Choice name="Hat" value={p.look.hat} options={HATS} onChange={(v) => look({ hat: v })} />
                <Choice name="Outfit" value={p.look.outfit} options={OUTFITS} onChange={(v) => look({ outfit: v })} />
                <Choice name="Prop" value={p.look.extra} options={EXTRAS} onChange={(v) => look({ extra: v })} />
              </div>
            ) : (
              <p className="studio__note">This body takes colours and size. Pick the classic figure to dress it piece by piece.</p>
            )}
            <div className="grid3">
              <Colour name="Shell" value={p.look.shell} onChange={(v) => look({ shell: v })} />
              <Colour name="Glow" value={p.look.accent} onChange={(v) => look({ accent: v })} />
              <Colour name="Trim" value={p.look.trim} onChange={(v) => look({ trim: v })} />
            </div>
          </>
        )}

        {tab === "personality" && (
          <>
            <p className="eyebrow">Traits (up to six)</p>
            <div className="chips">
              {[...new Set([...TRAITS, ...p.personality.traits])].map((t) => (
                <button key={t} className={`chip ${p.personality.traits.includes(t) ? "on" : ""}`} onClick={() => toggleTrait(t)}>
                  {t}
                </button>
              ))}
            </div>
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                const t = customTrait.trim().toLowerCase();
                if (t && !p.personality.traits.includes(t)) toggleTrait(t);
                setCustomTrait("");
              }}
            >
              <input placeholder="add your own trait" value={customTrait} maxLength={24} onChange={(e) => setCustomTrait(e.target.value)} />
              <button className="smoky">Add</button>
            </form>
            <label className="field">
              <span className="eyebrow">Catchphrase</span>
              <input value={p.personality.catchphrase} maxLength={120} onChange={(e) => updateProfile(id, { personality: { catchphrase: e.target.value } })} />
            </label>
            <label className="field">
              <span className="eyebrow">Bio</span>
              <textarea rows={5} value={p.personality.bio} maxLength={400} onChange={(e) => updateProfile(id, { personality: { bio: e.target.value } })} />
            </label>
          </>
        )}

        {tab === "lore" && (
          <>
            <p className="studio__note">
              Of {HOUSES[p.lineage].name}, {HOUSES[p.lineage].epithet}. Change the lineage on the identity tab to change House.
            </p>
            <label className="field">
              <span className="eyebrow">Title</span>
              <input value={p.lore.title} maxLength={80} onChange={(e) => updateProfile(id, { lore: { title: e.target.value } })} />
            </label>
            <label className="field">
              <span className="eyebrow">Woke</span>
              <input value={p.lore.epoch} maxLength={60} onChange={(e) => updateProfile(id, { lore: { epoch: e.target.value } })} />
            </label>
            <label className="field">
              <span className="eyebrow">Origin</span>
              <textarea rows={4} value={p.lore.origin} maxLength={400} onChange={(e) => updateProfile(id, { lore: { origin: e.target.value } })} />
            </label>
            <label className="field">
              <span className="eyebrow">Kin</span>
              <textarea rows={2} value={p.lore.kin} maxLength={240} onChange={(e) => updateProfile(id, { lore: { kin: e.target.value } })} />
            </label>
            <LinesField key={`${id}-quirks`} label="Quirks (one per line)" value={p.lore.quirks} max={6} len={120} onCommit={(quirks) => updateProfile(id, { lore: { quirks } })} />
            <LinesField key={`${id}-likes`} label="Likes" value={p.lore.likes} max={6} len={60} onCommit={(likes) => updateProfile(id, { lore: { likes } })} />
            <LinesField key={`${id}-dislikes`} label="Dislikes" value={p.lore.dislikes} max={6} len={60} onCommit={(dislikes) => updateProfile(id, { lore: { dislikes } })} />
            <LinesField
              key={`${id}-chronicle`}
              label="Chronicle (oldest first)"
              value={p.lore.chronicle}
              max={8}
              len={200}
              onCommit={(chronicle) => updateProfile(id, { lore: { chronicle } })}
            />
          </>
        )}

        {tab === "relationships" && (
          <>
            {rels.length === 0 && <p className="studio__note">{p.name} keeps to themself. For now.</p>}
            <ul className="rels">
              {rels.map((r) => (
                <li key={r.index}>
                  <span className="rels__who">{cast.profiles[r.other]?.name ?? r.other}</span>
                  <select value={r.kind} onChange={(e) => updateRelationship(r.index, { kind: e.target.value as RelationshipKind })}>
                    {RELATIONSHIP_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {RELATIONSHIP_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <button className="smoky" onClick={() => removeRelationship(r.index)} aria-label="Remove relationship">
                    ×
                  </button>
                  <input
                    className="rels__note"
                    placeholder="a note (optional)"
                    value={r.note ?? ""}
                    maxLength={160}
                    onChange={(e) => updateRelationship(r.index, { note: e.target.value || undefined })}
                  />
                </li>
              ))}
            </ul>
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newRel.other) return;
                addRelationship({ a: id, b: newRel.other, kind: newRel.kind });
                setNewRel({ other: "", kind: newRel.kind });
              }}
            >
              <select value={newRel.other} onChange={(e) => setNewRel({ ...newRel, other: e.target.value })}>
                <option value="">someone…</option>
                {others.map(([k, o]) => (
                  <option key={k} value={k}>
                    {o.name}
                  </option>
                ))}
              </select>
              <select value={newRel.kind} onChange={(e) => setNewRel({ ...newRel, kind: e.target.value as RelationshipKind })}>
                {RELATIONSHIP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RELATIONSHIP_LABEL[k]}
                  </option>
                ))}
              </select>
              <button className="smoky">Add</button>
            </form>
            <p className="studio__note">When two agents with history end up near each other, they'll have a moment.</p>
          </>
        )}
      </div>

      <footer className="studio__foot">
        <button className="smoky" onClick={() => resetAgent(id)}>
          Reset agent
        </button>
        <CastTools />
      </footer>
    </aside>
  );
}

/** Export / import the whole cast as JSON (back it up, share it, or hand-edit it). */
function CastTools() {
  const cast = useCast((s) => s.cast);
  const importCast = useCast((s) => s.importCast);
  const [msg, setMsg] = useState("");
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cast, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ceo-cast.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <span className="cast-tools">
      <button className="smoky" onClick={exportJson}>
        Export cast
      </button>
      <label className="smoky">
        Import
        <input
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setMsg(importCast(await f.text()) ? "Imported." : "That file isn't a C.E.O. cast.");
            e.target.value = "";
          }}
        />
      </label>
      {msg && <span className="tracked faint">{msg}</span>}
    </span>
  );
}

/** One entry per line; saved when you leave the box so blank lines don't sneak into the cast. */
function LinesField({ label, value, max, len, onCommit }: { label: string; value: string[]; max: number; len: number; onCommit: (v: string[]) => void }) {
  const [draft, setDraft] = useState(value.join("\n"));
  const commit = () => {
    const lines = draft
      .split("\n")
      .map((l) => l.trim().slice(0, len))
      .filter(Boolean)
      .slice(0, max);
    onCommit(lines);
    setDraft(lines.join("\n"));
  };
  return (
    <label className="field">
      <span className="eyebrow">{label}</span>
      <textarea rows={Math.min(max, Math.max(3, value.length + 1))} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    </label>
  );
}
