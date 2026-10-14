// The builder guard's rules (#119, R1 in docs/THREAT-MODEL.md): pure functions, no I/O, so they can be unit tested
// (guard.test.mjs). `guard-bash.mjs` runs them before every Bash call and every file tool; `log-tool.mjs` uses
// `summarize` and `redact` for the local tool-call log.
//
// This is a short deny list for clearly risky commands, not a sandbox: it stops slips and talked-into mistakes,
// and the crew's normal work (npm scripts, feature-branch git, gh reads, PRs and merges, worktrees, node scripts)
// passes untouched. To add a rule, add a check to `RULES` below with blocked and allowed examples in the test.

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const STDIN_INTERPRETERS = new Set(["python", "python3", "node", "perl", "ruby"]);
const WRAPPERS = new Set(["sudo", "command", "nohup", "time", "exec", "builtin"]);
const MAIN = new Set(["main", "master"]);

// ---------------------------------------------------------------------------------------------------------------
// A small shell reader: enough of POSIX sh to split a command line into simple commands without being fooled by
// quotes, operators run together, extra spaces or line continuations.

/**
 * Takes heredoc bodies out of a command line, so a commit message or a file written with `cat <<'EOF'` isn't read as
 * commands. A heredoc fed to a shell (`bash <<EOF`) is code, so its body is returned to be checked.
 * @param {string} src
 * @returns {{ text: string, scripts: string[] }}
 */
export function extractHeredocs(src) {
  const scripts = [];
  let text = src;
  let from = 0;
  const re = /<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_.-]*)\2/g;
  for (;;) {
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) break;
    if (text[m.index - 1] === "<" || text[m.index + 2] === "<") {
      from = m.index + 3;
      continue;
    }
    const nl = text.indexOf("\n", m.index);
    if (nl === -1) break;
    const lines = text.slice(nl + 1).split("\n");
    const endAt = lines.findIndex((l) => (m[1] ? l.replace(/^\t+/, "") : l) === m[3]);
    const bodyLines = endAt === -1 ? lines : lines.slice(0, endAt);
    const body = bodyLines.join("\n");
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const head = text.slice(lineStart, m.index);
    if (/(^|[\s|;&(])(sudo\s+)?(ba|z|da|k)?sh(\s+-s)?\s*$/.test(head)) scripts.push(body);
    const rest = endAt === -1 ? "" : lines.slice(endAt).join("\n");
    text = `${text.slice(0, nl + 1)}${rest}`;
    from = nl + 1;
  }
  return { text, scripts };
}

/**
 * Pulls out `$( )`, `<( )`, `>( )` and backtick bodies (outside single quotes) and puts a placeholder word in their
 * place, so each body can be checked as a command of its own.
 * @param {string} src
 * @returns {{ text: string, subs: { kind: string, body: string }[] }}
 */
export function extractSubstitutions(src) {
  const subs = [];
  let out = "";
  let i = 0;
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    if (quote === "'") {
      out += c;
      if (c === "'") quote = "";
      i++;
      continue;
    }
    if (c === "\\") {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'" && !quote) {
      quote = "'";
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      quote = quote === '"' ? "" : '"';
      out += c;
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "$(" || ((two === "<(" || two === ">(") && !quote)) {
      let depth = 1;
      let j = i + 2;
      let q = "";
      while (j < src.length && depth > 0) {
        const d = src[j];
        if (q) {
          if (d === q) q = "";
          else if (d === "\\" && q === '"') j++;
        } else if (d === "'" || d === '"') q = d;
        else if (d === "\\") j++;
        else if (d === "(") depth++;
        else if (d === ")") depth--;
        j++;
      }
      subs.push({ kind: two, body: src.slice(i + 2, depth === 0 ? j - 1 : j) });
      out += ` __SUB${subs.length - 1}__ `;
      i = j;
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      const stop = end === -1 ? src.length : end;
      subs.push({ kind: "`", body: src.slice(i + 1, stop) });
      out += ` __SUB${subs.length - 1}__ `;
      i = stop + 1;
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, subs };
}

