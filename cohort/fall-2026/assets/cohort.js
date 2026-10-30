// Fall 2026 cohort pages: sign-in, daily visits, the learner count and a rotating "<name> joined.", and the Video panel.
// With the community Worker (window.COHORT.community, Cloudflare) sign-in is "Continue with Google", with a sign-in
// link by email as the fallback, and Srijit's solutions and videos come from the Worker. Without it the older Apps
// Script sign-in and content are used (window.COHORT.api). The Apps Script also keeps the learner list, visits and
// the email links. Other scripts use window.srijitAuth (ready, token, me, signIn, clear, setMe).
(function () {
  const CFG = window.COHORT || {};
  const API = CFG.api, CF = CFG.community, GOOGLE = CFG.google;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let user = store.get("cohort_user"); // Apps Script session {name, email, session}: the emailed link, older sign-ins
  if (user && !user.session) user = null;
  let token = store.get("community_token"), me = store.get("community_me"); // the Worker's sign-in
  if (!CF || !token || !me) { token = null; me = null; }
  let vid = store.get("cohort_vid");
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("cohort_vid", vid); }

  const math = (el) => el && window.renderMathInElement && renderMathInElement(el, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                 { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
    throwOnError: false });
  const post = (data) => fetch(API, { method: "POST", body: JSON.stringify(data) }).then((r) => r.json());
  const get = (params) => fetch(API + "?" + new URLSearchParams(params)).then((r) => r.json());
  const cf = (path, body, auth) => fetch(CF + path, { method: body ? "POST" : "GET",
    headers: Object.assign({ "content-type": "application/json" }, auth ? { authorization: "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().then((d) => Object.assign({ status: r.status }, d)));
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };
  const signedIn = () => (CF ? !!token : !!user);
  const shownName = () => (CF ? (me && me.name) : (user && user.name)) || "You";
  function keep(d) { token = d.token; me = d.me; store.set("community_token", token); store.set("community_me", me); }
  function clear() {
    user = null; token = null; me = null;
    ["cohort_user", "community_token", "community_me"].forEach((k) => store.set(k, null));
    refresh();
  }
  // an Apps Script session (emailed link, or an older sign-in) -> the Worker's token
  const exchange = (session) => cf("/auth", { session }).then((d) => { if (d.ok) keep(d); return d.ok; }).catch(() => false);

  // -- signing in: "Continue with Google", or a link by email ---------------------------------------------
  const modal = document.querySelector(".modal");
  const form = modal.querySelector("form");
  const sent = modal.querySelector(".sent");
  const msg = modal.querySelector(".msg");
  const gbox = modal.querySelector(".google");
  let googleReady = false;
  function onGoogle(resp) {
    cf("/auth/google", { credential: resp.credential }).then((d) => {
      if (!d.ok) { toast("Google sign-in didn't work. Try again, or use the email link."); return; }
      keep(d); modal.hidden = true; location.reload(); // every part of the page redraws signed in
    }).catch(() => toast("Couldn't reach the server. Please try again."));
  }
  function showGoogle() {
    if (!(CF && GOOGLE && gbox && window.google && window.google.accounts)) return false;
    if (!googleReady) {
      window.google.accounts.id.initialize({ client_id: GOOGLE, callback: onGoogle, ux_mode: "popup" });
      window.google.accounts.id.renderButton(gbox.querySelector(".gbtn"),
        { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: 300 });
      googleReady = true;
    }
    gbox.hidden = false; form.hidden = true; sent.hidden = true;
    return true;
  }
  function askToEnrol() {
    msg.textContent = "";
    modal.hidden = false;
    if (showGoogle()) return;
    if (gbox) gbox.hidden = true;
    form.hidden = false; sent.hidden = true; form.querySelector("input").focus();
  }
  modal.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { modal.hidden = true; }));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  const byEmail = modal.querySelector("[data-email]");
  if (byEmail) byEmail.onclick = () => { gbox.hidden = true; form.hidden = false; form.querySelector("input").focus(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!API) { msg.textContent = "Enrolment opens soon."; return; }
    const f = new FormData(form);
    const email = f.get("email").trim().toLowerCase();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true; msg.textContent = "";
    post({ a: "enrol", name: f.get("name").trim(), email, back: location.origin + location.pathname })
      .then((d) => {
        if (d.ok) {
          form.hidden = true; sent.hidden = false;
          sent.querySelector("b").textContent = email;
        } else {
          msg.textContent = d.error === "wait" ? "We already sent you a few links. Check your inbox (and spam), or try again in an hour."
            : d.error === "email" ? "That email doesn't look right." : "Something went wrong. Please try again.";
        }
      })
      .catch(() => { msg.textContent = "Couldn't reach the server. Please try again."; })
      .finally(() => (button.disabled = false));
  };
  document.querySelectorAll("[data-enrol]").forEach((b) => (b.onclick = () => !signedIn() && askToEnrol()));

  // -- opening the emailed link (and moving older sign-ins over to the Worker) ----------------------------
  const linkToken = new URLSearchParams(location.search).get("login");
  const signingIn = (linkToken && API ? post({ a: "verify", token: linkToken }).then(async (d) => {
    history.replaceState(null, "", location.pathname + location.hash);
    if (!d.ok) { toast("That sign-in link has expired or was already used. Ask for a new one."); return; }
    user = { name: d.name, email: d.email, session: d.session };
    store.set("cohort_user", user);
    if (CF && !(await exchange(d.session))) { toast("Signed in, but the discussion couldn't start. Please reload."); return; }
    toast("Welcome, " + (d.name || shownName()) + "! You're signed in.");
  }).catch(() => {}) : Promise.resolve())
    .then(() => (CF && !token && user ? exchange(user.session) : null)) // signed in before Google sign-in existed
    .then(() => refresh());
  window.cohortReady = signingIn;

  function refresh() {
    document.querySelectorAll("[data-enrol]").forEach((b) => {
      const header = b.classList.contains("enrol");
      b.classList.toggle("done", signedIn());
      b.textContent = signedIn() ? (header ? shownName() : "You're enrolled ✓") : (header ? "Enroll" : "Enroll in Fall 2026");
    });
    document.querySelectorAll("[data-guard]").forEach((el) => el.classList.toggle("locked", !signedIn()));
  }

  // -- visits (private analytics) ----------------------------------------------------------------------
  if (API) {
    signingIn.then(() => post({ a: "visit", vid, session: user ? user.session : "", page: location.pathname }))
      .then((d) => { if (!CF && d && d.ok && user && !d.signedIn) clear(); }).catch(() => {});
  }

  // -- the learner count: live from the sheet, once it passes the published number ----------------------
  const enrolled = document.querySelector("[data-enrolled]");
  if (enrolled && API) {
    get({ a: "attended" }).then((d) => {
      if (d.enrolled > Number(enrolled.textContent.replace(/,/g, ""))) enrolled.textContent = d.enrolled.toLocaleString();
    }).catch(() => {});
  }

  // -- "<name> joined": real first names from the learner list, one at a time ------------------------
  const ticker = document.querySelector("[data-ticker]");
  if (ticker && API) {
    get({ a: "learners" }).then((d) => {
      const names = (d.names || []).filter((n) => n.length >= 3); // no initials ("Kd")
      if (names.length < 2) return;
      const slot = ticker.querySelector("b");
      let k = 0;
      slot.textContent = names[0];
      ticker.hidden = false;
      setInterval(() => {
        slot.classList.add("fade");
        setTimeout(() => { k = (k + 1) % names.length; slot.textContent = names[k]; slot.classList.remove("fade"); }, 350);
      }, 2600);
    }).catch(() => {});
  }

  // -- Srijit's solution and video for this problem (pinned in the discussion; Video opens below) ------------
  const actions = document.querySelector(".actions");
  const panel = document.querySelector(".panel");
  let content = null;
  let loading = null;
  function load() {
    if (!loading) {
      const ask = CF ? cf("/content?p=" + encodeURIComponent(actions.dataset.slug || ""), null, true)
        : post({ a: "content", id: actions.dataset.id, session: user.session });
      loading = ask.then((d) => {
        if (d.error === "session") { clear(); loading = null; return null; }
        content = d.ok ? d : {};
        return content;
      }).catch(() => { loading = null; return null; });
    }
    return loading;
  }
  window.cohortContent = () => signingIn.then(() => (actions && signedIn() ? load() : null)); // used by community.js
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
      const b = e.target.closest("button[data-gate]");
      if (!b) return;
      if (!signedIn()) return askToEnrol();
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
    ready: signingIn, token: () => token, me: () => me, signIn: askToEnrol, clear,
    setMe(m) { me = m; store.set("community_me", me); refresh(); },
    session: () => (user ? user.session : null), // Apps Script session, for the older content path
  };
  refresh();
  math(document.querySelector("main"));
})();
