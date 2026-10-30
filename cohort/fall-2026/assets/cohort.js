// Fall 2026 cohort pages: sign-in ("Continue with Google"), visits, the learner count and a rotating "<name> joined.",
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
  let vid = store.get("cohort_vid");
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("cohort_vid", vid); }

  const math = (el) => el && window.renderMathInElement && renderMathInElement(el, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                 { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
    throwOnError: false });
  const cf = (path, body, auth) => fetch(CF + path, { method: body ? "POST" : "GET",
    headers: Object.assign({ "content-type": "application/json" }, auth && token ? { authorization: "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().then((d) => Object.assign({ status: r.status }, d)));
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };
  const signedIn = () => !!token;
  const shownName = () => (me && me.name) || "You";
  function keep(d) { token = d.token; me = d.me; store.set("community_token", token); store.set("community_me", me); }
  function clear() {
    token = null; me = null;
    ["community_token", "community_me"].forEach((k) => store.set(k, null));
    refresh();
  }

  // -- signing in: "Continue with Google" ------------------------------------------------------------------
  const modal = document.querySelector(".modal");
  const gbox = modal.querySelector(".google");
  let googleReady = false;
  function onGoogle(resp) {
    cf("/auth/google", { credential: resp.credential }).then((d) => {
      if (!d.ok) { toast("Google sign-in didn't work. Please try again."); return; }
      keep(d); modal.hidden = true; location.reload(); // every part of the page redraws signed in
    }).catch(() => toast("Couldn't reach the server. Please try again."));
  }
  function askToEnrol() {
    modal.hidden = false;
    if (!(CF && GOOGLE && window.google && window.google.accounts)) {
      gbox.querySelector(".gbtn").innerHTML = '<p class="soon">Loading Google sign-in… If it doesn\'t appear, reload the page.</p>';
      setTimeout(() => { if (!googleReady && window.google && window.google.accounts) askToEnrol(); }, 1500);
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

  const ready = Promise.resolve().then(() => refresh());
  window.cohortReady = ready;

  function refresh() {
    document.querySelectorAll("[data-enrol]").forEach((b) => {
      const header = b.classList.contains("enrol");
      b.classList.toggle("done", signedIn());
      b.textContent = signedIn() ? (header ? shownName() : "You're enrolled ✓") : (header ? "Enroll" : "Enroll in Fall 2026");
    });
    document.querySelectorAll("[data-guard]").forEach((el) => el.classList.toggle("locked", !signedIn()));
  }

  // -- visits (private analytics, in Cloudflare) -------------------------------------------------------------
  if (CF) cf("/visit", { vid, page: location.pathname }, true).catch(() => {});

  // -- the learner count and "<name> joined": from Cloudflare (refreshed every 2 minutes) ---------------------
  const enrolled = document.querySelector("[data-enrolled]");
  const ticker = document.querySelector("[data-ticker]");
  const stats = () => cf("/stats").catch(() => null);
  const shown = () => Number(enrolled.textContent.replace(/,/g, "")) || 0;
  const live = (d) => { if (enrolled && d && d.ok && d.learners >= shown()) enrolled.textContent = d.learners.toLocaleString(); return d; };
  if (CF && (enrolled || ticker)) {
    stats().then(live).then((d) => {
      const names = ((d && d.names) || []).filter((n) => n.length >= 3); // no initials ("Kd")
      if (!ticker || names.length < 2) return;
      const slot = ticker.querySelector("b");
      let k = 0;
      slot.textContent = names[0];
      ticker.hidden = false;
      setInterval(() => {
        slot.classList.add("fade");
        setTimeout(() => { k = (k + 1) % names.length; slot.textContent = names[k]; slot.classList.remove("fade"); }, 350);
      }, 2600);
    });
    if (enrolled) setInterval(() => { if (!document.hidden) stats().then(live); }, 120000); // every 2 min, only while the tab is in view
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
