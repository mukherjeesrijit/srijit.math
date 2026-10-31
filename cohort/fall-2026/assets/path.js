// The adaptive path (2026-10-30), kept quiet: nothing appears under a problem's buttons. At the bottom of every problem
// page, "Keep practising" (built into the page by build_site.py) shows problem cards: simpler problems, similar ones,
// a step up. For a signed-in learner this script only puts the right group first, says why in one line, and ticks what
// they've solved. Your record (your solutions with Srijit's grades, and "Stuck?") comes with the page's one request
// (/hello, want "path"); nothing else is asked of the server, except when you press "Stuck?". The home page's
// "Next for you" also needs the graph (/problems/graph.json, 27 KB), fetched only there and only when signed in.
// Srijit (the teacher) sees none of it.
(function () {
  const C = window.COHORT || {};
  const API = C.community, PAGES = C.problems || "/problems/";
  const more = document.querySelector("[data-more]"); // a problem page: "Keep practising"
  const home = document.querySelector("[data-path]"); // the home page: "Next for you"
  const actions = document.querySelector(".actions");
  const here = actions && actions.dataset.slug;
  const stuckBtn = actions && actions.querySelector("[data-stuck]");
  if (!API || !(more || home || stuckBtn)) return;
  const auth = window.srijitAuth;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };

  let solved = {}, stuck = new Set(), ready = false; // id -> Srijit's grade (null until graded); ids marked "Stuck?"
  const isStuck = (id) => stuck.has(id) && !(id in solved);

  // -- a problem page: which group first, and why ------------------------------------------------------------
  // Stuck, or graded 0-3: simpler first. Graded 4-6: similar first. Graded 7-10: a step up first. Otherwise the order
  // stays simpler, similar, step up, with no line.
  function plan(id) {
    const g = solved[id];
    if (isStuck(id)) return ["simpler", "Stuck? Start with a simpler problem that leads here."];
    if (!(id in solved) || g == null) return [null, ""];
    if (g >= 7) return ["harder", `Srijit gave you ${g}/10 here. Ready for a step up.`];
    if (g >= 4) return ["similar", `Srijit gave you ${g}/10 here. A similar problem will make it stick.`];
    return ["simpler", `Srijit gave you ${g}/10 here. A simpler problem first, then try this one again.`];
  }
  function paintMore() {
    if (!more || !ready) return;
    const [first, why] = plan(here);
    const groups = [...more.querySelectorAll(".group")];
    groups.forEach((g) => { g.style.order = g.dataset.g === first ? "-1" : ""; g.classList.toggle("first", g.dataset.g === first); });
    const line = more.querySelector("[data-why]");
    line.textContent = why; line.hidden = !why;
    more.querySelectorAll(".pcard").forEach((a) => {
      const id = a.dataset.p, g = solved[id];
      a.classList.toggle("done", id in solved);
      let tag = a.querySelector(".tag");
      const text = id in solved ? (g == null ? "✓ solved" : `✓ ${g}/10`) : isStuck(id) ? "stuck" : "";
      if (text && !tag) { tag = document.createElement("span"); tag.className = "tag"; a.appendChild(tag); }
      if (tag) { tag.textContent = text; tag.hidden = !text; }
    });
  }
  function paintStuck() {
    if (!stuckBtn) return;
    const on = stuck.has(here);
    stuckBtn.classList.toggle("on", on); stuckBtn.setAttribute("aria-pressed", String(on));
    stuckBtn.textContent = on ? "Stuck ✓" : "Stuck?";
  }

  // -- the home page: "Next for you" ---------------------------------------------------------------------------
  let G = null;
  function nextForYou() {
    const leadsTo = {};
    Object.keys(G).forEach((id) => G[id].a.forEach((x) => { (leadsTo[x] = leadsTo[x] || []).push(id); }));
    const done = (id) => id in solved && (solved[id] == null || solved[id] >= 5);
    const open = (id) => G[id] && !done(id) && !isStuck(id);
    const byEase = (a, b) => G[a].d - G[b].d || (G[a].o ?? 1e9) - (G[b].o ?? 1e9);
    const course = Object.keys(G).filter((x) => G[x].o != null).sort((a, b) => G[a].o - G[b].o);
    const items = [], seen = new Set();
    const add = (x, why) => { if (x && !seen.has(x)) { seen.add(x); items.push([x, why]); } };
    const tried = Object.keys(G).filter((id) => id in solved || stuck.has(id));
    tried.filter((id) => isStuck(id) || (solved[id] != null && solved[id] <= 3))
      .forEach((id) => add(G[id].a.filter(open).sort(byEase)[0], `simpler, before ${G[id].t}`));
    add(course.find(open), tried.length ? "next in the course" : "start here");
    tried.filter((id) => solved[id] != null && solved[id] >= 7)
      .forEach((id) => add((leadsTo[id] || []).filter(open).sort(byEase)[0], `a step up from ${G[id].t}`));
    if (!items.length) return;
    const dots = (d) => `<span class="dots" title="difficulty ${d} of 3">${"●".repeat(d)}${"○".repeat(3 - d)}</span>`;
    home.innerHTML = `<h2>${tried.length ? "Next for you" : "Where to start"}</h2><div class="cards">${items.slice(0, 3).map(([x, why]) =>
      `<a class="pcard" href="${PAGES}${encodeURIComponent(x)}/"><b>${esc(G[x].t)}</b><span class="meta">${dots(G[x].d)} ${esc(why)}</span></a>`).join("")}</div>`;
    home.hidden = false;
  }

  if (stuckBtn) stuckBtn.addEventListener("click", async () => {
    if (!(auth && auth.token())) return auth && auth.signIn();
    const on = !stuck.has(here);
    stuckBtn.disabled = true;
    try {
      const r = await fetch(API + "/stuck", { method: "POST", body: JSON.stringify({ problem: here, on }),
        headers: { "content-type": "application/json", authorization: "Bearer " + auth.token() } }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      on ? stuck.add(here) : stuck.delete(here);
      ready = true; paintStuck(); paintMore();
      if (on) toast(more && more.querySelector('[data-g="simpler"]') ? "Simpler problems that lead here are at the bottom of the page."
        : "Noted. Try the similar problems at the bottom of the page.");
    } catch (err) { toast(err.message === "resting" ? "The site is taking a short break. Please try again in a little while." : "Couldn't save that. Please try again."); }
    finally { stuckBtn.disabled = false; }
  });

  (window.cohortHello || Promise.resolve(null)).then((hello) => {
    if (!(hello && hello.signedIn && hello.path)) return; // signed out: the cards stay as built
    if (hello.me && hello.me.owner) { if (stuckBtn) stuckBtn.hidden = true; return; } // the teacher
    hello.path.solved.forEach((r) => { solved[r.p] = r.g; });
    stuck = new Set(hello.path.stuck);
    ready = true; paintStuck(); paintMore();
    if (home) return fetch(PAGES + "graph.json?v=" + (C.v || "")).then((r) => r.json()).then((g) => { G = g; nextForYou(); });
  }).catch(() => { /* the page works without it */ });
})();
