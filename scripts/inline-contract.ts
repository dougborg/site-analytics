/**
 * Inline `dist/contract.js` into `dist/analytics.js`, so the published browser module stays one
 * self-contained file that a site can copy into its assets without a bundler. Runs after `tsc`.
 */
import { readFile, writeFile } from "node:fs/promises";

const MODULE = "dist/analytics.js";
const IMPORT = /^import \{[^}]*\} from "\.\/contract\.js";\n/gm;
const IMPORT_OR_EXPORT = /^\s*(import|export)\b/m;

const [module, contract] = await Promise.all([
  readFile(MODULE, "utf8"),
  readFile("dist/contract.js", "utf8"),
]);

const fail = (message: string) => {
  throw new Error(`inline-contract: ${message}`);
};

if (module.match(IMPORT)?.length !== 1) fail(`${MODULE} must import ./contract.js exactly once`);
const body = contract.replace(/^export /gm, "");
if (IMPORT_OR_EXPORT.test(body)) fail("contract.ts must not import or re-export anything");

const inlined = module.replace(
  IMPORT,
  () => `// Inlined from ./contract.js at build time.\n${body}\n`,
);
const rest = inlined.replace(/^export \{\};\n?/m, "");
if (IMPORT_OR_EXPORT.test(rest)) fail(`${MODULE} still imports or exports something`);
// Stay an ES module, so top-level names are scoped to the module rather than the page.
await writeFile(MODULE, `${rest.trimEnd()}\nexport {};\n`);
