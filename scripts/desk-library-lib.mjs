// The Desk's library for Skippy (#1141): the repo's public docs and lore, split into sections by heading, each with an
// id and a title, written at every install and build into api/_skippy/deskIndex.ts (not committed, like
// stackDeps.ts). Skippy searches it with desk_lookup and reads one section with desk_read (api/_skippy/desk.ts), on
// every surface, Talk calls included.
//
// What it reads, and only this (all of it committed and public): docs/*.md, lore/*.md, README.md, CLAUDE.md, each
// room's manifest (rooms/<id>/room.ts, its nav name and its tools' titles), and the simulator's dossiers
// (packages/simulator/src/lore.ts) and cast (cast.ts, agents.ts, subminds.ts). Never kb/, never /mnt, never anything
// outside the repo.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The most one section keeps; a longer one is cut into parts at paragraph breaks ("… (part 2)"). */
export const PART_MAX = 2_400;
/** The longest id. */
export const ID_MAX = 56;

const read = (root, path) => {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return "";
  }
};
const list = (root, dir) => {
  try {
    return readdirSync(join(root, dir)).sort();
  } catch {
    return [];
  }
};

/** Never read: private notes, mounts, and anything outside the repo. */
export function allowed(root, path) {
  const rel = relative(root, join(root, path)).split(sep).join("/");
  return !!rel && !rel.startsWith("..") && !/^(?:kb|mnt)(?:\/|$)/.test(rel) && !rel.startsWith("/");
}

export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[`*_~[\]()#'"’.,:;!?/\\&+|<>{}=]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Markdown to plain prose: no code blocks, no images, link text without its target, no emphasis marks. */
export function plainMarkdown(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts a long text into parts of at most `max` characters, at paragraph (else sentence) breaks. */
export function parts(text, max = PART_MAX) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = "";
  const pieces = text.split(/\n\n+/).flatMap((p) => (p.length <= max ? [p] : p.match(new RegExp(`[^]{1,${max - 1}}(?:[.!?](?=\\s)|$)|[^]{1,${max}}`, "g")) ?? [p]));
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > max) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** A markdown file's sections: one per heading (levels 1 to 4), titled "Doc › Heading", fenced code left out. */
export function markdownSections(text, source) {
  const lines = text.replace(/\r/g, "").split("\n");
  const doc = (lines.find((l) => /^#\s+\S/.test(l)) ?? `# ${source}`).replace(/^#\s+/, "").trim();
  const out = [];
  let heading = doc;
  let body = [];
  let fenced = false;
  const flush = () => {
    const prose = plainMarkdown(body.join("\n"));
    if (prose) out.push({ title: heading === doc ? doc : `${doc} › ${heading}`, source, text: prose });
    body = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      heading = plainMarkdown(h[2]);
      continue;
    }
    body.push(line);
  }
  flush();
  return out;
}

