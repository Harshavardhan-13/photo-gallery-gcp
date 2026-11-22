/***********************
 * CONFIG (EDIT THIS)
 ***********************/
const API_BASE_URL = "https://REPLACE_ME.execute-api.us-east-1.amazonaws.com";
// Example you showed: https://8zs1soiykd.execute-api.us-east-1.amazonaws.com

/***********************
 * Helpers
 ***********************/
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return [...document.querySelectorAll(sel)]; }

function showMsg(el, msg, type = "ok") {
  if (!el) return;
  el.textContent = msg;
  el.className = `msg ${type}`;
  el.style.display = "block";
}

function hideMsg(el) {
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function apiGet(path) {
  const r = await fetch(`${API_BASE_URL}${path}`, { method: "GET" });
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${r.status} ${text}`);
  }
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(`${API_BASE_URL}${path}`, { method: "DELETE" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`DELETE ${path} failed: ${r.status} ${text}`);
  }
  // some lambdas return json, some return empty
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return {};
}

/***********************
 * Theme (same behavior)
 ***********************/
function initTheme() {
  const body = document.body;
  const saved = localStorage.getItem("theme") || "light";
  body.classList.toggle("dark", saved === "dark");

  const lightBtn = $("#lightModeBtn");
  const darkBtn = $("#darkModeBtn");
  if (lightBtn) lightBtn.onclick = () => { body.classList.remove("dark"); localStorage.setItem("theme","light"); };
  if (darkBtn) darkBtn.onclick = () => { body.classList.add("dark"); localStorage.setItem("theme","dark"); };
}

/***********************
 * Page: Upload
 ***********************/
async function initUploadPage() {
  initTheme();

  const msg = $("#uploadMsg");
  const fileInput = $("#photoFile");
  const preview = $("#previewImg");

  const userInput = $("#userName");
  const topicSelect = $("#topicSelect");
  const newTopicInput = $("#newTopic");
  const useNewTopicChk = $("#useNewTopic");

  const uploadBtn = $("#uploadBtn");

  // preview image
  if (fileInput && preview) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (!f) { preview.src = ""; preview.style.display = "none"; return; }
      preview.src = URL.createObjectURL(f);
      preview.style.display = "block";
    });
  }

  // toggle “existing vs new topic”
  function syncTopicUI() {
    const useNew = !!useNewTopicChk?.checked;
    if (topicSelect) topicSelect.disabled = useNew;
    if (newTopicInput) newTopicInput.disabled = !useNew;
  }
  if (useNewTopicChk) useNewTopicChk.addEventListener("change", syncTopicUI);

  // load topics from existing photos
  async function loadTopics() {
    try {
      const photos = await apiGet("/photos");
      const topics = [...new Set((photos || []).map(p => p.topic).filter(Boolean))].sort();
      if (topicSelect) {
        topicSelect.innerHTML = topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
        if (topics.length === 0) {
          topicSelect.innerHTML = `<option value="">(No topics yet)</option>`;
        }
      }
    } catch (e) {
      // not fatal
      console.warn(e);
    }
    syncTopicUI();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  await loadTopics();

  // upload handler
  if (uploadBtn) {
    uploadBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      hideMsg(msg);

      const file = fileInput?.files?.[0];
      const user_name = (userInput?.value || "").trim();

      const useNew = !!useNewTopicChk?.checked;
      const topic = useNew ? (newTopicInput?.value || "").trim() : (topicSelect?.value || "").trim();

      if (!file) return showMsg(msg, "Please select an image file.", "err");
      if (!user_name) return showMsg(msg, "Please enter a user name.", "err");
      if (!topic) return showMsg(msg, "Please select or enter a topic.", "err");

      try {
        showMsg(msg, "Uploading…", "ok");

        const base64 = await fileToBase64(file); // base64 without data: prefix
        const payload = {
          user_name,
          topic,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          image_base64: base64
        };

        const resp = await apiPost("/upload", payload);

        showMsg(msg, "Upload successful ✅", "ok");

        // go to gallery after upload
        setTimeout(() => {
          window.location.href = "photos.html";
        }, 700);

      } catch (e) {
        console.error(e);
        showMsg(msg, `Upload failed: ${e.message}`, "err");
      }
    });
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => {
      // reader.result is data URL: "data:image/png;base64,AAA..."
      const res = String(reader.result || "");
      const idx = res.indexOf("base64,");
      resolve(idx >= 0 ? res.slice(idx + 7) : res);
    };
    reader.readAsDataURL(file);
  });
}

/***********************
 * Page: Photos (gallery)
 ***********************/
async function initPhotosPage() {
  initTheme();

  const msg = $("#photosMsg");
  const gallery = $("#gallery");
  const topicFilter = $("#topicFilter");
  const applyBtn = $("#applyFilterBtn");

  const modal = $("#photoModal");
  const modalImg = $("#modalImg");
  const modalUser = $("#modalUser");
  const modalTopic = $("#modalTopic");
  const modalTime = $("#modalTime");
  const modalClose = $("#modalClose");
  const modalDelete = $("#modalDelete");

  let currentPhotos = [];
  let selectedPhoto = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  function renderTopics(photos) {
    const topics = [...new Set((photos || []).map(p => p.topic).filter(Boolean))].sort();
    if (!topicFilter) return;
    topicFilter.innerHTML = `<option value="">All topics</option>` + topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }

  function renderGallery(photos) {
    if (!gallery) return;
    if (!photos || photos.length === 0) {
      gallery.innerHTML = `<div class="empty">No photos found.</div>`;
      return;
    }

    gallery.innerHTML = photos.map(p => `
      <div class="card">
        <div class="thumbWrap">
          <img class="thumb" src="${escapeHtml(p.thumb_url || p.full_url)}" alt="thumbnail" data-id="${escapeHtml(p.photo_id)}" />
        </div>
        <div class="meta">
          <div class="title">${escapeHtml(p.topic || "")}</div>
          <div class="sub">User: ${escapeHtml(p.user_name || "")}</div>
          <div class="sub">Uploaded: ${escapeHtml(fmtDate(p.uploaded_at || p.timestamp))}</div>
        </div>
      </div>
    `).join("");

    // click handler for thumb -> open modal
    $all(".thumb").forEach(img => {
      img.addEventListener("click", () => {
        const id = img.getAttribute("data-id");
        const found = currentPhotos.find(x => String(x.photo_id) === String(id));
        if (found) openModal(found);
      });
    });
  }

  function openModal(photo) {
    selectedPhoto = photo;
    if (modalImg) modalImg.src = photo.full_url || photo.thumb_url;
    if (modalUser) modalUser.textContent = photo.user_name || "";
    if (modalTopic) modalTopic.textContent = photo.topic || "";
    if (modalTime) modalTime.textContent = fmtDate(photo.uploaded_at || photo.timestamp);

    if (modal) modal.style.display = "block";
  }

  function closeModal() {
    selectedPhoto = null;
    if (modal) modal.style.display = "none";
  }

  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (modal) modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  if (modalDelete) {
    modalDelete.addEventListener("click", async () => {
      if (!selectedPhoto) return;
      const ok = confirm("Delete this photo? (Any user can delete, per project rules)");
      if (!ok) return;

      try {
        showMsg(msg, "Deleting…", "ok");
        await apiDelete(`/photos/${encodeURIComponent(selectedPhoto.photo_id)}`);
        closeModal();
        await loadAndRender(); // refresh
        showMsg(msg, "Deleted ✅", "ok");
      } catch (e) {
        console.error(e);
        showMsg(msg, `Delete failed: ${e.message}`, "err");
      }
    });
  }

  async function loadAndRender() {
    hideMsg(msg);
    const topic = topicFilter?.value || "";
    const qs = topic ? `?topic=${encodeURIComponent(topic)}` : "";
    currentPhotos = await apiGet(`/photos${qs}`);
    renderTopics(currentPhotos);
    renderGallery(currentPhotos);
  }

  if (applyBtn) applyBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await loadAndRender(); }
    catch (err) { showMsg(msg, `Load failed: ${err.message}`, "err"); }
  });

  try {
    await loadAndRender();
  } catch (e) {
    console.error(e);
    showMsg(msg, `Load failed: ${e.message}`, "err");
  }
}

/***********************
 * Page: Index
 ***********************/
function initIndexPage() {
  initTheme();
}

/***********************
 * Router
 ***********************/
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.getAttribute("data-page");
  if (page === "upload") initUploadPage();
  else if (page === "photos") initPhotosPage();
  else initIndexPage();
});
