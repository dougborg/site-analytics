import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { privacyNotice } from "../../src/notice.ts";

const config = JSON.stringify({
  websiteId: "00000000-0000-4000-8000-000000000000",
  collector: "https://stats.example.test",
  hostname: "127.0.0.1",
});

const layout = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<main>${body}</main>
<script type="application/json" id="site-analytics">${config}</script>
<script type="module" src="/analytics.js"></script>
</body>
</html>`;

const home = layout(
  "Fixture home",
  `<h1>Fixture</h1>
<p><a id="outbound" href="https://example.org/path?secret=1#frag">Outbound</a></p>
<p><a id="download" href="/files/resume.pdf">PDF</a></p>
<p><a id="download-attr" href="/export" download>Export</a></p>
<p><a id="email" href="mailto:someone@example.com">Email</a></p>
<p><a id="internal" href="/other">Internal</a></p>
<p><button id="declared" data-analytics-event="theme-toggle" data-analytics-theme="dark">Declared</button></p>
<div style="height: 4000px"></div>
<script>document.addEventListener("click", (event) => event.preventDefault());</script>`,
);

const privacy = layout(
  "Fixture privacy",
  `<h1>Privacy</h1>${privacyNotice({
    site: "fixture.example",
    controller: { name: "Fixture Owner", email: "owner@example.com" },
    collector: "https://stats.example.test",
    hosting: "on a test server",
    network: { name: "A Network", privacyUrl: "https://network.example/privacy" },
    retentionDays: 90,
    updated: "2026-09-22",
  })}`,
);

const pages: Record<string, [string, () => Promise<string | Buffer>]> = {
  "/": ["text/html", async () => home],
  "/privacy/": ["text/html", async () => privacy],
  "/analytics.js": ["text/javascript", () => readFile("dist/analytics.js")],
};

const port = Number(process.env.PORT ?? 4175);
createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const page = pages[path];
  if (!page) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": page[0] }).end(await page[1]());
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