const STRING = /(?:\b(\w+)\s*:\s*)?("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\[)/g;
const unquote = (s) => {
  const inner = s.slice(1, -1);
  try {
    return s[0] === '"' ? JSON.parse(s) : inner.replace(/\\(.)/g, "$1");
  } catch {
    return inner;
  }
};
const codeLike = (v) => /^(?:[./@#]|--|https?:)/.test(v) || /^[\w-]+$/.test(v) || /\$\{/.test(v);

/**
 * A TypeScript data block as plain lines: each keyed string as "key: value", and the strings of an array after its
 * key, joined. Paths, colours, ids and template code are left out.
 */
export function tsText(block) {
  const lines = [];
  let last = null;
  for (const m of block.matchAll(STRING)) {
    const key = m[1];
    if (m[2] === "[") {
      // An array's key: its strings follow on its line.
      if (key) lines.push((last = { key, values: [] }));
      continue;
    }
    const value = unquote(m[2]).replace(/\s+/g, " ").trim();
    if (!value || (codeLike(value) && !(key && /^(?:name|title|use|kind|catchphrase)$/.test(key)))) continue;
    if (key) {
      last = { key, values: [value] };
      lines.push(last);
    } else if (last) last.values.push(value);
    else lines.push({ key: "", values: [value] });
  }
  return lines
    .filter((l) => l.values.length)
    .map((l) => (l.key ? `${l.key}: ${l.values.join("; ")}` : l.values.join("; ")))
    .join("\n");
}

/** A record literal's top-level entries (`  id: { … },` at two spaces), by id. */
export function entries(text, start) {
  const at = text.indexOf(start);
  if (at < 0) return {};
  const out = {};
  const re = /^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},?$/gm;
  re.lastIndex = at;
  const end = text.indexOf("\n};", at);
  for (let m = re.exec(text); m && (end < 0 || m.index < end); m = re.exec(text)) out[m[1]] = m[2];
  return out;
}

/** The leading doc comment of a file, as one line. */
const docComment = (text) => {
  const m = /\/\*\*([\s\S]*?)\*\//.exec(text);
  return m ? m[1].replace(/^\s*\* ?/gm, "").replace(/\s+/g, " ").trim() : "";
};

/** Each room's manifest: its name, what it does (purpose, its agents, its measure), its submind and its tools. */
export function roomSections(root) {
  const out = [];
  for (const id of list(root, "rooms")) {
    const manifest = read(root, `rooms/${id}/room.ts`);
    if (!manifest) continue;
    const name = /name:\s*"([^"]+)"/.exec(read(root, `rooms/${id}/nav.ts`))?.[1] ?? id;
    const tools = read(root, `rooms/${id}/tools.ts`);
    const toolLines = [...tools.matchAll(/name:\s*"(\w+)",\s*\n\s*room:[^\n]*\n\s*title:\s*"([^"]+)"/g)].map((m) => `${m[2]} (${m[1]})`);
    const sections = read(root, `rooms/${id}/sections.ts`);
    const tabs = sections ? [...sections.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
    const body = [
      docComment(manifest),
      tsText(manifest.replace(/^import[^\n]*\n/gm, "").replace(/\/\*\*[\s\S]*?\*\//, "")),
      tabs.length ? `Tabs: ${[...new Set(tabs)].join(", ")}` : "",
      toolLines.length ? `Skippy's tools here: ${toolLines.join("; ")}` : "",
      `Page: /${id === "today" ? "" : id}; manifest rooms/${id}/room.ts`,
    ].filter(Boolean);
    out.push({ key: `room ${id}`, title: `Room: ${name} (${id})`, source: `rooms/${id}/room.ts`, text: body.join("\n") });
  }
  return out;
}

/** The cast's names and jobs, by id (agents.ts, subminds.ts). */
export function castNames(root) {
  const names = {};
  const src = `${read(root, "packages/simulator/src/agents.ts")}\n${read(root, "packages/simulator/src/subminds.ts")}`;
  for (const m of src.matchAll(/\{\s*id:\s*"(\w+)",\s*name:\s*"([^"]+)"([^\n]*)/g)) {
    const role = /role:\s*"([^"]+)"/.exec(m[3])?.[1] ?? /job:\s*"([^"]+)"/.exec(m[3])?.[1] ?? "";
    const room = /room:\s*"(\w+)"/.exec(m[3])?.[1] ?? "";
    names[m[1]] = { name: m[2], role, room };
  }
  return names;
}

/** One dossier per agent: who they are (cast.ts), their history (lore.ts) and their relationships. */
export function dossierSections(root) {
  const lore = read(root, "packages/simulator/src/lore.ts");
  const cast = read(root, "packages/simulator/src/cast.ts");
  const names = castNames(root);
  const lores = entries(lore, "export const LORE");
  const seeds = entries(cast, "const SEEDS");
  const rels = [...cast.matchAll(/\{\s*a:\s*"(\w+)",\s*b:\s*"(\w+)",\s*kind:\s*"([\w-]+)"(?:,\s*note:\s*"((?:[^"\\]|\\.)*)")?/g)].map((m) => ({ a: m[1], b: m[2], kind: m[3], note: m[4] ? unquote(`"${m[4]}"`) : "" }));
  const who = (id) => (names[id] ? `${names[id].name} (${id})` : id);
  const out = [];
  for (const id of [...new Set([...Object.keys(lores), ...Object.keys(seeds)])]) {
    const n = names[id];
    const mine = rels.filter((r) => r.a === id || r.b === id).map((r) => `${r.kind} of ${who(r.a === id ? r.b : r.a)}${r.note ? `: ${r.note}` : ""}`);
    const text = [
      n ? `${n.name}${n.role ? `, ${n.role}` : ""}${n.room ? `, in the ${n.room}` : ""}.` : "",
      seeds[id] ? tsText(seeds[id]) : "",
      lores[id] ? tsText(lores[id]) : "",
      mine.length ? `Relationships: ${mine.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    out.push({ key: `dossier ${id}`, title: `Dossier: ${who(id)}`, source: "packages/simulator/src/lore.ts", text });
  }
  const skippy = /export const SKIPPY_LORE: Lore = \{\n([\s\S]*?)\n\};/.exec(lore)?.[1];
  if (skippy) out.push({ key: "dossier skippy", title: "Dossier: Skippy, the Magnificent", source: "packages/simulator/src/lore.ts", text: tsText(skippy) });
  return out;
}

/** Every section the library holds, in a fixed order, with unique ids. */
export function deskSections(root) {
  const docs = [
    ...["README.md", "CLAUDE.md"],
    ...list(root, "docs").filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
    ...list(root, "lore").filter((f) => f.endsWith(".md")).map((f) => `lore/${f}`),
  ].filter((p) => allowed(root, p) && existsSync(join(root, p)));
  const raw = [...docs.flatMap((p) => markdownSections(read(root, p), p)), ...roomSections(root), ...dossierSections(root)];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const chunks = parts(s.text);
    chunks.forEach((text, i) => {
      const base = slug(s.key ?? `${s.source.replace(/^.*\//, "").replace(/\.(md|ts)$/, "")} ${s.title.replace(/^.*›\s*/, "")}`).slice(0, ID_MAX - 4).replace(/-+$/, "") || "section";
      let id = chunks.length > 1 ? `${base}-${i + 1}` : base;
      for (let k = 2; seen.has(id); k++) id = `${base}-${chunks.length > 1 ? `${i + 1}-` : ""}${k}`;
      seen.add(id);
      out.push({ id, title: chunks.length > 1 ? `${s.title} (part ${i + 1} of ${chunks.length})` : s.title, source: s.source, text });
    });
  }
  return out;
}

/** api/_skippy/deskIndex.ts: written at every install and build, not committed. */
export function renderDeskIndex(root) {
  const sections = deskSections(root);
  const rows = sections.map((s) => `  ${JSON.stringify([s.id, s.title, s.source, s.text])},`).join("\n");
  return `/**
 * The Desk's library for Skippy (#1141): the repo's public docs, lore, room manifests and dossiers, by section.
 * GENERATED by scripts/desk-library.mjs (scripts/desk-library-lib.mjs) at every install and build; not committed.
 * Searched by desk_lookup and read by desk_read (api/_skippy/desk.ts). Each row: id, title, source file, text.
 */

export const DESK_SECTIONS: readonly (readonly [id: string, title: string, source: string, text: string])[] = [
${rows}
];
`;
}