/**
 * Splits a command line (substitutions already pulled out) into simple commands. Each one has its words (quotes
 * removed), the files it redirects to or from, and the operator that joined it to the one before.
 * @param {string} src
 * @returns {{ words: string[], redirects: string[], op: string }[]}
 */
export function splitCommands(src) {
  const cmds = [];
  let cur = { words: [], redirects: [], op: "" };
  let word = "";
  let inWord = false;
  let quote = "";
  let redirectNext = false;

  const endWord = () => {
    if (!inWord) return;
    if (redirectNext) cur.redirects.push(word);
    else cur.words.push(word);
    redirectNext = false;
    word = "";
    inWord = false;
  };
  const endCmd = (op) => {
    endWord();
    if (cur.words.length || cur.redirects.length) cmds.push(cur);
    cur = { words: [], redirects: [], op };
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < src.length) word += src[++i];
      else word += c;
      continue;
    }
    if (c === "\\") {
      if (src[i + 1] === "\n") i++;
      else if (i + 1 < src.length) {
        word += src[++i];
        inWord = true;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    if (c === "#" && !inWord) {
      while (i + 1 < src.length && src[i + 1] !== "\n") i++;
      continue;
    }
    if (c === "\n" || c === ";" || c === "(" || c === ")" || c === "{" || c === "}") {
      // Braces only group when they stand alone; `${HOME}` stays one word.
      if ((c === "{" || c === "}") && inWord) {
        word += c;
        continue;
      }
      endCmd(";");
      continue;
    }
    if (c === "&") {
      if (src[i + 1] === "&") {
        endCmd("&&");
        i++;
      } else if (src[i - 1] === ">" || src[i + 1] === ">") {
        // `2>&1`, `&>file`: part of a redirect.
        if (src[i + 1] === ">") {
          endWord();
          redirectNext = true;
          i++;
        }
      } else endCmd("&");
      continue;
    }
    if (c === "|") {
      if (src[i + 1] === "|") {
        endCmd("||");
        i++;
      } else {
        endCmd("|");
        if (src[i + 1] === "&") i++;
      }
      continue;
    }
    if (c === ">" || c === "<") {
      // Drop a file descriptor number written right before it (`2>`).
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      }
      endWord();
      while (src[i + 1] === ">" || src[i + 1] === "<") i++;
      if (src[i + 1] === "&") {
        // `>&2`: a descriptor, not a file.
        i++;
        while (/\d|-/.test(src[i + 1] ?? "")) i++;
        continue;
      }
      redirectNext = true;
      continue;
    }
    word += c;
    inWord = true;
  }
  endCmd("");
  return cmds;
}

/** The words of a simple command with leading `VAR=value` assignments and wrappers like `sudo` taken off. */
function stripPrefix(words) {
  let w = words;
  for (;;) {
    if (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1);
    else if (w.length && WRAPPERS.has(w[0])) {
      w = w.slice(1);
      while (w.length && w[0].startsWith("-")) w = w.slice(1);
    } else if (w.length > 1 && w[0] === "env" && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[1]) || w[1] === "-i" || w[1] === "-u")) {
      // `env FOO=1 cmd` runs cmd; a bare `env` is a dump and is left for the secrets rule.
      w = w.slice(1);
      while (w.length && (w[0] === "-i" || w[0] === "-u" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w = w.slice(w[0] === "-u" ? 2 : 1);
    } else return w;
  }
}

const base = (p) => (p ?? "").split("/").pop() ?? "";

// ---------------------------------------------------------------------------------------------------------------
// Paths

/** Expands `~`, `$HOME` and `${HOME}` at the start of a path. */
function expandHome(p, home) {
  return p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
}

