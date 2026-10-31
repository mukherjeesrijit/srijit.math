// The adaptive path (2026-10-30): what to solve next, from the problem graph and what you have done.
// The graph is a static file (/problems/graph.json, written by build_site.py from data/path.csv): for each public
// problem its title, difficulty (1-3), skills, the public problems it builds on, and its place in the cohort. Your record
// (your solutions with Srijit's grades, and "Stuck?") comes with the page's one request (/hello, want "path").
// Everything is worked out here in the browser: the server is asked nothing more, except when you press "Stuck?".
(function () {
  const C = window.COHORT || {};
  const API = C.community, PAGES = C.problems || "/problems/";
  const box = document.querySelector("[data-next]"); // a problem page: suggestions for this problem
  const home = document.querySelector("[data-path]"); // the home page: where to go next overall
  const actions = document.querySelector(".actions");
  const here = actions && actions.dataset.slug;
  const stuckBtn = actions && actions.querySelector("[data-stuck]");
  if (!API || !(box || home)) return;
  const auth = window.srijitAuth;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };

  let G = null; // id -> {t, d, s, a, c, o}
  let solved = {}, stuck = new Set(); // id -> Srijit's grade (null until graded); ids marked "Stuck?"
  const leadsTo = {}; // id -> the public problems that build on it

  // -- the engine -------------------------------------------------------------------------------------------
  // How well you know one problem, 0 to 1: Srijit's grade out of 10; a posted solution he hasn't graded yet counts
  // as 0.6 for now; "Stuck?" counts as 0; untried is unknown.
  function mastery(id) {
    if (stuck.has(id) && !(id in solved)) return 0;
    if (!(id in solved)) return null;
    return solved[id] == null ? 0.6 : solved[id] / 10;
  }
  const done = (id) => { const m = mastery(id); return m != null && m >= 0.5; };
  // Your level on each skill: the average of how well you know the problems that use it.
  function levels() {
    const sum = {}, n = {};
    Object.keys(G).forEach((id) => {
      const m = mastery(id);
      if (m == null) return;
      G[id].s.forEach((s) => { sum[s] = (sum[s] || 0) + m; n[s] = (n[s] || 0) + 1; });
    });
    return Object.fromEntries(Object.keys(sum).map((s) => [s, sum[s] / n[s]]));
  }
  const open = (id) => G[id] && !done(id) && !stuck.has(id);
  const byEase = (a, b) => G[a].d - G[b].d || (G[a].o ?? 1e9) - (G[b].o ?? 1e9);
  // easier problems that lead to this one; if you've done those, the ones a step further back
  function feeders(id) {
    let out = G[id].a.filter(open);
    if (!out.length) out = [...new Set(G[id].a.flatMap((x) => (G[x] ? G[x].a : [])))].filter(open);
    return out.sort(byEase);
  }
  const followers = (id) => (leadsTo[id] || []).filter((x) => open(x) && G[x].d >= G[id].d).sort(byEase);
  // problems on the same skills at the same level, your weakest skill first
  function sameIdea(id) {
    const L = levels(), skills = G[id].s;
    const weak = (x) => Math.min(...G[x].s.filter((s) => skills.includes(s)).map((s) => L[s] ?? 0.5));
    return Object.keys(G).filter((x) => x !== id && open(x) && G[x].d === G[id].d && G[x].s.some((s) => skills.includes(s)))
      .sort((a, b) => weak(a) - weak(b) || byEase(a, b));
  }
  // the first problem of the course you haven't done, after this one if it's in the course
  function nextInCourse(id) {
    const from = id && G[id] && G[id].o != null ? G[id].o : -1;
    const course = Object.keys(G).filter((x) => G[x].o != null).sort((a, b) => G[a].o - G[b].o);
    return course.find((x) => G[x].o > from && open(x)) || course.find(open);
  }
  const skillOf = (x, id) => G[x].s.find((s) => G[id].s.includes(s));

  function forProblem(id) {
    const g = solved[id];
    if (stuck.has(id) && !(id in solved)) {
      return { title: "Stuck? Try these first", note: "Easier problems that lead here. Come back when you've solved one.",
               items: feeders(id).slice(0, 3).map((x) => [x, "builds up to this one"]) };
    }
    if (!(id in solved)) return null;
    const course = nextInCourse(id);
    const plus = (list) => (course && !list.some(([x]) => x === course) ? [...list, [course, "next in the course"]] : list);
    if (g == null) {
      return { title: "While Srijit grades yours", items: plus(followers(id).slice(0, 1).map((x) => [x, "builds on this one"])) };
    }
    if (g >= 7) return { title: "Well done. A step up", items: plus(followers(id).slice(0, 2).map((x) => [x, "builds on this one"])) };
    if (g >= 4) {
      return { title: "Practise the same idea", items: plus(sameIdea(id).slice(0, 2).map((x) => [x, `same idea: ${skillOf(x, id) || "practice"}`])) };
    }
    return { title: "Strengthen the basics first", note: "Easier problems that lead here, then try this one again.",
             items: feeders(id).slice(0, 3).map((x) => [x, "builds up to this one"]) };
  }
  function forHome() {
    const items = [], seen = new Set();
    const add = (x, why) => { if (x && !seen.has(x)) { seen.add(x); items.push([x, why]); } };
    const tried = Object.keys(G).filter((id) => id in solved || stuck.has(id));
    tried.filter((id) => stuck.has(id) && !(id in solved) || (solved[id] != null && solved[id] <= 3))
      .forEach((id) => add(feeders(id)[0], `fills a gap before ${G[id].t}`));
    add(nextInCourse(null), tried.length ? "next in the course" : "start here");
    tried.filter((id) => solved[id] != null && solved[id] >= 7).forEach((id) => add(followers(id)[0], `a step up from ${G[id].t}`));
    return { title: tried.length ? "Next for you" : "Where to start", items: items.slice(0, 3) };
  }

  // -- the page ---------------------------------------------------------------------------------------------
  const dots = (d) => `<span class="dots" title="difficulty ${d} of 3">${"●".repeat(d)}${"○".repeat(3 - d)}</span>`;
  function paint(el, s) {
    if (!s || !s.items.length) { el.hidden = true; return; }
    el.innerHTML = `<h2>${esc(s.title)}</h2>${s.note ? `<p class="muted">${esc(s.note)}</p>` : ""}<ul>${s.items.map(([x, why]) =>
      `<li><a href="${PAGES}${encodeURIComponent(x)}/">${esc(G[x].t)}</a> ${dots(G[x].d)}<small>${esc(why)}${G[x].c ? ` · ${esc(G[x].c)}` : ""}</small></li>`).join("")}</ul>`;
    el.hidden = false;
  }
  function render() {
    if (!G) return;
    if (box && here && G[here]) paint(box, forProblem(here));
    if (home) paint(home, forHome());
    if (stuckBtn) {
      const on = stuck.has(here);
      stuckBtn.classList.toggle("on", on); stuckBtn.setAttribute("aria-pressed", String(on));
      stuckBtn.textContent = on ? "Stuck ✓" : "Stuck?";
    }
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
      render();
      if (on && box && !box.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) { toast(err.message === "resting" ? "The site is taking a short break. Please try again in a little while." : "Couldn't save that. Please try again."); }
    finally { stuckBtn.disabled = false; }
  });

  Promise.all([
    fetch(PAGES + "graph.json?v=" + (C.v || "")).then((r) => r.json()),
    window.cohortHello || Promise.resolve(null),
  ]).then(([graph, hello]) => {
    G = graph;
    Object.keys(G).forEach((id) => G[id].a.forEach((x) => { (leadsTo[x] = leadsTo[x] || []).push(id); }));
    if (!(hello && hello.signedIn && hello.path)) return; // signed out: no path (the "Around this problem" links stay)
    hello.path.solved.forEach((r) => { solved[r.p] = r.g; });
    stuck = new Set(hello.path.stuck);
    render();
  }).catch(() => { /* the page works without it */ });
})();
