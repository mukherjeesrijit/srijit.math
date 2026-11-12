// srijitmath.com/blog: the ❤️ under a post (2026-11-11). Signed-in learners only, one per person; a signed-out
// reader sees the count and is asked to sign in (cohort.js's "Continue with Google", which reloads the page).
(function () {
  // Srijit: a way to write from the blog itself ("Write" on the list, "Edit this post" on a post)
  const who = window.srijitAuth && window.srijitAuth.me && window.srijitAuth.me();
  if (who && who.owner) {
    const post = document.querySelector("main.blog-post"), head = document.querySelector(".blog-list .list-head .dek");
    const link = (href, text) => Object.assign(document.createElement("a"), { href, textContent: text, className: "owner-link" });
    if (post) post.querySelector(".kicker").append(" · ", link(`/blog/write/#${post.dataset.post}`, "Edit this post"));
    if (head) head.append(" · ", link("/blog/write/", "Write"));
  }
})();
(function () {
  const box = document.querySelector("[data-love]");
  const API = (window.COHORT || {}).community;
  if (!box || !API) return;
  const auth = window.srijitAuth;
  const token = () => (auth && auth.token && auth.token()) || null;
  const btn = box.querySelector(".heart"), n = box.querySelector(".n"), hint = box.querySelector(".hint");
  let state = { loves: 0, loved: false, signedIn: !!token() };
  const paint = () => {
    btn.textContent = state.loved ? "♥" : "♡";
    btn.classList.toggle("on", state.loved);
    btn.setAttribute("aria-pressed", String(state.loved));
    n.textContent = state.loves ? String(state.loves) : "";
    hint.textContent = state.signedIn ? (state.loves ? "" : "Be the first to ❤️ this post") : "Sign in to ❤️ this post";
    btn.disabled = false;
  };
  const call = (method, path, body) => fetch(API + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: Object.assign({ "content-type": "application/json" }, token() ? { authorization: "Bearer " + token() } : {}) })
    .then((r) => r.json());
  // the count comes with the page's one request (/hello, cohort.js); asked separately only if that didn't bring it
  (window.cohortHello || Promise.resolve(null)).then((h) => (h && h.blog ? h.blog
    : call("GET", "/blog/loves?post=" + encodeURIComponent(box.dataset.love))))
    .then((d) => { if (d && d.loves != null) { state = { loves: d.loves, loved: !!d.loved, signedIn: !!token() }; paint(); } })
    .catch(() => {});
  btn.addEventListener("click", () => {
    if (!state.signedIn) { if (auth && auth.signIn) auth.signIn(); return; }
    const on = !state.loved;
    state = Object.assign({}, state, { loved: on, loves: state.loves + (on ? 1 : -1) }); // at once; the answer corrects it
    paint();
    call("POST", "/blog/love", { post: Number(box.dataset.love), on })
      .then((d) => { if (d && d.ok) { state = { loves: d.loves, loved: d.loved, signedIn: true }; paint(); } }).catch(() => {});
  });
})();
