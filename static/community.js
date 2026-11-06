// The community on srijitmath.com, backed by the Cloudflare Worker (window.COHORT.community): under each problem
// Solve (write your solution) · Discuss (Srijit's solution pinned, then everyone's: solution cards with claps, questions
// and replies with up/down votes) · ♥; Srijit grades solutions (claps 0-10) with private feedback; the bell (claps,
// grades, feedback, replies); profiles (level, Math Karma, points, solved problems); the leaderboard; the latest
// discussion on the home page. Sign-in is cohort.js (window.srijitAuth). Posts are Markdown with maths in $...$.
(function () {
  const C = window.COHORT || {};
  const API = C.community, BASE = C.base || "/cohort/fall-2026/", PAGES = C.problems || "/problems/"; // a problem's page: PAGES + its id
  const box = document.querySelector("[data-discuss]");
  const solveBox = document.querySelector("[data-solve]");
  const talkBtn = document.querySelector('.actions [data-gate="discuss"]');
  const solveBtn = document.querySelector('.actions [data-gate="solve"]');
  const loveBtn = document.querySelector(".actions [data-love]");
  const board = document.querySelector("[data-leaderboard]");
  const latest = document.querySelector("[data-recent]");
  const profileBox = document.querySelector("[data-profile]");
  const chatBox = document.querySelector("[data-messages]");
  // what cohort.js's one request per page already brought; each part falls back to its own request
  const hello = (key, fallback) => (window.cohortHello || Promise.resolve(null)).then((h) => (h && h[key] != null ? h : fallback()));

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  // The last `max` copies of something this browser has shown (profiles, discussions), newest last, so a page it has
  // seen before draws at once and the page's request only brings it up to date (2026-11-03). Cleared on sign-out.
  const kept = (name, max) => ({
    get(id) { const all = store.get(name); return all && all[id] ? all[id].v : null; },
    set(id, v) {
      const all = store.get(name) || {};
      all[id] = { v, at: Date.now() };
      const ids = Object.keys(all).sort((a, b) => all[a].at - all[b].at);
      ids.slice(0, Math.max(0, ids.length - max)).forEach((k) => delete all[k]);
      store.set(name, all);
    },
  });
  const keptProfiles = kept("kept_profiles", 20), keptThreads = kept("kept_threads", 10);
  // a name as it is shown: each word with a capital first letter, the rest small ("JAYANT" -> "Jayant")
  const nm = (s) => String(s || "").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // One broken formula in a post (a KaTeX crash, not a parse error) must not stop the page: it becomes an ordinary
  // maths error, shown as text. Sai's alg-2 post (\begin\ …) broke the whole discussion this way (2026-11-06).
  const guardKatex = () => {
    const k = window.katex;
    if (k && !k.render.guarded) {
      const render = k.render;
      k.render = function (tex, el, opts) {
        try { return render.call(this, tex, el, opts); } catch (e) {
          if (e instanceof k.ParseError) throw e;
          throw new k.ParseError(String((e && e.message) || e));
        }
      };
      k.render.guarded = true;
    }
    return true;
  };
  const math = (el) => el && window.renderMathInElement && guardKatex() && renderMathInElement(el, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                 { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
    throwOnError: false });
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };
  const paras = (text) => esc(text).split(/\n\s*\n/).map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
  /** Markdown -> safe HTML; maths is taken out first so Markdown can't touch it, then put back for KaTeX. */
  function md(text) {
    if (!(window.marked && window.DOMPurify)) return paras(text);
    const keep = [];
    const src = String(text).replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g,
      (m) => { keep.push(m); return "MATHSLOT" + (keep.length - 1) + "X"; });
    const html = DOMPurify.sanitize(marked.parse(src, { breaks: true, mangle: false, headerIds: false }));
    return html.replace(/MATHSLOT(\d+)X/g, (_, k) => esc(keep[Number(k)]));
  }
  function ago(ms) {
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); if (h < 24) return h + " h ago";
    const d = Math.round(h / 24); if (d < 30) return d + (d === 1 ? " day ago" : " days ago");
    return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  const day = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const ERR = { limit: "You've reached today's limit for that. Try again tomorrow.", locked: "This can't be edited any more.",
    "too long": "That's too long.", empty: "Write something first.", own: "You can't do that on your own post.",
    resting: "The discussion is taking a short break. Please try again in a little while.",
    claps: "You've given all 50 claps to this one.", linkedin: "That isn't a LinkedIn profile link. It should look like linkedin.com/in/your-name.", already: "You've already posted your solution here. Edit it under Solve." };

  // -- sign-in: cohort.js owns it -----------------------------------------------------------------------
  const auth = window.srijitAuth;
  let token = null, me = null;
  async function signIn() {
    if (!auth || !API) return false;
    await auth.ready;
    token = auth.token(); me = auth.me();
    return !!token;
  }
  async function signedInAny() { // with the Worker: its token; without it: the older Apps Script sign-in
    if (!auth) return false;
    await auth.ready;
    return !!(API ? auth.token() : auth.session());
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

  // people: a name links to their profile; their level sits beside it
  const lvl = (l) => (l ? `<span class="lvl" title="Level ${l.n}">Lv ${l.n} · ${esc(l.name)}</span>` : "");
  const LI_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>';
  const linkedin = (a) => (a.linkedin && /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//.test(a.linkedin)
    ? `<a class="li" href="${esc(a.linkedin)}" target="_blank" rel="noopener nofollow" title="${esc(nm(a.name))} on LinkedIn" aria-label="${esc(nm(a.name))} on LinkedIn">${LI_SVG}</a>` : "");
  const person = (a) => `<a class="who" href="/dashboard/#${a.id}">${esc(nm(a.name))}</a>${linkedin(a)}${a.owner ? "" : lvl(a.level)}`;

  // -- the discussion on a problem page ------------------------------------------------------------------
  let sort = "top", posts = [];
  const opened = new Set(); // solution cards someone opened; kept open when the thread redraws
  const KIND = { solution: "Solution", question: "Question" };

  let srijit = null; // Srijit's Idea + Solution for this problem
  function pinned(c) {
    srijit = c;
    if (!c || !(c.story || c.solution)) {
      return `<article class="post solcard pinned"><header><b>Srijit</b><span class="tag">Srijit's solution</span></header>
        <p class="soon">Srijit's solution for this problem is coming soon. Start the discussion below.</p></article>`;
    }
    const open = opened.has("pin");
    return `<article class="post solcard pinned${open ? " open" : ""}" data-card="pin">
      <header><b>Srijit</b><span class="tag">Srijit's solution</span></header>
      <div class="body">${c.story ? `<h3>Idea</h3>${paras(c.story)}` : ""}${c.solution ? `<h3>Solution</h3>${paras(c.solution)}` : ""}</div>
      ${open ? "" : `<p class="sumline">Click to read the whole solution</p>`}</article>`;
  }
  function repaintPin() { const el = box && box.querySelector(".pin"); if (el) { el.innerHTML = pinned(srijit); math(el); fits(el); } }
  // a closed card fades out only if its text is cut short
  const fits = (root) => root.querySelectorAll(".solcard:not(.open) .body").forEach((b) => b.classList.toggle("fits", b.scrollHeight <= b.clientHeight + 2));
  function tools(kind, x) {
    const out = [];
    if (kind === "post" && x.kind === "solution") {
      const can = !x.mine && !(me && me.owner);
      out.push(`<button class="clap${x.myClaps ? " on" : ""}" data-act="clap" ${can ? "" : "disabled"} title="${can ? "Clap (as many as 50 times)" : "Claps"}">👏 ${x.claps}${x.myClaps ? ` <small>· you ${x.myClaps}</small>` : ""}</button>`);
    } else {
      out.push(`<span class="votes"><button class="up${x.voted === 1 ? " on" : ""}" data-act="up" aria-pressed="${x.voted === 1}" ${x.mine ? "disabled" : ""} aria-label="Upvote">▲</button>`
        + `<b class="score">${x.score}</b><button class="down${x.voted === -1 ? " on" : ""}" data-act="down" aria-pressed="${x.voted === -1}" ${x.mine ? "disabled" : ""} aria-label="Downvote">▼</button></span>`);
    }
    if (kind === "post") out.push(`<button data-act="reply">${x.comments.length ? `${x.comments.length} repl${x.comments.length > 1 ? "ies" : "y"} · ` : ""}Reply</button>`);
    if (x.editable) out.push(`<button data-act="edit">Edit</button>`);
    if (x.mine || (me && me.owner)) out.push(`<button data-act="delete">Delete</button>`);
    if (!x.mine && !x.flagged) out.push(`<button data-act="flag">Flag</button>`);
    if (x.flagged) out.push(`<span class="muted">Flagged</span>`);
    if (me && me.owner) {
      if (kind === "post" && x.kind === "solution" && !x.mine) out.push(`<button class="gradebtn" data-act="grade">${x.grade == null ? "Grade" : "Change grade"}</button>`);
      out.push(x.hidden ? `<button data-act="restore">Restore</button>` : `<button data-act="hide">Hide</button>`);
    }
    return out.join("");
  }
  function hiddenNote(x) {
    if (!x.hidden) return "";
    return `<p class="hidden-note">${me && me.owner ? `Hidden${x.flags ? ` · ${x.flags} flag${x.flags > 1 ? "s" : ""}` : ""}. Only you can see it.`
      : "Hidden until Srijit reviews it. Only you can see it."}</p>`;
  }
  function graded(p) {
    if (p.grade == null && !p.feedback) return "";
    return `${p.grade != null ? `<p class="grade">Srijit's grade: <b>👏 ${p.grade}/10</b></p>` : ""}
      ${p.feedback ? `<div class="feedback"><p class="muted">Srijit's feedback</p>${md(p.feedback)}</div>` : ""}`;
  }
  function commentHTML(c) {
    return `<div class="comment${c.hidden ? " is-hidden" : ""}" data-kind="comment" data-id="${c.id}">
      <div class="meta">${person(c.author)} <time>${ago(c.created)}</time>${c.edited ? ' <span class="muted">edited</span>' : ""}</div>
      ${hiddenNote(c)}<div class="body md">${md(c.body)}</div><div class="tools">${tools("comment", c)}</div></div>`;
  }
  function postHTML(p) {
    const open = opened.has(p.id);
    const r = p.comments.length;
    const summary = [p.kind === "solution" ? `👏 ${p.claps}` : `▲ ${p.score}`, `${r} repl${r === 1 ? "y" : "ies"}`]
      .concat(p.grade != null ? [`Srijit 👏 ${p.grade}/10`] : []).join(" · ");
    return `<article class="post solcard${p.hidden ? " is-hidden" : ""}${open ? " open" : ""}" id="post-${p.id}" data-kind="post" data-id="${p.id}" data-card="${p.id}">
      <header>${person(p.author)}<span class="kind ${p.kind}">${KIND[p.kind] || "Post"}</span><time>${ago(p.created)}</time>
        ${p.edited ? `<button class="muted linkish" data-act="history">edited</button>` : ""}</header>
      ${hiddenNote(p)}<div class="body md">${md(p.body)}</div>
      ${open ? `${graded(p)}
        <div class="tools">${tools("post", p)}</div>
        <div class="comments">${p.comments.map(commentHTML).join("")}</div>
        <form class="reply"><textarea maxlength="1000" rows="2" placeholder="Reply to ${esc(nm(p.author.name))}…"></textarea>
          <div class="row"><button type="submit" class="btn small">Reply</button></div></form>`
      : `<p class="sumline">${summary} · <span class="open-hint">Click to open${p.kind === "solution" ? " the solution" : ""} and reply</span></p>`}</article>`;
  }
  function renderThread() {
    const list = box.querySelector(".posts");
    list.innerHTML = posts.length ? posts.map(postHTML).join("")
      : `<p class="soon">No solutions yet. Be the first: press Solve and share yours.</p>`;
    math(list); fits(list);
    box.querySelector(".count").textContent = posts.length ? `${posts.length} solution${posts.length > 1 ? "s" : ""}` : "";
    const n = posts.reduce((t, p) => t + 1 + p.comments.length, 0);
    if (talkBtn) talkBtn.textContent = n ? `Discuss · ${n}` : "Discuss";
    refreshSolve();
  }
  let loaded = false, mineFromPage = null; // the whole discussion loads when Discuss is first opened
  async function loadThread() {
    const id = box.dataset.discuss + " " + sort;
    if (!loaded) { const k = keptThreads.get(id); if (k) { posts = k.posts; renderThread(); } } // the last one, at once
    const d = await call("GET", "/thread?p=" + encodeURIComponent(box.dataset.discuss) + "&sort=" + sort);
    me = d.me; auth.setMe(me);
    posts = d.posts; loaded = true; renderThread();
    paintLove(d.loves, d.loved);
    keptThreads.set(id, { posts: d.posts });
  }
  const threadFailed = (err) => { // say it in the page, not only in a passing note
    box.querySelector(".posts").innerHTML = `<p class="soon">${esc(ERR[err.message] || "Couldn't load the discussion. Please reload the page.")}</p>`;
  };
  async function loadPage() { // on opening the page: ♥, my solution and how many posts, not the whole discussion
    const d = (await hello("problem", () => call("GET", "/page?p=" + encodeURIComponent(box.dataset.discuss))
      .then((problem) => ({ problem })))).problem;
    me = d.me; auth.setMe(me);
    paintLove(d.loves, d.loved);
    if (talkBtn && !loaded) talkBtn.textContent = d.talk ? `Discuss · ${d.talk}` : "Discuss";
    mineFromPage = d.mine; refreshSolve();
  }
  function shell() {
    box.innerHTML = `<h2>Discussion</h2>
      <p class="muted">Open a solution to clap for it and reply to it. You're <b class="me-name"></b> · <button type="button" class="linkish" data-act="rename">change name</button></p>
      <div class="sortbar"><span class="count"></span>
        <span><button type="button" data-sort="top" aria-pressed="true">Top</button><button type="button" data-sort="new" aria-pressed="false">New</button></span></div>
      <div class="posts"><p class="soon">Loading the discussion…</p></div>`;
    box.querySelector(".me-name").textContent = me ? nm(me.name) : "";
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
    const m = location.hash.match(/^#post-(\d+)$/); // a link from the bell or a profile: open that post
    if (!m) return loadPage().catch(threadFailed);
    await loadThread().catch(threadFailed);
    if (m) {
      opened.add(Number(m[1])); renderThread(); openTalk(true);
      const el = document.getElementById("post-" + m[1]);
      if (el) { el.classList.add("lit"); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }
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
      if (!f.classList.contains("grading") && !ta.value.trim()) return toast(ERR.empty);
      btn.disabled = true;
      try {
        if (f.classList.contains("compose")) {
          await call("POST", "/posts", { problem: box.dataset.discuss, kind: "question", body: ta.value });
          ta.value = ""; sort = "new"; syncSort(); toast("Posted.");
        } else if (f.classList.contains("reply")) {
          await call("POST", `/posts/${itemOf(f).id}/comments`, { body: ta.value });
        } else if (f.classList.contains("editing")) {
          const it = itemOf(f);
          await call("PATCH", `/${it.kind === "post" ? "posts" : "comments"}/${it.id}`, { body: ta.value });
        } else if (f.classList.contains("grading")) {
          await call("POST", "/grade", { post: itemOf(f).id, claps: Number(f.querySelector("select").value), feedback: ta.value });
          toast("Grade saved. They'll see it in their notifications.");
        }
        await loadThread();
      } catch (err) { failed(err); } finally { btn.disabled = false; }
    });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) {
        const card = e.target.closest("[data-card]");
        if (!card || e.target.closest("a, textarea, input, select, form, .comments") || getSelection().toString()) return;
        const k = Number(card.dataset.card);
        opened.has(k) ? opened.delete(k) : opened.add(k);
        renderThread();
        if (opened.has(k)) { const el = document.getElementById("post-" + k); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
        return;
      }
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
        } else if (act === "clap") {
          const d = await call("POST", "/clap", { post: it.id, n: 1 });
          it.item.claps = d.claps; it.item.myClaps = d.mine;
          b.classList.add("on", "pop"); b.innerHTML = `👏 ${d.claps} <small>· you ${d.mine}</small>`;
          setTimeout(() => b.classList.remove("pop"), 250);
        } else if (act === "expand") {
          opened.has(it.id) ? opened.delete(it.id) : opened.add(it.id);
          renderThread();
        } else if (act === "reply") {
          if (!opened.has(it.id)) { opened.add(it.id); renderThread(); }
          const node = box.querySelector(`.post[data-id="${it.id}"]`);
          node.querySelector("form.reply textarea").focus();
        } else if (act === "edit") {
          if (it.kind === "post" && it.item.kind === "solution" && solveBox) { only(solveBox, solveBtn, true); return; }
          const body = it.node.querySelector(":scope > .body");
          body.innerHTML = `<form class="editing"><textarea maxlength="${it.kind === "post" ? 8000 : 1000}" rows="4"></textarea>
            <div class="row"><button type="button" class="linkish" data-act="cancel">Cancel</button><button type="submit" class="btn small">Save</button></div></form>`;
          body.querySelector("textarea").value = it.item.body; body.querySelector("textarea").focus();
        } else if (act === "grade") {
          const g = it.item.grade == null ? 8 : it.item.grade;
          const f = document.createElement("form"); f.className = "grading";
          f.innerHTML = `<label>Your grade <select>${Array.from({ length: 11 }, (_, k) => `<option value="${k}"${k === g ? " selected" : ""}>👏 ${k}/10</option>`).join("")}</select></label>
            <textarea maxlength="3000" rows="3" placeholder="Feedback for improvement. Everyone can read it."></textarea>
            <div class="row"><button type="button" class="linkish" data-act="cancel">Cancel</button><button type="submit" class="btn small">Save grade</button></div>`;
          f.querySelector("textarea").value = it.item.feedback || "";
          it.node.querySelector(":scope > .tools").before(f); b.disabled = true;
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
          el.innerHTML = `<p class="muted">Earlier versions</p>` + d.versions.map((v) => `<div class="ver"><time>${ago(v.created)}</time>${md(v.body)}</div>`).join("");
          it.node.querySelector(":scope > .body").after(el); math(el); b.disabled = true;
        }
      } catch (err) { failed(err); }
    });
  }
  function syncSort() { box.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.sort === sort)); }
  async function rename() {
    const name = window.prompt ? window.prompt("The name people see:", me ? me.name : "") : null;
    if (!name || !name.trim()) return;
    try { const d = await call("POST", "/me", { name }); me = d.me; auth.setMe(me); if (box) box.querySelector(".me-name").textContent = nm(me.name); await (box ? loadThread() : Promise.resolve()); }
    catch (err) { failed(err); }
  }

  // -- Solve / Discuss / Video: one open at a time ---------------------------------------------------------
  function only(sec, btn, show) {
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
    if (!box.hidden && !loaded && API) await loadThread().catch(threadFailed);
  });
  if (solveBtn) solveBtn.addEventListener("click", async () => {
    if (!(await signedInAny())) return askToSignIn();
    only(solveBox, solveBtn, solveBox.hidden);
    if (!solveBox.hidden) { const ta = solveBox.querySelector("form.write textarea"); if (ta) ta.focus(); }
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

  // -- "Your solution": one per problem, posted to the discussion, editable any time ------------------------
  let mySolution = null;
  function solveSignedOut() {
    solveBox.innerHTML = `<h2>Your solution</h2><div class="join"><p>Solve it by hand first. Then share it with the cohort.</p>
      <button type="button" class="btn accent small" data-act="join">Sign in to solve</button></div>`;
  }
  // the prompt learners give their own AI with the photo: a copy of the page, exactly as written, in our Markdown
  const PROMPT = [
    "Copy my handwritten solution in the attached photo into Markdown, exactly as I wrote it.",
    "",
    "- Keep every word, symbol, step and line, in my order. Do not fix mistakes, add missing steps, reword, shorten or solve anything, even if it is wrong.",
    "- Write all maths in LaTeX between dollar signs: $...$ inside a sentence, and $$...$$ on its own line for a displayed equation. Never use \\( \\) or \\[ \\].",
    "- Start a new line wherever I did. Use a list only where I wrote one.",
    "- If you can't read a word or symbol, write [unclear] instead of guessing.",
    "- Leave out anything I crossed out. For a drawing or a graph, write [figure].",
    "- Reply with the Markdown only: no code block, no title, no comments before or after.",
  ].join("\n");
  function copyPrompt(btn) { // the clipboard, or a hidden textarea where the browser refuses it (the prompt itself is never shown)
    const done = () => { btn.textContent = "Prompt copied ✓"; setTimeout(() => (btn.textContent = "Copy prompt"), 2000); };
    const old = () => {
      const t = Object.assign(document.createElement("textarea"), { value: PROMPT }); t.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* refused */ } t.remove();
      ok ? done() : toast("Couldn't copy. Please try again.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(PROMPT).then(done, old);
    else old();
  }
  function solveShell() {
    const key = "solve_draft_" + solveBox.dataset.solve;
    solveBox.innerHTML = `<h2>Your solution</h2>
      <p class="hint">Solve it by hand, photograph it and give the photo to your AI (Claude, Gemini, ChatGPT) with this prompt
        <button type="button" class="copy" data-act="copy-prompt">Copy prompt</button>, then paste its reply below.</p>
      <p class="mine-note" hidden></p>
      <form class="write">
        <textarea maxlength="8000" rows="8" placeholder="Paste what your AI gave back here. You can also type: Markdown works, and maths between $ signs, e.g. $\\frac{1}{n}$."></textarea>
        <div class="preview md"></div>
        <div class="row"><span class="muted">One solution per problem. You can edit it any time.</span>
          <button type="submit" class="btn accent small">Post to the discussion</button></div></form>`;
    solveBox.querySelector('[data-act="copy-prompt"]').addEventListener("click", (e) => copyPrompt(e.currentTarget));
    const ta = solveBox.querySelector("form.write textarea"), pv = solveBox.querySelector(".preview");
    ta.value = store.get(key) || "";
    let t = null;
    const paint = () => { pv.innerHTML = ta.value.trim() ? md(ta.value) : ""; math(pv); };
    ta.addEventListener("input", () => { store.set(key, ta.value || null); clearTimeout(t); t = setTimeout(paint, 300); });
    paint();
    solveBox.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!ta.value.trim()) return toast(ERR.empty);
      if (!API) return toast("Posting opens soon.");
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        if (mySolution) await call("PATCH", `/posts/${mySolution.id}`, { body: ta.value });
        else await call("POST", "/posts", { problem: solveBox.dataset.solve, kind: "solution", body: ta.value });
        store.set(key, null);
        toast(mySolution ? "Your solution is updated." : "Posted. Thanks for sharing it.");
        sort = "new"; syncSort(); await loadThread(); openTalk(true);
      } catch (err) { failed(err); } finally { btn.disabled = false; }
    });
  }
  function refreshSolve() { // once the thread is loaded: if I've posted my solution, the box edits it
    if (!solveBox || !solveBox.querySelector("form.write") || solveBox.querySelector("form.owner")) return;
    mySolution = (loaded ? posts.find((p) => p.mine && p.kind === "solution") : mineFromPage) || null;
    const note = solveBox.querySelector(".mine-note"), ta = solveBox.querySelector("form.write textarea");
    const btn = solveBox.querySelector("button[type=submit]");
    if (mySolution) {
      note.hidden = false; note.textContent = `You posted your solution ${ago(mySolution.created)}. Edit it here and save.`;
      btn.textContent = "Save changes";
      if (!store.get("solve_draft_" + solveBox.dataset.solve)) { ta.value = mySolution.body; ta.dispatchEvent(new Event("input")); }
    } else { note.hidden = true; btn.textContent = "Post to the discussion"; }
  }
  async function startSolve() {
    if (!solveBox) return;
    if (!(await signedInAny())) return solveSignedOut();
    solveShell(); refreshSolve();
  }
  if (solveBox) solveBox.addEventListener("click", (e) => { const b = e.target.closest('[data-act="join"]'); if (b) askToSignIn(); });

  // -- the sidebar: how many posts each problem has --------------------------------------------------------
  function sidebarCounts() {
    const links = document.querySelectorAll(".side li a");
    if (!links.length) return;
    hello("counts", () => call("GET", "/counts")).then((d) => {
      links.forEach((a) => {
        const slug = a.getAttribute("href").split("/").filter(Boolean).pop(), n = d.counts[slug];
        if (n && !a.querySelector(".cnt")) a.insertAdjacentHTML("beforeend", ` <span class="cnt" title="posts and replies">${n}</span>`);
      });
    }).catch(() => {});
  }

  // -- the bell: claps, grades, feedback and replies --------------------------------------------------------
  function noteText(n) {
    const on = `<b>${esc(n.title || "a problem")}</b>`, who = `<b>${esc(nm(n.from_name) || "Someone")}</b>`;
    if (n.type === "clap") return `${who} clapped 👏 ${n.n} for your solution to ${on}`;
    if (n.type === "grade") return `Srijit graded your solution to ${on}: 👏 ${n.n}/10`;
    if (n.type === "feedback") return `Srijit left feedback on your solution to ${on} (👏 ${n.n}/10)`;
    if (n.type === "reply") return `${who} replied to your post on ${on}`;
    if (n.type === "solution") return `${who} posted a solution to ${on}. Open it to grade it.`;
    if (n.type === "message") return `💬 ${who} sent you ${n.n > 1 ? `${n.n} messages` : "a message"}`;
    return `News on ${on}`;
  }
  function startBell() {
    const top = document.querySelector(".top"), anchor = top && top.querySelector("[data-enrol]");
    if (!anchor) return;
    const wrap = document.createElement("div"); wrap.className = "bell";
    wrap.innerHTML = `<button type="button" class="bellbtn" aria-label="Notifications" aria-expanded="false">🔔<span class="dot" hidden></span></button>
      <div class="notes" hidden></div>`;
    anchor.before(wrap);
    const chat = Object.assign(document.createElement("a"), { className: "msgbtn", href: "/messages/",
      title: me && me.owner ? "Messages from learners" : "Message Srijit" });
    chat.innerHTML = `💬<span class="dot" hidden></span>`; // new messages show here, not on the bell
    chat.setAttribute("aria-label", chat.title);
    wrap.before(chat);
    hello("msgs", () => Promise.resolve({ msgs: 0 })).then((d) => {
      const n = d.msgs || 0, dot = chat.querySelector(".dot");
      dot.hidden = !n || !!chatBox; dot.textContent = n > 9 ? "9+" : n; // on the messages page itself, it's being read
    }).catch(() => {});
    const btn = wrap.querySelector(".bellbtn"), dot = wrap.querySelector(".dot"), list = wrap.querySelector(".notes");
    // The bell (2026-11-03): this browser keeps the list it last showed (bell_<you>). Opening the bell shows it at once;
    // only if the dot says there's something new does it ask, and then only for the items newer than the ones it has
    // (?since=), which the Worker marks seen as it sends them. Nothing new: no request at all.
    const key = "bell_" + (me && me.id);
    let items = store.get(key) || null;
    const paint = (list_) => {
      const link = (n) => (n.type === "message" ? `/messages/${me && me.owner ? `#u${n.from_user}` : ""}`
        : `${PAGES}${encodeURIComponent(n.problem || "")}/#post-${n.post_id}`);
      list.innerHTML = list_.length ? list_.map((n) => `<a class="${n.seen ? "" : "new"}" href="${link(n)}">
          <span>${noteText(n)}</span><time>${ago(n.created)}</time></a>`).join("")
        : `<p class="muted">Nothing yet. Claps, grades and replies show up here.</p>`;
      math(list);
    };
    const load = async () => {
      const since = items && items.length ? Math.max(...items.map((n) => n.created)) : 0;
      const d = await call("GET", "/notifications" + (since ? "?since=" + since : ""));
      const byId = new Map((items || []).map((n) => [n.id, { ...n, seen: 1 }])); // what it had: seen now
      d.items.forEach((n) => byId.set(n.id, n)); // new ones, and a clap item that came again, replace theirs
      const all = [...byId.values()].sort((a, b) => b.created - a.created).slice(0, 30);
      paint(all);
      items = all.map((n) => ({ ...n, seen: 1 })); store.set(key, items);
      dot.hidden = true;
    };
    // the number of new ones comes with the page (no polling); the list loads when the bell is opened
    const check = () => hello("unseen", () => call("GET", "/notifications/unseen")).then((d) => {
      dot.hidden = !d.unseen; dot.textContent = d.unseen > 9 ? "9+" : d.unseen; }).catch(() => {});
    btn.addEventListener("click", async () => {
      list.hidden = !list.hidden; btn.setAttribute("aria-expanded", String(!list.hidden));
      if (list.hidden) return;
      if (items) paint(items); else list.innerHTML = `<p class="muted">Loading…</p>`;
      if (items && dot.hidden) return; // nothing new since this browser last looked: no request
      await load().catch(() => { if (!items) list.innerHTML = `<p class="muted">Couldn't load. Please try again.</p>`; });
    });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) { list.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    check(); // every 2 min, only while the tab is in view
  }
  // your name at the top opens your profile
  function nameToProfile() {
    document.querySelectorAll(".top [data-enrol]").forEach((b) => b.addEventListener("click", () => { if (token) location.href = "/dashboard/"; }));
  }

  // -- a profile: level, Math Karma, points and the problems solved -----------------------------------------
  async function startProfile() {
    if (!(await signIn())) {
      profileBox.innerHTML = `<p>Sign in to see profiles.</p><button type="button" class="btn accent small">Sign in</button>`;
      profileBox.querySelector("button").onclick = askToSignIn; return;
    }
    let first = true; // the first one came with the page's request (cohort.js); another person's (#<id>) is asked for
    const show = async () => {
      const who = location.hash.replace("#", "") || "me";
      const ask = () => call("GET", "/profile?u=" + encodeURIComponent(who));
      // anyone's profile this browser has shown (yours too) draws at once from the last time, then is brought up to date
      const pid = who === "me" ? String(me && me.id) : who;
      const s = keptProfiles.get(pid);
      let drawn = false;
      if (s && s.person) { paint(s); drawn = true; } else profileBox.innerHTML = `<p class="soon">Loading…</p>`;
      try {
        const d = first ? (await hello("profile", () => ask().then((profile) => ({ profile })))).profile : await ask();
        first = false;
        paint(d);
        keptProfiles.set(String(d.person.id), d);
      } catch (err) { first = false; if (!drawn) profileBox.innerHTML = `<p class="soon">Couldn't find that profile.</p>`; } // keep the last one
    };
    function paint(d) {
      const p = d.person, l = d.level, next = l.next;
      const pct = next ? Math.round(100 * (d.karma - (LEVEL_FLOOR[l.n - 1] || 0)) / (next - (LEVEL_FLOOR[l.n - 1] || 0))) : 100;
      document.title = nm(p.name) + " · Mathematics for Machine Learning";
      profileBox.innerHTML = `<header class="who-head"><h1>${esc(nm(p.name))}</h1>${linkedin(p).replace('class="li"', 'class="li big"')}
          ${p.owner ? "" : `<span class="lvl big">Level ${l.n} · ${esc(l.name)}</span>`}
          <p class="muted">Joined ${day(p.joined)}${p.mine ? ` · this is you · <button type="button" class="linkish" data-rename>change name</button>` : ""}</p>
          ${p.mine ? `<form class="li-form"><label>Your LinkedIn <input type="url" inputmode="url" placeholder="https://www.linkedin.com/in/your-name/" value="${esc(p.linkedin || "")}"></label>
            <button type="submit" class="btn small">Save</button><span class="muted">An icon by your name links to it. Leave it empty to remove it.</span></form>` : ""}</header>
        <div class="stats-row">
          <div><b>${d.karma}</b><span>Math Karma</span></div>
          <div><b>${d.points}</b><span>points from claps</span></div>
          <div><b>${d.solved.length}</b><span>problems solved</span></div>
          <div><b>${d.replies}</b><span>replies</span></div></div>
        ${p.owner ? "" : `<div class="karma-bar" title="${next ? `${next - d.karma} more Math Karma to the next level` : "Top level"}"><i style="width:${pct}%"></i></div>
        <p class="muted small">${next ? `${next - d.karma} more Math Karma to the next level.` : "The top level."} Karma: +10 for each problem you solve, +3 for a question, +2 for each reply.</p>`}
        <p class="foot links">${p.mine && !p.owner ? `<a class="btn accent small" href="/messages/">💬 Message Srijit</a>` : ""}
          ${p.mine && p.owner ? `<a class="btn accent small" href="/messages/">💬 Messages</a>` : ""}
          <a class="btn ghost small" href="/leaderboard/">Leaderboard</a>
          <a class="btn ghost small" href="https://srijitmukherjee.com/" target="_blank" rel="noopener">About Teacher</a></p>
        <h2>Solved</h2>
        ${d.solved.length ? `<div class="solved">${d.solved.map((s) => `<a class="scard" href="${PAGES}${encodeURIComponent(s.problem)}/${s.id ? `#post-${s.id}` : ""}">
            <span class="mod">${s.module ? `${esc(s.module)} · ${s.lesson}.${s.n}` : "Practice"}</span><b>${esc(s.title)}</b>
            <span class="when">${s.created ? `Solved ${day(s.created)}` : "Srijit's solution"}</span>
            ${s.id ? `<span class="nums">👏 ${s.claps}${s.grade != null ? ` · Srijit 👏 ${s.grade}/10` : ""} · ${s.replies} repl${s.replies === 1 ? "y" : "ies"}</span>` : ""}</a>`).join("")}</div>`
          : `<p class="soon">${p.mine ? "No solutions yet. Open a problem, press Solve and share yours." : "No solutions yet."}</p>`}`;
      const rn = profileBox.querySelector("[data-rename]");
      if (rn) rn.onclick = async () => { await rename(); show(); };
      const lf = profileBox.querySelector(".li-form");
      if (lf) lf.onsubmit = async (e) => {
        e.preventDefault();
        try { const r = await call("POST", "/me", { linkedin: lf.querySelector("input").value }); me = r.me; auth.setMe(me); toast(me.linkedin ? "LinkedIn link saved." : "LinkedIn link removed."); show(); }
        catch (err) { failed(err); }
      };
    }
    window.addEventListener("hashchange", show);
    show();
  }
  const LEVEL_FLOOR = [0, 10, 30, 75, 150, 300, 600];

  // -- leaderboard page and "latest discussion" on the home page ------------------------------------------
  function table(rows) {
    if (!rows.length) return `<p class="soon">No claps yet.</p>`;
    return `<ol class="lb">${rows.map((r, k) => `<li><span class="rank">${k + 1}</span><a class="who" href="/dashboard/#${r.id}">${esc(nm(r.name) || "Learner")}</a>${linkedin(r)}${lvl(r.level)}<span class="up">👏 ${r.points}</span></li>`).join("")}</ol>`;
  }
  // The leaderboard and "Latest" show at once (2026-11-03): this browser keeps the last ones it showed and draws them
  // straight away, then the page's own request (no extra one) brings the fresh ones a moment later.
  const paintBoard = (d) => { board.innerHTML = `<div class="lb-grid"><section><h2>This week</h2>${table(d.week)}</section><section><h2>All time</h2>${table(d.all)}</section></div>`; };
  async function startBoard() {
    const saved = store.get("last_board");
    if (saved && saved.week && saved.all) paintBoard(saved);
    await signIn(); // anyone can see it; signing in only adds the links' context
    try { // it comes with the page's request (cohort.js); on its own only if that failed
      const d = (await hello("board", () => call("GET", "/leaderboard").then((board) => ({ board })))).board;
      paintBoard(d); store.set("last_board", { week: d.week, all: d.all });
    } catch (err) { if (!saved) board.innerHTML = `<p class="soon">Couldn't load the leaderboard. Please reload.</p>`; }
  }
  // a post as one plain line: Markdown marks and LaTeX commands dropped, maths kept readable
  const plainLine = (t) => String(t).replace(/[#*_>`]+/g, "").replace(/\$+/g, "").replace(/\\(frac|dfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "$2/$3")
    .replace(/\\(left|right|displaystyle|mathrm|text|quad|,)/g, "").replace(/\\([a-zA-Z]+)/g, "$1 ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  function paintRecent(items, yes) {
    if (!items.length) {
      latest.innerHTML = `<h2>Latest in the discussion</h2><p class="soon">Nothing yet. Open a problem, solve it by hand and share your solution.</p>`;
      latest.hidden = false; return;
    }
    latest.innerHTML = `<h2>Latest in the discussion</h2><ul>${items.slice(0, 6).map((r) => `<li><a href="${PAGES}${encodeURIComponent(r.problem)}/#post-${r.post}">
        <span class="what"><b>${esc(nm(r.name) || "Learner")}</b> ${r.type === "comment" ? "replied on" : r.kind === "question" ? "asked about" : "shared a solution to"} <b>${esc(r.title)}</b></span>
        ${r.body ? `<span class="snip">${esc(plainLine(r.body))}</span>` : ""}<time>${ago(r.created)}</time></a></li>`).join("")}</ul>
      ${yes ? "" : `<p class="muted">Sign in to read them and join in.</p>`}`;
    latest.hidden = false; // previews are one plain line: no rendered maths (it would not fit a phone)
  }
  async function startRecent() { // everyone sees what's happening; opening a post asks to sign in
    const yes = !!(auth && auth.token()); // (Leaderboard → and About Teacher → are in the page itself, above this)
    const key = yes ? "last_latest_in" : "last_latest_out"; // the text of posts only ever for signed-in learners
    const saved = store.get(key);
    if (Array.isArray(saved) && saved.length) paintRecent(saved, yes);
    await signIn();
    try {
      const d = await hello("items", () => (yes ? call("GET", "/recent") : Promise.resolve({ items: [] })));
      paintRecent(d.items, yes); store.set(key, d.items.slice(0, 6));
    } catch (err) { /* the home page is fine without it */ }
  }

  // -- 💬 messages with Srijit, like WhatsApp: loads when opened, nothing polls ----------------------------------
  async function startChat() {
    if (!(await signIn())) {
      chatBox.innerHTML = `<h1>Messages</h1><div class="join"><p>Sign in to message Srijit.</p>
        <button type="button" class="btn accent small">Sign in</button></div>`;
      chatBox.querySelector("button").onclick = askToSignIn; return;
    }
    const when = (ms) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const bubble = (m, mineIsOwner) => `<div class="bub ${!!m.owner === mineIsOwner ? "me" : "them"}"><div class="txt">${md(m.body)}</div><time>${when(m.created)}</time></div>`;
    // 💬 (2026-11-03): this browser keeps each conversation it has shown (chat_<you>_<them>) and the inbox (inbox_<you>),
    // and draws them at once. The page's own request (cohort.js: hello, want "chat") then brings only the messages newer
    // than the last one kept (usually none); ↻ asks the same way. Nothing is loaded twice.
    let firstAsk = true;
    const ask = (uid, after) => {
      const get = () => call("GET", "/messages?" + new URLSearchParams({ ...(uid ? { u: uid } : {}), ...(after ? { after } : {}) }));
      if (!firstAsk) return get();
      firstAsk = false; // the first one came with the page's request
      return hello("chat", () => get().then((chat) => ({ chat }))).then((h) => h.chat);
    };
    async function inbox() {
      const key = `inbox_${me.id}`, saved = store.get(key);
      const draw = (list) => {
        chatBox.innerHTML = `<h1>Messages</h1>${list.length ? `<ul class="inbox">${list.map((t) => `<li><a href="#u${t.id}">
          <b>${esc(nm(t.name) || "Learner")}${t.unread ? ` <span class="cnt">${t.unread}</span>` : ""}</b><time>${ago(t.at)}</time>
          <span class="snip">${t.mine ? "You: " : ""}${esc(plainLine(t.body))}</span></a></li>`).join("")}</ul>`
        : `<p class="soon">No messages yet. When a learner writes to you, it shows up here and on 💬.</p>`}`;
      };
      if (Array.isArray(saved)) draw(saved); else chatBox.innerHTML = `<h1>Messages</h1><p class="soon">Loading…</p>`;
      try {
        const d = await ask(null, 0);
        if (d && Array.isArray(d.inbox)) { draw(d.inbox); store.set(key, d.inbox); }
      } catch (err) { if (!Array.isArray(saved)) throw err; } // keep the last one
    }
    async function thread(uid) {
      const owner = !!(me && me.owner), key = `chat_${me.id}_${uid || "srijit"}`, saved = store.get(key);
      let list = saved && Array.isArray(saved.messages) ? saved.messages : null, who = saved && saved.with;
      chatBox.innerHTML = `<header class="chat-head">${owner ? `<a class="quiet" href="#">← All</a>` : ""}<h1>${esc(owner ? nm((who && who.name) || "") : "Srijit")}</h1>
          <button type="button" class="linkish" data-reload title="Check for new messages">↻</button></header>
        <div class="msgs">${list ? "" : `<p class="soon">Loading…</p>`}</div>
        <form class="say"><textarea rows="1" maxlength="1000" placeholder="${owner ? "Reply" : "Message Srijit"}"></textarea><button type="submit" class="btn accent small">Send</button></form>`;
      const msgs = chatBox.querySelector(".msgs"), ta = chatBox.querySelector("textarea"), form = chatBox.querySelector("form");
      const head = chatBox.querySelector(".chat-head h1");
      const draw = () => {
        msgs.innerHTML = list.length ? list.map((m) => bubble(m, owner)).join("")
          : `<p class="soon">${owner ? "No messages yet." : "Ask Srijit anything about the problems. He'll reply here, and you'll see it on 💬."}</p>`;
        math(msgs); msgs.scrollTop = msgs.scrollHeight;
      };
      const keep = () => store.set(key, { with: who, messages: list.slice(-50) });
      const fresh = async () => { // only what's newer than the last message kept
        const after = list && list.length ? list[list.length - 1].id : 0;
        const d = await ask(uid, after);
        who = d.with; if (owner) head.textContent = nm(who.name);
        if (d.after && list) {
          const add = d.messages.filter((m) => !list.some((x) => x.id === m.id));
          if (!add.length) return keep();
          list = list.concat(add);
        } else list = d.messages;
        draw(); keep();
      };
      if (list) draw();
      chatBox.querySelector("[data-reload]").onclick = () => fresh().catch(failed);
      ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(max-width: 600px)").matches) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        const b = form.querySelector("button"); b.disabled = true;
        try {
          const r = await call("POST", "/messages", owner ? { body, to: uid } : { body });
          const empty = msgs.querySelector(".soon"); if (empty) empty.remove();
          msgs.insertAdjacentHTML("beforeend", bubble(r.message, owner)); math(msgs.lastElementChild);
          ta.value = ""; ta.style.height = "auto"; msgs.scrollTop = msgs.scrollHeight;
          list = (list || []).concat(r.message); keep();
        } catch (err) { failed(err); } finally { b.disabled = false; ta.focus(); }
      });
      await fresh().catch((err) => { if (!list) throw err; }); // with a kept copy shown, keep it if this fails
    }
    const route = () => {
      const m = location.hash.match(/^#u(\d+)$/);
      const go = me && me.owner ? (m ? thread(Number(m[1])) : inbox()) : thread(null);
      go.catch((err) => { chatBox.innerHTML = `<p class="soon">${esc(ERR[err.message] || "Couldn't load the messages. Please reload the page.")}</p>`; });
    };
    window.addEventListener("hashchange", route);
    route();
  }

  if (box) { bindDiscussion(); startDiscussion().then(() => API && sidebarCounts()).catch(() => signedOut()); }
  startSolve();
  if (API) signIn().then((yes) => { if (yes) { startBell(); nameToProfile(); } });
  if (board && API) startBoard();
  if (latest && API) startRecent();
  if (profileBox && API) startProfile();
  if (chatBox && API) startChat();
})();
