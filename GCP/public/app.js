// ===============================
// API BASE URL (Firebase Hosting, same-origin rewrites)
// ===============================
const API_BASE = (window.API_BASE_URL || "").replace(/\/+$/, "");


/***********************
 * Helpers
 ***********************/
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return [...document.querySelectorAll(sel)]; }

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}



/***********************
 * API helpers
 ***********************/
function apiUrl(path) {
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}


function pickImageUrl(p) {
  const u =
    p.thumb_url ||
    p.full_url ||
    p.image_url ||
    p.url ||
    "";

  return u;
}


async function apiGet(path) {
  const r = await fetch(apiUrl(path), { method: "GET" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.detail || data?.error || `GET ${path} failed (${r.status})`);
  return data;
}

async function apiPost(path, body) {
  const r = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.detail || data?.error || `POST ${path} failed (${r.status})`);
  return data;
}

async function apiDelete(path) {
  const r = await fetch(apiUrl(path), { method: "DELETE" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.detail || data?.error || `DELETE ${path} failed (${r.status})`);
  return data;
}

/***********************
 * Theme Toggle
 ***********************/
function initThemeSwitch() {
  const toggle = $("#themeToggle");
  const saved = localStorage.getItem("theme") || "dark"; // default dark

  document.body.classList.toggle("light-theme", saved === "light");
  if (toggle) toggle.checked = (saved === "dark"); // checked = dark

  toggle?.addEventListener("change", () => {
    const isDark = toggle.checked;
    document.body.classList.toggle("light-theme", !isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });
}

/***********************
 * Layout Toggle (grid/list)
 ***********************/
function initLayoutSwitch() {
  const toggle = $("#layoutToggle");
  const saved = localStorage.getItem("layout") || "grid";

  document.body.classList.toggle("list-layout", saved === "list");
  if (toggle) toggle.checked = (saved === "list");

  toggle?.addEventListener("change", () => {
    const isList = toggle.checked;
    document.body.classList.toggle("list-layout", isList);
    localStorage.setItem("layout", isList ? "list" : "grid");
  });
}

/***********************
 * Apple Photos Page (index.html)
 ***********************/
let ALL_PHOTOS = [];
let LOAD_ERROR = "";
let CURRENT_VIEW = "library"; // library | users
let FILTERS = { topic: "All", user: "All", userFocus: null };
let CURRENT_PHOTO = null;

async function initApplePhotosPage() {
  initThemeSwitch();
  initLayoutSwitch();

  // sidebar nav
  $("#navLibrary")?.addEventListener("click", () => setViewMode("library"));
  $("#navUsers")?.addEventListener("click", () => setViewMode("users"));

  // overlay close buttons
  $("#closeOverlayBtn")?.addEventListener("click", closePhotoMenu);
  $("#overlayCloseBtn2")?.addEventListener("click", closePhotoMenu);
  $("#photoMenuOverlay")?.addEventListener("click", (e) => {
    if (e.target?.id === "photoMenuOverlay") closePhotoMenu();
  });
  $("#overlayDeleteBtn")?.addEventListener("click", deleteCurrentPhoto);

  // filters apply
  $("#applyFiltersBtn")?.addEventListener("click", applyFilters);

  await refreshPhotos();           // loads photos into ALL_PHOTOS
  renderFilterDropdowns();         // topic + user dropdowns
  renderUserSidebar();             // users list
  renderGallery();                 // cards
  setViewMode("library");
}

async function refreshPhotos() {
  LOAD_ERROR = "";
  try {
    const data = await apiGet("/photos");
    ALL_PHOTOS = data.photos || [];
  } catch (err) {
    console.error("Failed to load photos", err);
    ALL_PHOTOS = [];
    LOAD_ERROR = `Unable to load photos: ${err.message}. Please refresh to retry.`;
  }
}

function uniqueTopics() {
  return [...new Set(ALL_PHOTOS.map(p => p.topic).filter(Boolean))].sort();
}
function uniqueUsers() {
  return [...new Set(ALL_PHOTOS.map(p => p.user_name).filter(Boolean))].sort();
}

function renderFilterDropdowns() {
  const topicSel = $("#topicFilter");
  const userSel = $("#userFilter");

  if (topicSel) {
    const topics = ["All", ...uniqueTopics()];
    if (!topics.includes(FILTERS.topic)) FILTERS.topic = "All";
    topicSel.innerHTML = topics
      .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("");
    topicSel.value = FILTERS.topic || "All";
  }

  if (userSel) {
    const users = ["All", ...uniqueUsers()];
    if (!users.includes(FILTERS.user)) FILTERS.user = "All";
    if (FILTERS.userFocus && !users.includes(FILTERS.userFocus)) FILTERS.userFocus = null;
    userSel.innerHTML = users
      .map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`)
      .join("");
    userSel.value = FILTERS.user || "All";
  }
}

function setViewMode(mode) {
  CURRENT_VIEW = mode;

  $("#navLibrary")?.classList.toggle("active", mode === "library");
  $("#navUsers")?.classList.toggle("active", mode === "users");

  const userFilterRow = $("#userFilterRow");
  const filterTitle = $("#filterTitle");

  if (mode === "library") {
    FILTERS.userFocus = null;
    if (filterTitle) filterTitle.textContent = "Filter (Library)";
    if (userFilterRow) userFilterRow.style.display = "";
  } else {
    if (filterTitle) filterTitle.textContent = "Filter (Users)";
    if (userFilterRow) userFilterRow.style.display = (FILTERS.userFocus ? "none" : "");
  }

  renderUserSidebar();
  renderGallery();
}

function renderUserSidebar() {
  const ul = $("#userSidebarList");
  if (!ul) return;

  const users = uniqueUsers();
  ul.replaceChildren(...users.map(user => {
    const li = document.createElement("li");
    li.className = "sidebar-user-item";
    li.classList.toggle("active", CURRENT_VIEW === "users" && FILTERS.userFocus === user);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = user;
    button.addEventListener("click", () => window.focusUser(user));
    li.append(button);
    return li;
  }));
}

window.focusUser = function (user) {
  setViewMode("users");
  FILTERS.userFocus = user;

  const filterTitle = $("#filterTitle");
  if (filterTitle) filterTitle.textContent = `Filter (User: ${user})`;

  const userFilterRow = $("#userFilterRow");
  if (userFilterRow) userFilterRow.style.display = "none";

  renderUserSidebar();
  renderGallery();
};

function applyFilters() {
  const topicSel = $("#topicFilter");
  const userSel = $("#userFilter");
  FILTERS.topic = topicSel?.value || "All";
  FILTERS.user = userSel?.value || "All";

  // if user applied dropdown in users mode, clear focus
  if (CURRENT_VIEW === "users") FILTERS.userFocus = null;

  renderUserSidebar();
  renderGallery();
}

function filteredPhotos() {
  let photos = [...ALL_PHOTOS];

  const topic = FILTERS.topic;
  const user =
    (CURRENT_VIEW === "users" && FILTERS.userFocus)
      ? FILTERS.userFocus
      : FILTERS.user;

  if (topic && topic !== "All") photos = photos.filter(p => p.topic === topic);
  if (user && user !== "All") photos = photos.filter(p => p.user_name === user);

  return photos;
}

// ---------- CLEAN renderGallery (only once!) ----------
function renderGallery() {
  const gallery = $("#gallery");
  if (!gallery) return;
  if (LOAD_ERROR) {
    gallery.innerHTML = `<div class="empty-state" role="alert">${escapeHtml(LOAD_ERROR)}</div>`;
    return;
  }

  const photos = filteredPhotos();
  if (!photos.length) {
    gallery.innerHTML = `<div class="empty-state">No photos found.</div>`;
    return;
  }

  gallery.innerHTML = photos
    .map((p) => {
      const id = escapeHtml(p.photo_id);
      const user = escapeHtml(p.user_name || "");
      const topic = escapeHtml(p.topic || "");
      const time = escapeHtml(
        fmtDate(p.uploaded_at || p.upload_time || p.timestamp || "")
      );
      const thumb = escapeHtml(pickImageUrl(p));



      return `
        <article class="photo-card">
          <div class="photo-thumb-wrap">
            <!-- Clicking image opens overlay -->
            <img
              class="photo-thumb"
              src="${thumb}"
              alt="photo thumbnail"
              loading="lazy"
              onclick="openPhotoMenu('${id}')"
            />
            <!-- ⋯ button also opens overlay -->
            <button
              class="kebab-btn"
              type="button"
              title="Details"
              onclick="openPhotoMenu('${id}')"
            >⋯</button>
          </div>

          <div class="photo-meta">
            <div class="photo-meta-row"><strong>User:</strong> <span>${user}</span></div>
            <div class="photo-meta-row"><strong>Topic:</strong> <span>${topic}</span></div>
            <div class="photo-meta-row"><strong>Uploaded:</strong> <span>${time}</span></div>
          </div>
        </article>
      `;
    })
    .join("");
}
// -----------------------------------------------------

window.openPhotoMenu = function (photoId) {
  const p = ALL_PHOTOS.find(x => String(x.photo_id) === String(photoId));
  if (!p) return;

  CURRENT_PHOTO = p;

  $("#overlayThumb").src = pickImageUrl(p) || "";

  $("#overlayUser").textContent = p.user_name || "";
  $("#overlayTopic").textContent = p.topic || "";
  $("#overlayTime").textContent = fmtDate(p.uploaded_at || p.upload_time || p.timestamp || "");
  $("#overlayFullLink").href = `photos.html?photo_id=${encodeURIComponent(p.photo_id)}`;

  $("#photoMenuOverlay")?.classList.add("open");
};

function closePhotoMenu() {
  $("#photoMenuOverlay")?.classList.remove("open");
  CURRENT_PHOTO = null;
}
window.closePhotoMenu = closePhotoMenu;

async function deleteCurrentPhoto() {
  if (!CURRENT_PHOTO?.photo_id) return;
  const ok = confirm("Delete this photo?");
  if (!ok) return;

  try {
    await apiDelete(`/photos/${encodeURIComponent(CURRENT_PHOTO.photo_id)}`);
    closePhotoMenu();
    await refreshPhotos();
    renderFilterDropdowns();
    renderUserSidebar();
    renderGallery();
  } catch (e) {
    console.error(e);
    alert(`Delete failed: ${e.message}`);
  }
}

/***********************
 * Upload page logic
 ***********************/
async function initUploadPage() {
  initThemeSwitch();

  const msg = $("#uploadMsg");
  const fileInput = $("#photoFile");
  const preview = $("#previewImg");

  const userInput = $("#userName");
  const topicSelect = $("#topicSelect");
  const newTopicInput = $("#newTopic");
  const useNewTopicChk = $("#useNewTopic");
  const uploadBtn = $("#uploadBtn");

  function showMsg(text, ok = true) {
    if (!msg) return;
    msg.textContent = text;
    msg.style.display = "block";
    msg.style.color = ok ? "green" : "red";
  }

  function syncTopicUI() {
    const useNew = !!useNewTopicChk?.checked;
    if (topicSelect) topicSelect.disabled = useNew;
    if (newTopicInput) newTopicInput.disabled = !useNew;
  }
  useNewTopicChk?.addEventListener("change", syncTopicUI);

  if (fileInput && preview) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (!f) {
        preview.src = "";
        preview.style.display = "none";
        return;
      }
      preview.src = URL.createObjectURL(f);
      preview.style.display = "block";
    });
  }

  async function loadTopics() {
    try {
      const data = await apiGet("/photos");
      const photos = data.photos || [];
      const topics = [...new Set((photos || []).map(p => p.topic).filter(Boolean))].sort();

      if (topicSelect) {
        if (topics.length === 0) {
          topicSelect.innerHTML = `<option value="">(No topics yet)</option>`;
          if (useNewTopicChk) useNewTopicChk.checked = true;
        } else {
          topicSelect.innerHTML = topics
            .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
            .join("");
        }
      }
    } catch (e) {
      console.warn("loadTopics failed", e);
      if (topicSelect) topicSelect.innerHTML = `<option value="">(No topics yet)</option>`;
    }
    syncTopicUI();
  }

  await loadTopics();

  uploadBtn?.addEventListener("click", async () => {
    if (uploadBtn.disabled) return;
    try {
      const file = fileInput?.files?.[0];
      const user_name = (userInput?.value || "").trim();
      const useNew = !!useNewTopicChk?.checked;
      const topic = useNew ? (newTopicInput?.value || "").trim() : (topicSelect?.value || "").trim();

      if (!file) return showMsg("Please select an image file.", false);
      if (file.size > 5 * 1024 * 1024) return showMsg("Image must be at most 5 MiB.", false);
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        return showMsg("Choose a JPEG, PNG, or WebP image.", false);
      }
      if (!user_name) return showMsg("Please enter a user name.", false);
      if (!topic) return showMsg("Please select or enter a topic.", false);

      showMsg("Uploading…", true);
      uploadBtn.disabled = true;

      const base64 = await fileToBase64(file);

      const payload = {
        user_name,
        topic,
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        image_base64: base64
      };

      await apiPost("/upload", payload);

      showMsg("Upload successful ✅", true);
      setTimeout(() => window.location.href = "index.html", 500);
    } catch (e) {
      console.error(e);
      showMsg(`Upload failed: ${e.message}`, false);
    } finally {
      uploadBtn.disabled = false;
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => {
      const res = String(reader.result || "");
      const idx = res.indexOf("base64,");
      // Send raw base64 to the upload HTTP function.
      resolve(idx >= 0 ? res.slice(idx + 7) : res);
    };
    reader.readAsDataURL(file);
  });
}

/***********************
 * Standalone photo details
 ***********************/
async function initPhotoDetailsPage() {
  initThemeSwitch();
  initLayoutSwitch();
  const main = $("#photoDetails");
  const photoId = new URLSearchParams(window.location.search).get("photo_id");
  if (!photoId) {
    main.textContent = "Select a photo from the gallery to view its details.";
    return;
  }
  main.textContent = "Loading photo…";
  await refreshPhotos();
  if (LOAD_ERROR) {
    main.textContent = LOAD_ERROR;
    return;
  }
  const photo = ALL_PHOTOS.find(p => p.photo_id === photoId);
  if (!photo) {
    main.textContent = "Photo not found. It may have been deleted.";
    return;
  }
  main.innerHTML = `
    <div class="detail-image-wrap">
      <img class="detail-image" src="${escapeHtml(photo.full_url)}" alt="${escapeHtml(photo.topic)}" />
    </div>
    <section class="detail-meta-card">
      <h2>Photo details</h2>
      <div class="detail-meta-row"><strong>User:</strong> ${escapeHtml(photo.user_name)}</div>
      <div class="detail-meta-row"><strong>Topic:</strong> ${escapeHtml(photo.topic)}</div>
      <div class="detail-meta-row"><strong>Uploaded:</strong> ${escapeHtml(fmtDate(photo.upload_time))}</div>
      <div class="detail-meta-row"><strong>File:</strong> ${escapeHtml(photo.filename)}</div>
      <button type="button" id="deleteDetailPhoto" class="btn btn-primary">Delete</button>
      <p id="detailMsg" role="alert"></p>
    </section>`;
  $("#deleteDetailPhoto").addEventListener("click", async () => {
    if (!confirm("Delete this photo?")) return;
    const button = $("#deleteDetailPhoto");
    button.disabled = true;
    try {
      await apiDelete(`/photos/${encodeURIComponent(photo.photo_id)}`);
      window.location.href = "index.html";
    } catch (error) {
      $("#detailMsg").textContent = `Delete failed: ${error.message}`;
      button.disabled = false;
    }
  });
}

/***********************
 * Router
 ***********************/
document.addEventListener("DOMContentLoaded", async () => {
  if ($("#photoDetails")) {
    await initPhotoDetailsPage();
    return;
  }
  // Apple Photos page
  if ($("#gallery") && $("#navLibrary") && $("#themeToggle")) {
    await initApplePhotosPage();
    return;
  }

  // Upload page
  if ($("#uploadBtn") && $("#photoFile")) {
    await initUploadPage();
    return;
  }

  // fallback theme
  initThemeSwitch();
});
