import { z } from "zod";

/**
 * Zod 4 probes `new Function("")` to see whether it may compile parsers on the fly. The site's CSP forbids eval, so the
 * probe would raise a violation on every page; parsing without it is just as correct and plenty fast for our payloads.
 * Imported first by every module that builds a schema.
 */
z.config({ jitless: true });
