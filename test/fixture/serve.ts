import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { stripTypeScriptTypes } from "node:module";
import { privacyNotice } from "../../src/notice.ts";

/** A self-signed certificate, because the module only runs on HTTPS pages. */
function certificate() {
  const dir = "test-results/tls";
  if (!existsSync(`${dir}/key.pem`)) {
    mkdirSync(dir, { recursive: true });
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "30",
      "-subj",
      "/CN=127.0.0.1",
      "-keyout",
      `${dir}/key.pem`,
      "-out",
      `${dir}/cert.pem`,
    ]);
  }
  return { key: readFile(`${dir}/key.pem`), cert: readFile(`${dir}/cert.pem`) };
}

const config = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    websiteId: "00000000-0000-4000-8000-000000000000",
    collector: "https://stats.example.test",
    // The fixture's port is part of the host; production hosts have none.
    hostname: "127.0.0.1:4175",
    declaredEvents: ["theme-toggle"],
    ...overrides,
  });

const MODULE = '<script type="module" src="/analytics.js"></script>';

const layout = (title: string, body: string, tail = `${configTag()}\n${MODULE}`) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<main>${body}</main>
${tail}
</body>
</html>`;

function configTag(json = config()) {
  return `<script type="application/json" id="site-analytics">${json}</script>`;
}

const links = `<h1>Fixture</h1>
<p><a id="outbound" href="https://example.org/path?secret=1#frag">Outbound</a></p>
<p><a id="readme" href="https://github.com/x/y/blob/main/README.md">README</a></p>
<p><a id="download" href="/files/resume.pdf?v=2">PDF</a></p>
<p><a id="download-attr" href="/export" download>Export</a></p>
<p><a id="email" href="mailto:someone@example.com">Email</a></p>
<p><a id="internal" href="/other">Internal</a></p>
<p><button id="declared" data-analytics-event="theme-toggle" data-analytics-theme="dark">Declared</button></p>
<p><button id="leaky" data-analytics-event="note" data-analytics-who="bob@example.com">Leaky</button></p>
<p><button id="declared-bad" data-analytics-event="theme-toggle" data-analytics-theme="bob@example.com">Bad value</button></p>
<p><button id="declared-extra" data-analytics-event="theme-toggle" data-analytics-theme="dark" data-analytics-class="btn">Extra field</button></p>
<p><a id="declared-link" href="https://example.org/x?y=1" data-analytics-event="signup" data-analytics-plan="pro">Undeclared on a link</a></p>
<p><svg width="40" height="20"><a id="svg-link" href="https://example.net/svg"><text x="0" y="15">SVG</text></a></svg></p>
<p><svg width="40" height="20" xmlns:xlink="http://www.w3.org/1999/xlink"><a id="svg-xlink" xlink:href="https://example.net/xlink"><text x="0" y="15">XL</text></a></svg></p>
<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#map" width="20" height="20" alt="">
<map name="map"><area id="area" shape="rect" coords="0,0,20,20" href="https://example.com/area" alt="Area"></map></p>
<p><a id="umami-event" href="/other" data-umami-event="umami-own" data-umami-event-email="bob@example.com">Umami's own</a></p>
<div style="height: 4000px"></div>
<p id="end">End</p>
<script>
// Keep the fixture on this page: a click or middle click would otherwise follow the link.
for (const type of ["click", "auxclick"]) {
  document.addEventListener(type, (event) => { if (!event.target.closest("#umami-event")) event.preventDefault(); });
}
</script>`;

const noticeOptions = {
  site: "fixture.example",
  controller: { name: "Fixture Owner", email: "owner@example.com" },
  analytics: {
    websiteId: "00000000-0000-4000-8000-000000000000",
    collector: "https://stats.example.test",
    hostname: "fixture.example",
    declaredEvents: ["theme-toggle" as const],
  },
  hosting: "on a test server",
  country: "the United States",
  network: { name: "A Network", privacyUrl: "https://network.example/privacy" },
  retentionDays: 90,
  updated: "2026-09-22",
};

/** A second opt-out control, to check that controls stay in sync. */
const control = `<div data-analytics-opt-out hidden><p data-analytics-status role="status"></p><p><button type="button">Stop counting my visits</button></p></div>`;

/** Umami 3.4.0's tracker (MIT, see umami/LICENSE) with its build-time placeholders filled. */
const tracker = async () =>
  stripTypeScriptTypes(await readFile("test/fixture/umami/tracker.ts", "utf8"), { mode: "strip" })
    .replace("'__COLLECT_API_HOST__'", "''")
    .replace("__COLLECT_API_ENDPOINT__", "/api/send");

type Page = [string, () => Promise<string | Buffer>];
const html = (body: string): Page => ["text/html", async () => body];

const pages: Record<string, Page> = {
  "/": html(layout("Fixture home", links)),
  "/other": html(layout("Other", "<h1>Other</h1>")),
  "/undeclared": html(
    layout("Undeclared", links, `${configTag(config({ declaredEvents: [] }))}\n${MODULE}`),
  ),
  "/unlisted": html(
    layout("Unlisted", links, `${configTag(config({ declaredEvents: undefined }))}\n${MODULE}`),
  ),
  "/unknown-declared": html(
    layout(
      "Unknown declared",
      links,
      `${configTag(config({ declaredEvents: ["theme-toggle", "signup"] }))}\n${MODULE}`,
    ),
  ),
  "/people/alice@example.com/": html(layout("Alice alice@example.com", "<h1>Alice</h1>")),
  "/double": html(
    layout(
      "Double",
      "<h1>Double</h1>",
      `${configTag()}\n${MODULE}\n${MODULE.replace(".js", ".js?copy")}`,
    ),
  ),
  "/without-port": html(
    layout(
      "Without port",
      "<h1>Port</h1>",
      `${configTag(config({ hostname: "127.0.0.1" }))}\n${MODULE}`,
    ),
  ),
  "/spoofed": html(
    layout(
      "Spoofed",
      `<div id="site-analytics">${config({ collector: "https://evil.example" })}</div>`,
    ),
  ),
  "/bad-collector": html(
    layout(
      "Bad collector",
      "<h1>Bad</h1>",
      `${configTag(config({ collector: "data:text/javascript,window.pwned=1//" }))}\n${MODULE}`,
    ),
  ),
  "/privacy/": html(
    layout("Fixture privacy", `<h1>Privacy</h1>${privacyNotice(noticeOptions)}${control}`, MODULE),
  ),
  "/analytics.js": ["text/javascript", () => readFile("dist/analytics.js")],
  "/umami.js": ["text/javascript", tracker],
};

const port = Number(process.env.PORT ?? 4175);
const tls = certificate();
createServer({ key: await tls.key, cert: await tls.cert }, async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "https://localhost").pathname);
  const page = pages[path];
  if (!page) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": page[0] }).end(await page[1]());
}).listen(port, "127.0.0.1", () => console.log(`https://127.0.0.1:${port}/`));
