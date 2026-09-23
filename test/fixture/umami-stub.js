// A stand-in for Umami's tracker with the same contract: it reads its data attributes, applies the
// named before-send hook, and posts { type, payload } to <host-url>/api/send.
(() => {
  const script = document.currentScript;
  const config = (name) => script.getAttribute(`data-${name}`);
  const host = config("host-url");
  const send = async (payload, type = "event") => {
    const hook = window[config("before-send")];
    const final = typeof hook === "function" ? await hook(type, payload) : payload;
    if (!final) return;
    await fetch(`${host}/api/send`, {
      method: "POST",
      keepalive: true,
      body: JSON.stringify({ type, payload: final }),
      headers: { "Content-Type": "application/json" },
    });
  };
  // As in Umami 3.4.0: url is the absolute address; a same-origin referrer loses its origin.
  const normalize = (raw) => (raw ? new URL(raw, location.href).toString() : raw);
  const stripOrigin = (url) =>
    url === location.origin || url?.startsWith(`${location.origin}/`)
      ? url.slice(location.origin.length)
      : url;
  const base = () => ({
    website: config("website-id"),
    hostname: location.hostname,
    url: normalize(location.href),
    referrer: stripOrigin(normalize(document.referrer)),
    title: document.title,
    id: "should-be-removed",
  });
  window.umami = {
    track: (name, data) => send(name ? { ...base(), name, data } : base()),
    identify: (id) => send({ ...base(), id }, "identify"),
  };
  window.umamiStubAttributes = Object.fromEntries(
    script.getAttributeNames().map((name) => [name, script.getAttribute(name)]),
  );
  send(base());
})();