/** A plain absolute resolve, without touching the disk. */
function resolvePath(p, cwd) {
  const parts = (p.startsWith("/") ? p : `${cwd}/${p}`).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

const isAncestorOrSelf = (a, b) => a === "/" || b === a || b.startsWith(`${a}/`);

/**
 * Files whose contents are keys or tokens: `.env` files (not the example), SSH and cloud credentials, private keys,
 * and the GitHub CLI's and npm's token files.
 * @param {string} p
 */
export function isSecretPath(p) {
  if (!p || /\s/.test(p)) return false;
  const name = base(p.replace(/\/+$/, ""));
  if (/^\.env(\..+)?$/.test(name) && !/^\.env\.(example|sample|template|dist)$/.test(name)) return true;
  if (/(^|\/)\.(ssh|aws|gnupg)(\/|$)/.test(p) || /^(~|\$HOME|\$\{HOME\})?\/?\.(ssh|aws|gnupg)$/.test(p)) return true;
  if (/\.(pem|p12|pfx)$/i.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return true;
  if (/^\.(netrc|git-credentials|npmrc|pypirc)$/.test(name)) return true;
  if (/(^|\/)\.config\/gh\/hosts\.ya?ml$/.test(p) || /(^|\/)\.docker\/config\.json$/.test(p)) return true;
  if (/(^|\/)\.config\/gcloud(\/|$)/.test(p)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// The rules. Each takes one simple command (`argv` after prefixes, the whole command list and its index, and the
// context) and returns a reason when it blocks.

/** `rm -r` on `/`, the home folder, the repo root or anything above it. */
function rmRule({ argv, ctx }) {
  if (base(argv[0]) !== "rm") return null;
  const flags = argv.slice(1).filter((a) => a.startsWith("-") && a !== "--");
  const recursive = flags.some((f) => f === "--recursive" || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)));
  if (flags.includes("--no-preserve-root")) return "rm with --no-preserve-root";
  if (!recursive) return null;
  const end = argv.indexOf("--");
  const targets = argv.slice(1).filter((a, i) => (end !== -1 && i + 1 > end) || !a.startsWith("-"));
  const roots = [ctx.projectDir, ctx.cwd].filter(Boolean);
  for (const t of targets) {
    if (!t) continue;
    const trimmed = t.replace(/(\/\*|\*)$/, "") || (t.startsWith("/") ? "/" : ".");
    const abs = resolvePath(expandHome(trimmed, ctx.home), ctx.cwd);
    if (abs === "/" || abs === resolvePath(ctx.home, "/")) return `rm -r on ${t}`;
    if (roots.some((r) => isAncestorOrSelf(abs, r))) return `rm -r on ${t} (the repo or a folder above it)`;
  }
  return null;
}

/** `git push` that lands on main or master, or pushes everything at once. */
function gitPushRule({ argv, ctx }) {
  if (base(argv[0]) !== "git") return null;
  let i = 1;
  let dir = ctx.cwd;
  while (i < argv.length && argv[i].startsWith("-")) {
    if (argv[i] === "-C") dir = resolvePath(argv[i + 1] ?? ".", ctx.cwd);
    if (argv[i] === "-C" || argv[i] === "-c" || argv[i] === "--git-dir" || argv[i] === "--work-tree") i++;
    i++;
  }
  if (argv[i] !== "push") return null;
  const args = argv.slice(i + 1);
  if (args.some((a) => a === "--mirror" || a === "--all")) return "git push --mirror/--all (would push main)";
  const positional = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--push-option" || a === "--repo" || a === "--receive-pack" || a === "--exec") k++;
    else if (!a.startsWith("-")) positional.push(a);
  }
  const refspecs = positional.slice(1);
  const branchOf = (name) => {
    let n = name.replace(/^\+/, "");
    if (n === "HEAD" || n === "@") n = ctx.currentBranch?.(dir) ?? "";
    return n.replace(/^refs\/heads\//, "");
  };
  if (refspecs.length === 0) {
    const b = ctx.currentBranch?.(dir);
    return b && MAIN.has(b) ? `git push from ${b}` : null;
  }
  for (const spec of refspecs) {
    const dst = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    const target = branchOf(dst || spec.slice(0, spec.indexOf(":")));
    if (MAIN.has(target)) return `git push to ${target}`;
  }
  return null;
}

/** `curl … | sh` and friends: something fetched from the network run as code. */
function pipeToShellRule({ argv, cmds, index, subs }) {
  const prog = base(argv[0]);
  const fetches = (body) => {
    const first = splitCommands(extractSubstitutions(body).text)[0];
    return first ? ["curl", "wget"].includes(base(stripPrefix(first.words)[0])) : false;
  };
  const subOf = (w) => {
    const m = /__SUB(\d+)__/.exec(w);
    return m ? subs[Number(m[1])] : undefined;
  };
  // bash <(curl …), source <(curl …), sh -c "$(curl …)", eval "$(curl …)"
  if (SHELLS.has(prog) || prog === "source" || prog === "." || prog === "eval") {
    for (const w of argv.slice(1)) {
      const sub = subOf(w);
      if (sub && fetches(sub.body)) return `${prog} running code fetched with curl or wget`;
    }
  }
  if (cmds[index].op !== "|") return null;
  const args = argv.slice(1);
  const readsStdin = SHELLS.has(prog)
    ? !args.includes("-c") && (args.includes("-s") || args.every((a) => a.startsWith("-") || a === "-"))
    : STDIN_INTERPRETERS.has(prog) && args.every((a) => a === "-" || (a.startsWith("-") && !["-c", "-e", "-p", "--eval", "--print"].includes(a)));
  if (!readsStdin) return null;
  for (let k = index - 1; k >= 0; k--) {
    const up = stripPrefix(cmds[k].words);
    if (["curl", "wget"].includes(base(up[0]))) return `${base(up[0])} piped into ${prog}`;
    if (cmds[k].op !== "|") break;
  }
  return null;
}

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIALS?|AUTH)/i;

/** Dumping the environment, echoing a secret-named variable, or touching a key file. */
function secretsRule({ argv, cmd }) {
  const prog = base(argv[0]);
  const args = argv.slice(1);
  if (prog === "env" && args.every((a) => a.startsWith("-"))) return "env dump (prints every secret in the environment)";
  if (prog === "printenv" && (args.length === 0 || args.some((a) => SECRET_NAME.test(a)))) return "printenv of secrets";
  if (prog === "export" && (args.length === 0 || args.every((a) => a === "-p"))) return "export dump (prints the environment)";
  if (prog === "set" && args.length === 0) return "set dump (prints the environment)";
  if ((prog === "echo" || prog === "printf") && args.some((a) => /\$\{?[A-Za-z_]*/.test(a) && /\$\{?[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE_?KEY)/i.test(a)))
    return `${prog} of a secret variable`;
  if (prog === "gh" && args[0] === "auth" && (args[1] === "token" || args.includes("--show-token") || args.includes("-t"))) return "gh auth token (prints the GitHub token)";
  if (["ls", "test", "["].includes(prog)) return null;
  // A grep or rg pattern isn't a path.
  let skipFirst = ["grep", "egrep", "fgrep", "rg"].includes(prog) && !args.some((a) => a === "-e" || a === "-f" || a.startsWith("--regexp"));
  for (const a of [...args, ...cmd.redirects]) {
    if (skipFirst && !a.startsWith("-")) {
      skipFirst = false;
      continue;
    }
    const value = a.startsWith("-") && a.includes("=") ? a.slice(a.indexOf("=") + 1) : a.replace(/^@/, "");
    if (isSecretPath(value)) return `touches a secrets file (${value})`;
  }
  return null;
}

// GitHub API paths that change who can push, what protects main, or the repo's keys and settings.
const ADMIN_PATH =
  /(^|\/)repos\/[^/\s]+\/[^/\s?]+\/(rulesets|branches\/[^/\s]+\/protection|actions\/(secrets|variables|permissions)|dependabot\/secrets|codespaces\/secrets|environments|collaborators|invitations|keys|hooks|teams|transfer|git\/refs\/heads\/(main|master))([/?]|$)/;
const ORG_ADMIN = /(^|\/)orgs\/[^/\s]+\/(rulesets|actions\/(secrets|variables|permissions)|members|memberships|teams|hooks|invitations)([/?]|$)/;

function isAdminWrite(path, method) {
  const m = (method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return false;
  const p = path.replace(/^https?:\/\/api\.github\.com/, "").replace(/^\//, "");
  const repoOnly = /^repos\/[^/\s]+\/[^/\s?]+\/?(\?|$)/.test(p);
  if (repoOnly) return m === "PATCH" || m === "DELETE" || m === "PUT";
  return ADMIN_PATH.test(p) || ORG_ADMIN.test(p);
}

/** gh and curl calls that change rulesets, branch protection, secrets, collaborators or repo settings. */
function githubAdminRule({ argv }) {
  const prog = base(argv[0]);
  const args = argv.slice(1);
  if (prog === "gh") {
    const [sub, action] = args;
    if (sub === "secret" && action !== "list") return "gh secret changes";
    if (sub === "variable" && ["set", "delete"].includes(action)) return "gh variable changes";
    if (sub === "repo" && ["edit", "delete", "rename", "archive", "unarchive", "deploy-key"].includes(action)) return `gh repo ${action}`;
    if (sub === "ruleset" && !["list", "ls", "view", "check"].includes(action)) return "gh ruleset changes";
    if (sub !== "api") return null;
    let method = "";
    let hasBody = false;
    let path = "";
    for (let k = 1; k < args.length; k++) {
      const a = args[k];
      if (a === "-X" || a === "--method") method = args[++k] ?? "";
      else if (a.startsWith("--method=")) method = a.slice(9);
      else if (/^-X./.test(a)) method = a.slice(2);
      else if (["-f", "-F", "--field", "--raw-field", "--input"].includes(a)) {
        hasBody = true;
        k++;
      } else if (["-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview"].includes(a)) k++;
      else if (!a.startsWith("-") && !path) path = a;
    }
    if (isAdminWrite(path, method || (hasBody ? "POST" : "GET"))) return `gh api ${(method || "POST").toUpperCase()} on ${path} (repo settings, protection, secrets or access)`;
    return null;
  }
  if (prog === "curl") {
    let method = "";
    let hasBody = false;
    const urls = [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a === "-X" || a === "--request") method = args[++k] ?? "";
      else if (/^-X./.test(a)) method = a.slice(2);
      else if (/^(-d|--data.*|-F|--form|--json)$/.test(a)) {
        hasBody = true;
        k++;
      } else if (a === "-T" || a === "--upload-file") {
        method ||= "PUT";
        k++;
      } else if (/^-[HoAeuwbcEr]$|^--(header|output|user-agent|referer|user|write-out|cookie|max-time|connect-timeout|retry)$/.test(a)) k++;
      else if (/api\.github\.com/.test(a)) urls.push(a);
    }
    const m = method || (hasBody ? "POST" : "GET");
    const hit = urls.find((u) => isAdminWrite(u.replace(/^https?:\/\/api\.github\.com/, ""), m));
    if (hit) return `curl ${m.toUpperCase()} to GitHub's settings, protection, secrets or access`;
  }
  return null;
}

/** Publishing a package to a registry. */
function publishRule({ argv }) {
  const prog = base(argv[0]);
  if (!["npm", "pnpm", "yarn"].includes(prog)) return null;
  const sub = argv.slice(1).find((a) => !a.startsWith("-"));
  return sub === "publish" || sub === "unpublish" ? `${prog} ${sub}` : null;
}

/** `chmod -R 777` and its spellings. */
function chmodRule({ argv }) {
  if (base(argv[0]) !== "chmod") return null;
  const args = argv.slice(1);
  const recursive = args.some((a) => a === "--recursive" || (/^-[a-zA-Z]+$/.test(a) && a.includes("R")));
  const open = args.some((a) => /^0?777$/.test(a) || /^(a|ugo|o)\+rwx$/.test(a));
  return recursive && open ? "chmod -R 777" : null;
}

export const RULES = [rmRule, gitPushRule, pipeToShellRule, secretsRule, githubAdminRule, publishRule, chmodRule];

/**
 * Checks one Bash command line. Returns the reason to block it, or null to let it run.
 * `ctx`: `{ cwd, home, projectDir, currentBranch(dir) }`; `currentBranch` may return null when it can't tell.
 * @param {string} command
 * @param {{ cwd: string, home: string, projectDir?: string, currentBranch?: (dir: string) => string | null }} ctx
 * @returns {string | null}
 */
export function checkCommand(command, ctx, depth = 0) {
  if (typeof command !== "string" || !command.trim() || depth > 4) return null;
  const heredocs = extractHeredocs(command);
  for (const script of heredocs.scripts) {
    const inner = checkCommand(script, ctx, depth + 1);
    if (inner) return inner;
  }
  const { text, subs } = extractSubstitutions(heredocs.text);
  const cmds = splitCommands(text);
  for (const [index, cmd] of cmds.entries()) {
    const argv = stripPrefix(cmd.words);
    if (argv.length === 0) {
      for (const r of cmd.redirects) if (isSecretPath(r)) return `touches a secrets file (${r})`;
      continue;
    }
    for (const rule of RULES) {
      const reason = rule({ argv, cmd, cmds, index, subs, ctx });
      if (reason) return reason;
    }
    // Code handed to a shell or eval is checked as a command too.
    const prog = base(argv[0]);
    if (SHELLS.has(prog)) {
      const c = argv.indexOf("-c");
      if (c !== -1 && argv[c + 1]) {
        const inner = checkCommand(restore(argv[c + 1], subs), ctx, depth + 1);
        if (inner) return inner;
      }
    } else if (prog === "eval") {
      const inner = checkCommand(restore(argv.slice(1).join(" "), subs), ctx, depth + 1);
      if (inner) return inner;
    }
  }
  for (const s of subs) {
    const inner = checkCommand(s.body, ctx, depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** Puts substitution bodies back in place of their placeholders. */
function restore(text, subs) {
  return text.replace(/__SUB(\d+)__/g, (_, n) => {
    const s = subs[Number(n)];
    if (!s) return "";
    return s.kind === "`" ? `\`${s.body}\`` : `${s.kind}${s.body})`;
  });
}

/**
 * Checks a file tool's path (Read, Edit, Write, NotebookEdit, Grep, Glob): key and token files are off limits.
 * @param {string} tool
 * @param {Record<string, unknown>} input
 * @returns {string | null}
 */
export function checkFileTool(tool, input) {
  if (!input || typeof input !== "object") return null;
  for (const key of ["file_path", "notebook_path", "path"]) {
    const v = input[key];
    if (typeof v === "string" && isSecretPath(v)) return `${tool} on a secrets file (${base(v)})`;
  }
  if (tool === "Glob" && typeof input.pattern === "string" && isSecretPath(input.pattern)) return `Glob for secrets files (${input.pattern})`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The tool-call log: what was called, never what it read or returned.

/** Masks things that look like keys or tokens. */
export function redact(text) {
  return String(text)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}/g, "[redacted]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(authorization|x-api-key|api-key|cookie)\s*:\s*[^"'\n]+/gi, "$1: [redacted]")
    .replace(/\b(bearer|token|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@")
    .replace(/([?&](?:[a-z_]*(?:token|key|secret|sig|signature|password|code)))=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, "$1=[redacted]")
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, (m) => (m.length === 40 ? m : "[redacted]"))
    .replace(/\b[A-Za-z0-9+/_-]{48,}={0,2}/g, "[redacted]");
}

const cut = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * A short line saying what a tool call was about: the command for Bash, a path or pattern for the file tools, the
 * description for agents. Never file contents, edits, prompts or output.
 * @param {string} tool
 * @param {Record<string, unknown>} input
 */
export function summarize(tool, input) {
  const s = (v) => (typeof v === "string" ? v : "");
  const i = input && typeof input === "object" ? input : {};
  let text = "";
  if (tool === "Bash") text = s(i.command).replace(/\s+/g, " ").trim();
  else if (["Read", "Edit", "Write", "MultiEdit"].includes(tool)) text = s(i.file_path);
  else if (tool === "NotebookEdit") text = s(i.notebook_path);
  else if (tool === "Grep" || tool === "Glob") text = [s(i.pattern), s(i.path)].filter(Boolean).join(" in ");
  else if (tool === "WebFetch") text = s(i.url).replace(/[?#].*$/, "");
  else if (tool === "WebSearch") text = s(i.query);
  else if (tool === "Agent" || tool === "Task") text = s(i.description);
  else if (tool === "Skill") text = s(i.skill);
  return cut(redact(cut(text, 400)));
}
