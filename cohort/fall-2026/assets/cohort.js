// Fall 2026 cohort pages: enrolment with a magic link (first name + email -> emailed one-time link -> session),
// daily visits, a rotating "<name> joined.", and gated content (discussion: story + steps, and video). The backend is a
// Google Apps Script web app (window.COHORT.api); without it the problems still show.
(function () {
  const API = (window.COHORT || {}).api;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let user = store.get("cohort_user"); // {name, email, session} once the emailed link was opened
  if (user && !user.session) user = null;
  let vid = store.get("cohort_vid");
  if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("cohort_vid", vid); }

  const math = (el) => el && window.renderMathInElement && renderMathInElement(el, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                 { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }],
    throwOnError: false });
  const post = (data) => fetch(API, { method: "POST", body: JSON.stringify(data) }).then((r) => r.json());
  const get = (params) => fetch(API + "?" + new URLSearchParams(params)).then((r) => r.json());
  const toast = (msg) => {
    const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  };
  function signOut() { user = null; store.set("cohort_user", null); refresh(); }

  // -- enrolment: ask for name + email, email a sign-in link ------------------------------------------
  const modal = document.querySelector(".modal");
  const form = modal.querySelector("form");
  const sent = modal.querySelector(".sent");
  const msg = modal.querySelector(".msg");
  function askToEnrol() {
    form.hidden = false; sent.hidden = true; msg.textContent = "";
    modal.hidden = false; form.querySelector("input").focus();
  }
  modal.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { modal.hidden = true; }));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
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
  document.querySelectorAll("[data-enrol]").forEach((b) => (b.onclick = () => !user && askToEnrol()));

  // -- opening the emailed link: trade the one-time token for a session -------------------------------
  const token = new URLSearchParams(location.search).get("login");
  const signingIn = token && API ? post({ a: "verify", token }).then((d) => {
    history.replaceState(null, "", location.pathname + location.hash);
    if (d.ok) {
      user = { name: d.name, email: d.email, session: d.session };
      store.set("cohort_user", user);
      toast("Welcome, " + (d.name || "learner") + "! You're signed in.");
    } else {
      toast("That sign-in link has expired or was already used. Enrol again for a new one.");
    }
    refresh();
  }).catch(() => {}) : Promise.resolve();

  function refresh() {
    document.querySelectorAll("[data-enrol]").forEach((b) => {
      const header = b.classList.contains("enrol");
      b.classList.toggle("done", !!user);
      b.textContent = user ? (header ? user.name : "You're enrolled ✓") : (header ? "Enroll" : "Enroll in Fall 2026");
    });
    document.querySelectorAll("[data-guard]").forEach((el) => el.classList.toggle("locked", !user));
  }

  // -- visits (private analytics) ----------------------------------------------------------------------
  if (API) {
    signingIn.then(() => post({ a: "visit", vid, session: user ? user.session : "", page: location.pathname }))
      .then((d) => { if (d && d.ok && user && !d.signedIn) signOut(); }).catch(() => {});
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

  // -- gated actions on a problem page: Story / Discussion / Video open below ---------------------------
  const actions = document.querySelector(".actions");
  const panel = document.querySelector(".panel");
  const TITLES = { discussion: "Discussion", video: "Video" };
  let content = null;
  let open = null;
  function paragraphs(text) {
    text.split(/\n+/).forEach((para) => {
      const p = document.createElement("p"); p.textContent = para; panel.appendChild(p);
    });
  }
  function show(kind) {
    open = kind;
    actions.querySelectorAll("button").forEach((b) => b.setAttribute("aria-expanded", b.dataset.gate === kind));
    const c = content || {};
    panel.innerHTML = "<h2>" + TITLES[kind] + "</h2>";
    if (kind === "video") {
      const id = (c.video_url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
      panel.insertAdjacentHTML("beforeend", id ? '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' +
        id[1] + '" allowfullscreen title="Video"></iframe></div>' : '<p class="soon">The video for this problem is coming soon.</p>');
    } else if (c.story || c.solution) {
      // the idea first, then the solution
      if (c.story) { panel.insertAdjacentHTML("beforeend", "<h3>Idea</h3>"); paragraphs(c.story); }
      if (c.solution) { panel.insertAdjacentHTML("beforeend", "<h3>Solution</h3>"); paragraphs(c.solution); }
    } else {
      panel.insertAdjacentHTML("beforeend", '<p class="soon">The discussion for this problem is coming soon.</p>');
    }
    panel.hidden = false;
    math(panel);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function close() {
    open = null; panel.hidden = true;
    actions.querySelectorAll("button").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }
  let loading = null; // the content request, started as soon as a signed-in learner opens the page
  function load() {
    if (!loading) {
      loading = get({ a: "content", id: actions.dataset.id, session: user.session }).then((d) => {
        if (d.error === "session") { signOut(); loading = null; return null; }
        content = d.ok ? d : {};
        return content;
      }).catch(() => { loading = null; return null; });
    }
    return loading;
  }
  if (actions && user && API) signingIn.then(() => user && load());
  if (actions) {
    actions.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-gate]");
      if (!b) return;
      if (!user) return askToEnrol();
      const kind = b.dataset.gate;
      if (open === kind) return close();
      if (content) return show(kind);
      // still on its way: open the panel at once so the click visibly does something
      open = kind;
      actions.querySelectorAll("button").forEach((x) => x.setAttribute("aria-expanded", x.dataset.gate === kind));
      panel.innerHTML = "<h2>" + TITLES[kind] + "</h2><p class=\"soon\">Loading…</p>";
      panel.hidden = false;
      b.disabled = true;
      load().then((c) => {
          if (!user) { close(); askToEnrol(); return; }
          if (!c) { toast("Couldn't load it. Please try again."); close(); return; }
          if (open === kind) show(kind);
        })
        .finally(() => (b.disabled = false));
    });
  }
  document.addEventListener("copy", (e) => {
    const node = document.getSelection().anchorNode;
    if (!user && node && node.parentElement && node.parentElement.closest("[data-guard]")) {
      e.preventDefault(); askToEnrol();
    }
  });

  refresh();
  math(document.querySelector("main"));
})();
