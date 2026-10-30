// Discussion on the Fall 2026 problem pages, plus the leaderboard and "latest discussion" lists. The backend is the
// Cloudflare Worker (window.COHORT.community). Sign-in stays the cohort's emailed link: the cohort session is traded
// once for a community token. Srijit's own solution (Idea + Solution, from the Apps Script) is pinned on top.
(function () {
  const C = window.COHORT || {};
  const API = C.community;
  const box = document.querySelector("[data-discuss]");
  const solveBox = document.querySelector("[data-solve]");
  const talkBtn = document.querySelector('.actions [data-gate="discuss"]');
  const solveBtn = document.querySelector('.actions [data-gate="solve"]');
  const loveBtn = document.querySelector(".actions [data-love]");
  const board = document.querySelector("[data-leaderboard]");
  const latest = document.querySelector("[data-recent]");
  if (!(box || board || latest)) return;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const math = (el) => el && window.renderMathInElement && renderMathInElement(el, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                 { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
    throwOnError: false });
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };
  const paras = (text) => esc(text).split(/\n\s*\n/).map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
  function ago(ms) {
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); if (h < 24) return h + " h ago";
    const d = Math.round(h / 24); if (d < 30) return d + (d === 1 ? " day ago" : " days ago");
    return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  const ERR = { limit: "You've reached today's limit for that. Try again tomorrow.", locked: "This can't be edited any more.",
    "too long": "That's too long.", empty: "Write something first.", own: "You can't do that on your own post." };

  // -- sign-in: cohort.js owns it (window.srijitAuth: Google, or the emailed link traded for a Worker token) ---
  const auth = window.srijitAuth;
  let token = null, me = null;
  async function signIn() {
    if (!auth) return false;
    await auth.ready;
    token = auth.token(); me = auth.me();
    return !!token;
  }
  async function call(method, path, body) {
    const r = await fetch(API + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({ ok: false, error: "server" }));
    if (r.status === 401) { auth.clear(); throw new Error("session"); }
    if (!d.ok) throw new Error(d.error || "server");
    return d;
  }
  const failed = (e) => toast(ERR[e.message] || "Something went wrong. Please try again.");
  const askToSignIn = () => auth && auth.signIn();

  // -- the discussion on a problem page ------------------------------------------------------------------
  let sort = "top", posts = [];
  const KIND = { solution: "Solution", question: "Question" };

  function pinned(c) {
    if (!c || !(c.story || c.solution)) {
      return `<article class="post pinned"><header><b>Srijit</b><span class="tag">Srijit's solution</span></header>
        <p class="soon">Srijit's solution for this problem is coming soon. Start the discussion below.</p></article>`;
    }
    return `<article class="post pinned"><header><b>Srijit</b><span class="tag">Srijit's solution</span></header>
      ${c.story ? `<h3>Idea</h3><div class="body">${paras(c.story)}</div>` : ""}
      ${c.solution ? `<h3>Solution</h3><div class="body">${paras(c.solution)}</div>` : ""}</article>`;
  }
  function who(a) { return `<b>${esc(a.name)}</b>${a.owner ? '<span class="tag">Srijit</span>' : ""}`; }
  function tools(kind, x) {
    const out = [`<span class="votes"><button class="up${x.voted === 1 ? " on" : ""}" data-act="up" aria-pressed="${x.voted === 1}" ${x.mine ? "disabled" : ""} title="Upvote" aria-label="Upvote">▲</button>`
      + `<b class="score">${x.score}</b><button class="down${x.voted === -1 ? " on" : ""}" data-act="down" aria-pressed="${x.voted === -1}" ${x.mine ? "disabled" : ""} title="Downvote" aria-label="Downvote">▼</button></span>`];
    if (kind === "post") out.push(`<button data-act="reply">${x.comments.length ? `${x.comments.length} repl${x.comments.length > 1 ? "ies" : "y"} · ` : ""}Reply</button>`);
    if (x.editable) out.push(`<button data-act="edit">Edit</button>`);
    if (x.mine || (me && me.owner)) out.push(`<button data-act="delete">Delete</button>`);
    if (!x.mine && !x.flagged) out.push(`<button data-act="flag">Flag</button>`);
    if (x.flagged) out.push(`<span class="muted">Flagged</span>`);
    if (me && me.owner) out.push(x.hidden ? `<button data-act="restore">Restore</button>` : `<button data-act="hide">Hide</button>`);
    return out.join("");
  }
  function hiddenNote(x) {
    if (!x.hidden) return "";
    return `<p class="hidden-note">${me && me.owner ? `Hidden${x.flags ? ` · ${x.flags} flag${x.flags > 1 ? "s" : ""}` : ""}. Only you can see it.`
      : "Hidden until Srijit reviews it. Only you can see it."}</p>`;
  }
  function commentHTML(c) {
    return `<div class="comment${c.hidden ? " is-hidden" : ""}" data-kind="comment" data-id="${c.id}">
      <div class="meta">${who(c.author)} <time>${ago(c.created)}</time>${c.edited ? ' <span class="muted">edited</span>' : ""}</div>
      ${hiddenNote(c)}<div class="body">${paras(c.body)}</div><div class="tools">${tools("comment", c)}</div></div>`;
  }
  const opened = new Set(); // cards someone opened; kept open when the thread redraws
  function postHTML(p) {
    const long = p.body.length > 320 || p.body.split("\n").length > 5;
    const open = !long || opened.has(p.id);
    return `<article class="post solcard${p.hidden ? " is-hidden" : ""}${open ? " open" : ""}" data-kind="post" data-id="${p.id}">
      <header>${who(p.author)}<span class="kind ${p.kind}">${KIND[p.kind] || "Post"}</span><time>${ago(p.created)}</time>
        ${p.edited ? `<button class="muted linkish" data-act="history">edited</button>` : ""}</header>
      ${hiddenNote(p)}<div class="body">${paras(p.body)}</div>
      ${long ? `<button class="more linkish" data-act="expand">${open ? "Show less" : p.kind === "solution" ? "Show the whole solution" : "Show all of it"}</button>` : ""}
      <div class="tools">${tools("post", p)}</div>
      <div class="comments"${open ? "" : " hidden"}>${p.comments.map(commentHTML).join("")}</div>
      <form class="reply" hidden><textarea maxlength="1000" rows="2" placeholder="Reply to ${esc(p.author.name)}…"></textarea>
        <div class="row"><button type="submit" class="btn small">Reply</button></div></form></article>`;
  }
  function renderThread() {
    const list = box.querySelector(".posts");
    list.innerHTML = posts.length ? posts.map(postHTML).join("")
      : `<p class="soon">No posts yet. Be the first: share how you solved it, or ask about the step where you got stuck.</p>`;
    math(list);
    box.querySelector(".count").textContent = posts.length ? `${posts.length} post${posts.length > 1 ? "s" : ""}` : "";
    const n = posts.reduce((t, p) => t + 1 + p.comments.length, 0);
    if (talkBtn) talkBtn.textContent = n ? `Discuss · ${n}` : "Discuss";
  }
  async function loadThread() {
    const d = await call("GET", "/thread?p=" + encodeURIComponent(box.dataset.discuss) + "&sort=" + sort);
    me = d.me; auth.setMe(me);
    posts = d.posts; renderThread();
    paintLove(d.loves, d.loved);
  }

  function shell() {
    box.innerHTML = `<h2>Discussion</h2>
      <div class="pin"><p class="soon">Loading Srijit's solution…</p></div>
      <form class="compose">
        <input type="hidden" name="kind" value="question">
        <textarea maxlength="8000" rows="2" placeholder="Ask a question or share a thought about this problem. Maths between $ signs."></textarea>
        <div class="row"><span class="muted">Posting as <b class="me-name"></b> · <button type="button" class="linkish" data-act="rename">change name</button></span>
          <button type="submit" class="btn accent small">Post</button></div></form>
      <div class="sortbar"><span class="count"></span>
        <span><button type="button" data-sort="top" aria-pressed="true">Top</button><button type="button" data-sort="new" aria-pressed="false">New</button></span></div>
      <div class="posts"><p class="soon">Loading the discussion…</p></div>`;
    box.querySelector(".me-name").textContent = me ? me.name : "";
  }
  async function pinnedOnly() {
    await (window.cohortReady || Promise.resolve());
    if (!(auth && auth.session())) return signedOut();
    box.innerHTML = `<h2>Discussion</h2><div class="pin"><p class="soon">Loading Srijit's solution…</p></div>`;
    const c = await (window.cohortContent ? window.cohortContent() : Promise.resolve(null)).catch(() => null);
    const el = box.querySelector(".pin"); el.innerHTML = pinned(c); math(el);
  }
  function signedOut() {
    box.innerHTML = `<h2>Discussion</h2><div class="join"><p>Sign in to read Srijit's solution and talk it through with everyone in the cohort.</p>
      <button type="button" class="btn accent small" data-act="join">Sign in to join</button></div>`;
  }

  async function startDiscussion() {
    if (!API) return pinnedOnly(); // no Worker configured: Srijit's solution still shows for signed-in learners
    if (!(await signIn())) return signedOut();
    shell();
    const content = window.cohortContent ? window.cohortContent() : Promise.resolve(null);
    content.then((c) => { const el = box.querySelector(".pin"); el.innerHTML = pinned(c); math(el); })
      .catch(() => { box.querySelector(".pin").innerHTML = pinned(null); });
    loadThread().catch(failed);
  }

  function itemOf(el) {
    const node = el.closest("[data-kind]");
    if (!node) return null;
    const kind = node.dataset.kind, id = Number(node.dataset.id);
    const post = kind === "post" ? posts.find((p) => p.id === id) : posts.find((p) => p.comments.some((c) => c.id === id));
    const item = kind === "post" ? post : post && post.comments.find((c) => c.id === id);
    return { node, kind, id, post, item };
  }

  function bindDiscussion() {
    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector("button[type=submit]"), ta = f.querySelector("textarea");
      if (!ta.value.trim()) return toast(ERR.empty);
      btn.disabled = true;
      try {
        if (f.classList.contains("compose")) {
          await call("POST", "/posts", { problem: box.dataset.discuss, kind: f.querySelector("input[name=kind]").value, body: ta.value });
          ta.value = ""; sort = "new"; syncSort(); toast("Posted.");
        } else if (f.classList.contains("reply")) {
          await call("POST", `/posts/${itemOf(f).id}/comments`, { body: ta.value });
        } else if (f.classList.contains("editing")) {
          const it = itemOf(f);
          await call("PATCH", `/${it.kind === "post" ? "posts" : "comments"}/${it.id}`, { body: ta.value });
        }
        await loadThread();
      } catch (err) { failed(err); } finally { btn.disabled = false; }
    });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.sort) { sort = b.dataset.sort; syncSort(); return loadThread().catch(failed); }
      const act = b.dataset.act;
      if (!act) return;
      if (act === "join") return askToSignIn();
      if (act === "rename") return rename();
      const it = itemOf(b);
      if (!it) return;
      const path = it.kind === "post" ? "posts" : "comments";
      try {
        if (act === "up" || act === "down") {
          const want = act === "up" ? 1 : -1, value = it.item.voted === want ? 0 : want; // clicking again takes it back
          const d = await call("POST", "/vote", { kind: it.kind, id: it.id, value });
          it.item.voted = value; it.item.score = d.score;
          const v = b.parentElement;
          v.querySelector(".score").textContent = d.score;
          v.querySelector(".up").classList.toggle("on", value === 1); v.querySelector(".up").setAttribute("aria-pressed", value === 1);
          v.querySelector(".down").classList.toggle("on", value === -1); v.querySelector(".down").setAttribute("aria-pressed", value === -1);
        } else if (act === "expand") {
          opened.has(it.id) ? opened.delete(it.id) : opened.add(it.id);
          renderThread();
        } else if (act === "reply") {
          if (!opened.has(it.id)) { opened.add(it.id); renderThread(); }
          const node = box.querySelector(`.post[data-id="${it.id}"]`);
          const f = node.querySelector("form.reply"); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("textarea").focus();
        } else if (act === "edit") {
          const body = it.node.querySelector(":scope > .body");
          body.innerHTML = `<form class="editing"><textarea maxlength="${it.kind === "post" ? 8000 : 1000}" rows="4"></textarea>
            <div class="row"><button type="button" class="linkish" data-act="cancel">Cancel</button><button type="submit" class="btn small">Save</button></div></form>`;
          body.querySelector("textarea").value = it.item.body; body.querySelector("textarea").focus();
        } else if (act === "cancel") {
          renderThread();
        } else if (act === "delete") {
          if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Click again to delete"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Delete"; }, 3000); return; }
          await call("DELETE", `/${path}/${it.id}`); await loadThread();
        } else if (act === "flag") {
          const tools = b.parentElement;
          tools.innerHTML = `<span class="muted">Flag as:</span><button data-act="flagged" data-reason="ai">Looks AI-written</button>
            <button data-act="flagged" data-reason="rude">Rude</button><button data-act="flagged" data-reason="spam">Spam</button>
            <button data-act="cancel">Cancel</button>`;
        } else if (act === "flagged") {
          const d = await call("POST", "/flag", { kind: it.kind, id: it.id, reason: b.dataset.reason });
          toast(d.hidden ? "Thanks. It's hidden until Srijit reviews it." : "Thanks for flagging it.");
          await loadThread();
        } else if (act === "hide" || act === "restore") {
          await call("POST", "/moderate", { kind: it.kind, id: it.id, action: act }); await loadThread();
        } else if (act === "history") {
          const d = await call("GET", `/posts/${it.id}/versions`);
          const el = document.createElement("div"); el.className = "history";
          el.innerHTML = `<p class="muted">Earlier versions</p>` + d.versions.map((v) => `<div class="ver"><time>${ago(v.created)}</time>${paras(v.body)}</div>`).join("");
          it.node.querySelector(":scope > .body").after(el); math(el); b.disabled = true;
        }
      } catch (err) { failed(err); }
    });
  }
  function only(sec, btn, show) { // Solve, Discuss and Video: one open at a time
    const all = [[document.querySelector(".panel"), document.querySelector('.actions [data-gate="video"]')],
                 [box, talkBtn], [solveBox, solveBtn]];
    for (const [s, b] of all) {
      const on = s === sec && show;
      if (s) s.hidden = !on;
      if (b) b.setAttribute("aria-expanded", String(on));
    }
    if (show && sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const openTalk = (show) => box && only(box, talkBtn, show);
  if (talkBtn) talkBtn.addEventListener("click", async () => {
    if (!(await signedInAny())) return askToSignIn();
    openTalk(box.hidden);
  });
  if (solveBtn) solveBtn.addEventListener("click", async () => {
    if (!(await signedInAny())) return askToSignIn();
    only(solveBox, solveBtn, solveBox.hidden);
    if (!solveBox.hidden) { const ta = solveBox.querySelector("textarea"); if (ta) ta.focus(); }
  });

  // -- ♥ on the problem -----------------------------------------------------------------------------------
  let loved = false;
  function paintLove(n, on) {
    if (!loveBtn) return;
    loved = on;
    loveBtn.classList.toggle("on", on); loveBtn.setAttribute("aria-pressed", String(on));
    loveBtn.textContent = n ? `♥ ${n}` : "♥";
    loveBtn.title = on ? "You love this problem (click to take it back)" : "Love this problem";
  }
  if (loveBtn) loveBtn.addEventListener("click", async () => {
    if (!(await signedInAny()) || !API) return askToSignIn();
    try { const d = await call("POST", "/love", { problem: box.dataset.discuss, on: !loved }); paintLove(d.loves, d.loved); }
    catch (err) { failed(err); }
  });
  async function signedInAny() { // with the Worker: its token; without it: the older Apps Script sign-in
    if (!auth) return false;
    await auth.ready;
    return !!(API ? auth.token() : auth.session());
  }

  // -- "Your solution": write it here, then it is posted to the discussion --------------------------------
  function solveSignedOut() {
    solveBox.innerHTML = `<h2>Your solution</h2><div class="join"><p>Solve it by hand first. Then write your solution here and share it with the cohort.</p>
      <button type="button" class="btn accent small" data-act="join">Sign in to solve</button></div>`;
  }
  function solveShell() {
    const key = "solve_draft_" + solveBox.dataset.solve;
    solveBox.innerHTML = `<h2>Your solution</h2>
      <form class="write">
        <textarea maxlength="8000" rows="6" placeholder="Write it the way you'd explain it to a friend: the idea first, then the steps. Maths between $ signs, e.g. $\\frac{1}{n}$."></textarea>
        <p class="muted">A blank line starts a new paragraph. Your draft stays in this browser until you post it.</p>
        <div class="preview"></div>
        <div class="row"><span class="muted">Everyone in the cohort can read it under Discuss.</span>
          <button type="submit" class="btn accent small">Post to the discussion</button></div></form>`;
    const ta = solveBox.querySelector("textarea"), pv = solveBox.querySelector(".preview");
    ta.value = store.get(key) || "";
    let t = null;
    const paint = () => { pv.innerHTML = ta.value.trim() ? paras(ta.value) : ""; math(pv); };
    ta.addEventListener("input", () => { store.set(key, ta.value || null); clearTimeout(t); t = setTimeout(paint, 300); });
    paint();
    solveBox.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!ta.value.trim()) return toast(ERR.empty);
      if (!API) return toast("Posting opens soon.");
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        await call("POST", "/posts", { problem: solveBox.dataset.solve, kind: "solution", body: ta.value });
        ta.value = ""; store.set(key, null); paint();
        toast("Posted. Thanks for sharing it.");
        sort = "new"; syncSort(); await loadThread(); openTalk(true);
      } catch (err) { failed(err); } finally { btn.disabled = false; }
    });
  }
  async function startSolve() {
    if (!solveBox) return;
    if (await signedInAny()) solveShell(); else solveSignedOut();
  }
  if (solveBox) solveBox.addEventListener("click", (e) => { const b = e.target.closest('[data-act="join"]'); if (b) askToSignIn(); });

  function syncSort() { box.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.sort === sort)); }
  async function rename() {
    const name = window.prompt ? window.prompt("The name people see:", me ? me.name : "") : null;
    if (!name || !name.trim()) return;
    try { const d = await call("POST", "/me", { name }); me = d.me; auth.setMe(me); box.querySelector(".me-name").textContent = me.name; await loadThread(); }
    catch (err) { failed(err); }
  }

  // -- the sidebar: how many posts each problem has --------------------------------------------------------
  function sidebarCounts() {
    const links = document.querySelectorAll(".side li a");
    if (!links.length) return;
    call("GET", "/counts").then((d) => {
      links.forEach((a) => {
        const slug = a.getAttribute("href").split("/").filter(Boolean).pop(), n = d.counts[slug];
        if (n && !a.querySelector(".cnt")) a.insertAdjacentHTML("beforeend", ` <span class="cnt" title="posts and replies">${n}</span>`);
      });
    }).catch(() => {});
  }

  // -- leaderboard page and "latest discussion" on the home page ------------------------------------------
  function table(rows) {
    if (!rows.length) return `<p class="soon">No upvotes yet.</p>`;
    return `<ol class="lb">${rows.map((r, k) => `<li><span class="rank">${k + 1}</span><b>${esc(r.name || "Learner")}</b><span class="up">▲ ${r.up}</span></li>`).join("")}</ol>`;
  }
  async function startBoard() {
    if (!(await signIn())) { board.innerHTML = `<p>Sign in to see the leaderboard.</p><button type="button" class="btn accent small">Sign in</button>`; board.querySelector("button").onclick = askToSignIn; return; }
    try {
      const d = await call("GET", "/leaderboard");
      board.innerHTML = `<div class="lb-grid"><section><h2>This week</h2>${table(d.week)}</section><section><h2>All time</h2>${table(d.all)}</section></div>`;
    } catch (err) { board.innerHTML = `<p class="soon">Couldn't load the leaderboard. Please reload.</p>`; }
  }
  async function startRecent() {
    if (!(await signIn())) return;
    try {
      const d = await call("GET", "/recent");
      if (!d.items.length) return;
      latest.innerHTML = `<h2>Latest in the discussion</h2><ul>${d.items.map((r) => `<li><a href="${C.base || "/cohort/fall-2026/"}${encodeURIComponent(r.problem)}/">
          <span class="what"><b>${esc(r.name || "Learner")}</b> ${r.type === "comment" ? "replied on" : r.kind === "question" ? "asked about" : "shared a solution to"} <b>${esc(r.title)}</b></span>
          <span class="snip">${esc(r.body.replace(/\s+/g, " "))}</span><time>${ago(r.created)}</time></a></li>`).join("")}</ul>
        <p><a class="quiet" href="${C.base || "/cohort/fall-2026/"}leaderboard/">Leaderboard →</a></p>`;
      latest.hidden = false; math(latest);
    } catch (err) { /* the home page is fine without it */ }
  }

  if (box) { bindDiscussion(); startDiscussion().then(() => API && sidebarCounts()).catch(() => signedOut()); }
  startSolve();
  if (board && API) startBoard();
  if (latest && API) startRecent();
})();
