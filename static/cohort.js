// Fall 2026 cohort pages: sign-in ("Continue with Google"), the learner count and a rotating "<name> joined.",
// and the Video panel. Everything goes through the Cloudflare Worker (window.COHORT.community); the Apps Script is no
// longer used (2026-10-30). Other scripts use window.srijitAuth (ready, token, me, signIn, clear, setMe).
(function () {
  const CFG = window.COHORT || {};
  const CF = CFG.community, GOOGLE = CFG.google;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let token = store.get("community_token"), me = store.get("community_me"); // the Worker's sign-in
  if (!token || !me) { token = null; me = null; }
  store.set("cohort_user", null); // the old Apps Script sign-in: no longer used
  store.set("cohort_vid", null); // the old visitor number: visits are no longer logged (2026-10-30)

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
  // cohort.js now loads before KaTeX (2026-11-09), so the page's one request ("/hello") starts at once instead of after
  // ~350 KB of libraries; maths asked for before KaTeX is there waits for the page's load event.
  const math = (el) => {
    if (!el) return;
    if (!window.renderMathInElement) { if (document.readyState !== "complete") window.addEventListener("load", () => math(el), { once: true }); return; }
    if (guardKatex()) renderMathInElement(el, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                   { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
      throwOnError: false });
  };
  const cf = (path, body, auth) => fetch(CF + path, { method: body ? "POST" : "GET",
    headers: Object.assign({ "content-type": "application/json" }, auth && token ? { authorization: "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().then((d) => Object.assign({ status: r.status }, d)));
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };
  const signedIn = () => !!token;
  const nm = (s) => String(s || "").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); // "JAYANT" -> "Jayant"
  const shownName = () => (me && nm(me.name)) || "You";
  function keep(d) { token = d.token; me = d.me; store.set("community_token", token); store.set("community_me", me); }
  function clear() {
    token = null; me = null;
    ["community_token", "community_me", "last_latest_in", "kept_profiles", "kept_threads", "last_profile"].forEach((k) => store.set(k, null)); // and what was signed-in only:
    try { Object.keys(localStorage).filter((k) => /^(bell|chat|inbox)_/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* private mode */ }
    refresh();
    if (CF) loadGoogle(); // signed out now: they'll need the sign-in button
  }

  // -- signing in: "Continue with Google" ------------------------------------------------------------------
  const modal = document.querySelector(".modal");
  const gbox = modal.querySelector(".google");
  let googleReady = false;
  // Google's sign-in script (2026-11-03): loaded only for someone who isn't signed in (or when a sign-in has run out),
  // so a signed-in learner's pages don't fetch and run it at all
  let googleScript = null;
  function loadGoogle() {
    if (googleScript || !GOOGLE || (window.google && window.google.accounts)) return;
    googleScript = Object.assign(document.createElement("script"), { src: "https://accounts.google.com/gsi/client", async: true });
    googleScript.onload = () => { if (!modal.hidden && !googleReady) askToEnrol(); }; // the button appears as soon as it can
    document.head.appendChild(googleScript);
  }
  function onGoogle(resp) {
    cf("/auth/google", { credential: resp.credential }).then((d) => {
      if (!d.ok) { toast(d.error === "resting" ? "Sign-in is taking a short break. Please try again in a little while."
        : "Google sign-in didn't work. Please try again."); return; }
      keep(d); modal.hidden = true; location.reload(); // every part of the page redraws signed in
    }).catch(() => toast("Couldn't reach the server. Please try again."));
  }
  function askToEnrol() {
    modal.hidden = false;
    if (!(CF && GOOGLE && window.google && window.google.accounts)) {
      gbox.querySelector(".gbtn").innerHTML = '<p class="soon">Loading Google sign-in… If it doesn\'t appear, reload the page.</p>';
      loadGoogle(); // its onload shows the button
      return;
    }
    if (!googleReady) {
      window.google.accounts.id.initialize({ client_id: GOOGLE, callback: onGoogle, ux_mode: "popup" });
      gbox.querySelector(".gbtn").innerHTML = "";
      window.google.accounts.id.renderButton(gbox.querySelector(".gbtn"),
        { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: 300 });
      googleReady = true;
    }
  }
  modal.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { modal.hidden = true; }));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  document.querySelectorAll("[data-enrol]").forEach((b) => (b.onclick = () => !signedIn() && askToEnrol()));
  if (!token && CF) loadGoogle(); // signed out: have the button ready for when they press Enroll

  // -- the ☰ menu: Dashboard, Roadmap, Books -------------------------------------------------------------------
  const menuBtn = document.querySelector("[data-menu]"), menuList = document.querySelector(".menulist");
  if (menuBtn && menuList) {
    const close = () => { menuList.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); };
    menuBtn.onclick = (e) => { e.stopPropagation(); const open = menuList.hidden; menuList.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); };
    document.addEventListener("click", (e) => { if (!menuList.hidden && !e.target.closest(".menu")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    menuList.querySelector("a").addEventListener("click", (e) => { if (!signedIn()) { e.preventDefault(); close(); askToEnrol(); } }); // Dashboard
  }

  // -- the two levels (2026-11-03): "Start solving" leads to /start/, which asks which one; a level's link (there, and
  // the switch at the top of a problem) leads back to the problem you were last on in it. Kept in this browser only.
  const here = document.querySelector("[data-here]");
  if (here) { store.set("level", here.dataset.here); store.set("level_" + here.dataset.here, location.pathname); }
  document.querySelectorAll("a[data-level]:not([aria-current])").forEach((a) => {
    const last = store.get("level_" + a.dataset.level);
    if (typeof last !== "string" || !last.startsWith(CFG.problems || "/problems/")) return;
    a.href = last;
    const go = a.querySelector("small");
    if (go) go.textContent = "Continue →";
  });

  const ready = Promise.resolve().then(() => refresh());
  window.cohortReady = ready;

  function refresh() {
    // the Blog menu item: everyone sees it once a post is published (the page says so); Srijit always, to write
    document.querySelectorAll("[data-blog]").forEach((a) => {
      if (me && me.owner) { a.hidden = false; a.href = "/blog/write/"; }
    });
    document.querySelectorAll("[data-enrol]").forEach((b) => {
      const header = b.classList.contains("enrol");
      b.classList.toggle("done", signedIn());
      b.textContent = signedIn() ? (header ? shownName() : "You're enrolled ✓") : (header ? "Enroll" : "Enroll in Fall 2026");
      if (header) b.hidden = signedIn(); // signed in, "Dashboard" in the menu goes to the same place
    });
    document.querySelectorAll("[data-guard]").forEach((el) => el.classList.toggle("locked", !signedIn()));
  }

  // -- one request per page ("/hello"): everything this page shows -----------------------------------------------
  // (the learner count, the sidebar counts, the latest posts, the bell's number, the problem's ♥ and my solution,
  // and for the adaptive path, my record).
  // community.js reads it from window.cohortHello. Nothing polls: Cloudflare counts every request.
  const enrolled = document.querySelector("[data-enrolled]");
  const ticker = document.querySelector("[data-ticker]");
  const discuss = document.querySelector("[data-discuss]");
  const want = [];
  const talk = document.querySelector("[data-talk]");
  if (enrolled || ticker) want.push("stats");
  if (talk) want.push("counts"); // the sidebar's cached counts: their total is the "discussions" number
  if (document.querySelector(".side li a")) want.push("counts");
  if (document.querySelector("[data-recent]")) want.push("recent");
  if (document.querySelector("[data-more], [data-path], [data-stuck]")) want.push("path"); // what I've solved, my grades, "Stuck?"
  const profileBox = document.querySelector("[data-profile]");
  if (profileBox && token) want.push("profile"); // the dashboard comes with the page's request (2026-11-03), not a second one
  if (document.querySelector("[data-leaderboard]")) want.push("board"); // and so does the leaderboard
  const blogPost = document.querySelector("[data-love]"); // a blog post: its ❤️ come with the page's request too
  if (blogPost) want.push("blog");
  // 💬: the conversation on the messages page, only what's newer than the last message this browser kept (community.js)
  let chatU, chatAfter;
  if (document.querySelector("[data-messages]") && token && me) {
    want.push("chat");
    const m = location.hash.match(/^#u(\d+)$/);
    chatU = me.owner && m ? m[1] : undefined;
    const kept = !me.owner || chatU ? store.get(`chat_${me.id}_${chatU || "srijit"}`) : null; // Srijit's inbox: always whole
    const last = kept && Array.isArray(kept.messages) && kept.messages[kept.messages.length - 1];
    chatAfter = last ? last.id : undefined;
  }
  // a signed-out visitor on a page that shows nothing live (Start, Books, Roadmap, Privacy): no request at all
  const hello = !CF || (!token && !want.length && !discuss) ? Promise.resolve(null) : cf("/hello", { want,
      problem: discuss ? discuss.dataset.discuss : undefined, u: profileBox ? location.hash.slice(1) || "me" : undefined,
      chat_u: chatU, chat_after: chatAfter, blog_post: blogPost ? blogPost.dataset.love : undefined }, true)
    .then((d) => { if (d.ok && token && !d.signedIn) clear(); return d.ok ? d : null; }) // a sign-in that has run out
    .catch(() => null);
  window.cohortHello = hello;

  // -- one clock for everything that takes turns: "Machine Learning" / "Quant Finance" (headline and header, .swap)
  // and "<name> joined.", so they change at the same moment, every 2.6 s ------------------------------------------
  const EVERY = 2600;
  const onTick = [() => document.querySelectorAll(".swap").forEach((s) => s.classList.toggle("alt"))];
  setInterval(() => onTick.forEach((f) => f()), EVERY);

  // -- the learner count and "<name> joined" ------------------------------------------------------------------
  // rounded down, so the line never overstates: 2,370 -> "2.3k+" (2.4k+ from 2,400), 116 -> "110+"
  const short = (n) => (n >= 1000 ? Math.floor(n / 100) / 10 + "k+" : String(n));
  const shown = () => Number(enrolled.dataset.n) || 0;
  // The last numbers this browser saw, shown at once, so a refresh doesn't wait for the request (2026-11-09: the line
  // filled in a moment after every refresh). The request then brings them up to date, quietly.
  const proof = store.get("home_proof") || {};
  const setCount = (n) => { if (enrolled && n >= shown()) { enrolled.dataset.n = n; enrolled.textContent = short(n); } };
  const setTalk = (n) => {
    if (!talk || !n) return;
    talk.querySelector("b").textContent = n >= 10 ? Math.floor(n / 10) * 10 + "+" : String(n);
    talk.hidden = false;
  };
  let names = [], k = 0, rolling = false;
  const setNames = (list) => {
    list = (list || []).filter((n) => n.length >= 3).map(nm); // no initials ("Kd")
    if (!ticker || list.length < 2) return;
    names = list; k = 0;
    const slot = ticker.querySelector("b");
    slot.textContent = names[0];
    ticker.hidden = false;
    if (rolling) return;
    rolling = true;
    onTick.push(() => { // on the shared clock, with the headline
      slot.classList.add("fade");
      setTimeout(() => { k = (k + 1) % names.length; slot.textContent = names[k]; slot.classList.remove("fade"); }, 350);
    });
  };
  if (CF && (enrolled || ticker || talk)) {
    setCount(proof.learners || 0); setTalk(proof.talk || 0); setNames(proof.names);
    hello.then((d) => {
      if (!d) return;
      const keep = Object.assign({}, proof);
      if (d.learners) { setCount(d.learners); keep.learners = d.learners; }
      if (d.names && d.names.length >= 2 && !proof.names) setNames(d.names); // already rolling kept names: no jump mid-line
      if (d.names) keep.names = d.names;
      if (talk && d.counts) { keep.talk = Object.values(d.counts).reduce((a, b) => a + b, 0); setTalk(keep.talk); }
      store.set("home_proof", keep);
    });
  }

  // -- Srijit's solution and video for this problem (pinned in the discussion; Video opens below) ------------
  const actions = document.querySelector(".actions");
  const panel = document.querySelector(".panel");
  let content = null;
  let loading = null;
  function load() {
    if (!loading) {
      loading = cf("/content?p=" + encodeURIComponent(actions.dataset.slug || ""), null, true).then((d) => {
        if (d.status === 401) { clear(); loading = null; return null; }
        content = d.ok ? d : {};
        return content;
      }).catch(() => { loading = null; return null; });
    }
    return loading;
  }
  window.cohortContent = () => ready.then(() => (actions && signedIn() ? load() : null)); // used by community.js
  function showVideo() {
    const c = content || {};
    const id = (c.video_url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
    panel.innerHTML = "<h2>Video</h2>" + (id ? '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' +
      id[1] + '" allowfullscreen title="Video"></iframe></div>' : '<p class="soon">The video for this problem is coming soon.</p>');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  if (actions) {
    actions.addEventListener("click", (e) => {
      const b = e.target.closest('button[data-gate="video"]'); // Solve and Discuss are community.js
      if (!b) return;
      if (!signedIn()) return askToEnrol();
      ["discuss", "solve"].forEach((g) => { // one panel at a time
        const sec = document.querySelector(`[data-${g}]`), btn = actions.querySelector(`[data-gate="${g}"]`);
        if (sec) sec.hidden = true;
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
      if (b.getAttribute("aria-expanded") === "true") { b.setAttribute("aria-expanded", "false"); panel.hidden = true; return; }
      b.setAttribute("aria-expanded", "true");
      if (content) return showVideo();
      panel.innerHTML = "<h2>Video</h2><p class=\"soon\">Loading…</p>"; panel.hidden = false; b.disabled = true;
      load().then((c) => {
        if (!signedIn()) { panel.hidden = true; askToEnrol(); return; }
        if (!c) { toast("Couldn't load it. Please try again."); panel.hidden = true; b.setAttribute("aria-expanded", "false"); return; }
        showVideo();
      }).finally(() => (b.disabled = false));
    });
  }
  document.addEventListener("copy", (e) => {
    const node = document.getSelection().anchorNode;
    if (!signedIn() && node && node.parentElement && node.parentElement.closest("[data-guard]")) {
      e.preventDefault(); askToEnrol();
    }
  });

  window.srijitAuth = {
    ready, token: () => token, me: () => me, signIn: askToEnrol, clear,
    setMe(m) { me = m; store.set("community_me", me); refresh(); },
    session: () => null,
  };
  refresh();
  math(document.querySelector("main"));
})();
