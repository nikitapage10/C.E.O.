// The installer the site serves carries the hub's SHA-256 inside it (#535, docs/RELAY-PRIVACY.md, "Access"), so the
// Mac checks the hub against a value that came with the script it is running, not a second file from the same place.

export const PLACEHOLDER = 'HUB_SHA256="__HUB_SHA256__"';

/** install.sh with the hub's hash stamped in; throws unless there is exactly one placeholder and a real hash. */
export function stampInstaller(script, sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("not a SHA-256");
  if (script.split(PLACEHOLDER).length !== 2) throw new Error("install.sh must hold exactly one HUB_SHA256 placeholder");
  return script.replace(PLACEHOLDER, `HUB_SHA256="${sha256}"`);
}
