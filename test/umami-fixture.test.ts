import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * SHA-256 of `src/tracker/index.ts` at umami-software/umami tag v3.4.0 (commit ec0ff50), the
 * release the production collector runs. Changing the fixture means changing the supported Umami
 * version: see README "Compatibility".
 */
const UMAMI_3_4_0_TRACKER = "0684f4c6896f53695fe6c0ae1122f70f0e12e6e8a3d1ea21ad2556653525d6a7";

test("the browser tests run Umami 3.4.0's tracker, unchanged", async () => {
  const source = await readFile("test/fixture/umami/tracker.ts");
  assert.equal(createHash("sha256").update(source).digest("hex"), UMAMI_3_4_0_TRACKER);
});
