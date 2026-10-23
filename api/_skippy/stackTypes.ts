/** The shape of the generated stack sheet (api/_skippy/stack.ts, #312). Public facts only. */
export interface StackFacts {
  /** Languages the repo has code in, and the common server languages it has none of. */
  languages: { present: string[]; absent: string[] };
  /** package.json's engines range, the versions CI sets up (and .nvmrc), and the Azure Function App's runtime. */
  node: { engines: string; ci: string[]; azure: string | null };
  hosts: string[];
  /** The security gates CI runs. */
  checks: string[];
  /** Outside services the server code calls, by name. */
  services: string[];
  /** Database client packages in the lockfile; none means no database server. */
  databases: string[];
}

/** The lockfile's part of the sheet (api/_skippy/stackDeps.ts, written at install and build time). */
export interface StackDeps {
  /** Every workspace's own dependencies at their locked versions, "name version". */
  dependencies: { runtime: string[]; dev: string[] };
  lockfile: { packages: number; runtime: number };
}
