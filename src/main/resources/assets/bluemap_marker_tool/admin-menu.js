/* BlueMap Marker Tool admin entry and password gate. */
(function () {
  "use strict";
  if (window.__blueMapMarkerAdminLoaded) return;
  window.__blueMapMarkerAdminLoaded = true;

  const STORAGE_KEY = "bluemap-marker-tool-password";
  let apiUrl = null;
  let editorPanel = null;
  let loginModal = null;
  let loginMessage = null;
  let passwordInput = null;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const requestUrl = typeof input === "string" ? input : input && input.url ? input.url : "";
    const requestMethod = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const isMarkerApi = requestUrl.includes("/xyn/markers");

    // When BlueMap is served over HTTPS (for example through Cloudflare Tunnel),
    // route marker requests through the same origin to avoid mixed-content errors.
    if (isMarkerApi && window.location.protocol === "https:") {
      const sameOriginUrl = window.location.origin + "/xyn/markers";
      if (typeof input === "string") input = sameOriginUrl;
      else if (input instanceof Request) input = new Request(sameOriginUrl, input);
    }

    if (requestMethod === "POST" && isMarkerApi) {
      const password = sessionStorage.getItem(STORAGE_KEY);
      const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      if (password) headers.set("Authorization", "Bearer " + password);
      init = Object.assign({}, init || {}, { headers });
    }

    return originalFetch(input, init);
  };

  fetch("/xyn-config.json")
    .then((response) => response.ok ? response.json() : null)
    .then((config) => {
      if (config && config.apiPort) {
        apiUrl = window.location.protocol === "https:"
          ? "/xyn/markers"
          : "http://" + window.location.hostname + ":" + config.apiPort + "/xyn/markers";
      }
    })
    .catch(() => {});

  let spaceHeld = false;
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.target.matches("input,textarea")) spaceHeld = true;
    if (event.code === "Tab" && spaceHeld) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceHeld = false;
  }, true);

  const style = document.createElement("style");
  style.textContent = `
    #xynAdminLoginBackdrop {
      position: fixed;
      inset: 0;
      z-index: 10020;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, .48);
      font-family: system-ui, sans-serif;
    }
    #xynAdminLogin {
      width: min(360px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 18px;
      border-radius: 12px;
      background: rgba(18, 20, 24, .98);
      color: #eee;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .55);
      border: 1px solid rgba(255, 255, 255, .12);
    }
    #xynAdminLogin h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }
    #xynAdminLogin input {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 10px;
      margin: 5px 0 10px;
      border: 1px solid #555;
      border-radius: 6px;
      background: #101216;
      color: #fff;
      font: inherit;
    }
    #xynAdminLogin .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    #xynAdminLogin button {
      padding: 8px 12px;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      color: #fff;
      background: #3b6ea8;
    }
    #xynAdminLogin button.secondary {
      background: #444;
    }
    #xynAdminLoginMessage {
      min-height: 18px;
      margin-bottom: 8px;
      color: #ff9d9d;
      font-size: 12px;
    }
    #xynAdminLogout {
      width: 100%;
      margin-top: 8px;
      padding: 7px;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      color: #fff;
      background: #654;
    }
  `;
  document.head.appendChild(style);

  function ensureLoginModal() {
    if (loginModal) return;

    loginModal = document.createElement("div");
    loginModal.id = "xynAdminLoginBackdrop";
    loginModal.innerHTML = `
      <div id="xynAdminLogin" role="dialog" aria-modal="true" aria-labelledby="xynAdminLoginTitle">
        <h2 id="xynAdminLoginTitle">管理者ログイン</h2>
        <label for="xynAdminPassword">パスワード</label>
        <input id="xynAdminPassword" type="password" autocomplete="current-password">
        <div id="xynAdminLoginMessage"></div>
        <div class="actions">
          <button type="button" class="secondary" id="xynAdminCancel">キャンセル</button>
          <button type="button" id="xynAdminSubmit">ログイン</button>
        </div>
      </div>`;
    document.body.appendChild(loginModal);

    passwordInput = loginModal.querySelector("#xynAdminPassword");
    loginMessage = loginModal.querySelector("#xynAdminLoginMessage");
    loginModal.querySelector("#xynAdminCancel").onclick = closeLogin;
    loginModal.querySelector("#xynAdminSubmit").onclick = submitLogin;
    passwordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitLogin();
    });
    loginModal.addEventListener("pointerdown", (event) => {
      if (event.target === loginModal) closeLogin();
    });
  }

  function openLogin() {
    ensureLoginModal();
    loginMessage.textContent = "";
    passwordInput.value = "";
    loginModal.style.display = "flex";
    setTimeout(() => passwordInput.focus(), 0);
  }

  function closeLogin() {
    if (loginModal) loginModal.style.display = "none";
  }

  async function submitLogin() {
    const password = passwordInput.value;
    if (!password) {
      loginMessage.textContent = "パスワードを入力してください．";
      return;
    }

    if (!apiUrl) {
      loginMessage.textContent = "Marker APIの設定を読み込めませんでした．";
      return;
    }

    loginMessage.textContent = "確認中…";
    sessionStorage.setItem(STORAGE_KEY, password);

    try {
      const current = await originalFetch(apiUrl);
      if (!current.ok) throw new Error("GET " + current.status);
      const body = await current.text();
      const verify = await window.fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });

      if (verify.status === 403) {
        sessionStorage.removeItem(STORAGE_KEY);
        loginMessage.textContent = "パスワードが違います．";
        passwordInput.select();
        return;
      }
      if (!verify.ok) throw new Error("POST " + verify.status);

      closeLogin();
      showEditor();
    } catch (error) {
      sessionStorage.removeItem(STORAGE_KEY);
      loginMessage.textContent = "Marker APIに接続できませんでした．";
      console.warn("BlueMap Marker Tool admin login failed", error);
    }
  }

  function locateEditorPanel() {
    editorPanel = document.getElementById("xynPanel");
    return editorPanel;
  }

  function showEditor() {
    if (!locateEditorPanel()) {
      setTimeout(showEditor, 200);
      return;
    }
    editorPanel.style.display = "";
    addLogoutButton();
  }

  function hideEditor() {
    if (locateEditorPanel()) editorPanel.style.display = "none";
  }

  function addLogoutButton() {
    if (!editorPanel || editorPanel.querySelector("#xynAdminLogout")) return;
    const button = document.createElement("button");
    button.id = "xynAdminLogout";
    button.type = "button";
    button.textContent = "ログアウト";
    button.onclick = () => {
      sessionStorage.removeItem(STORAGE_KEY);
      hideEditor();
    };
    editorPanel.appendChild(button);
  }

  function openAdmin() {
    if (sessionStorage.getItem(STORAGE_KEY)) showEditor();
    else openLogin();
  }

  function addSidebarButton() {
    const buttonList = document.querySelector(".side-menu .content")?.children.item(0);
    if (!buttonList || buttonList.querySelector("#xynAdminMenuButton")) return;

    const separator = document.createElement("hr");
    separator.dataset.xynAdmin = "separator";

    const button = document.createElement("div");
    button.id = "xynAdminMenuButton";
    button.className = "simple-button";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.innerHTML = '<div class="label">🔐 管理者画面</div>';
    button.onclick = openAdmin;
    button.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAdmin();
      }
    };

    buttonList.append(separator, button);
  }

  setInterval(() => {
    addSidebarButton();
    if (!editorPanel) locateEditorPanel();
    if (editorPanel && sessionStorage.getItem(STORAGE_KEY) && editorPanel.style.display !== "none") {
      addLogoutButton();
    }
  }, 250);

  hideEditor();
})();
