let db;

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");

const resultsList = $("resultsList");
const homeBtn = $("homeBtn");

if (!roomCode) {
  window.location.href = "index.html";
}

if (window.__firebaseDB) {
  db = window.__firebaseDB;
  initResults();
} else {
  window.addEventListener("firebase-ready", () => {
    db = window.__firebaseDB;
    initResults();
  });
}

homeBtn.addEventListener("click", () => {
  window.location.href = "index.html";
});

async function fbMod() {
  return await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
}

async function initResults() {
  const { ref, get } = await fbMod();

  const roomSnap = await get(ref(db, `rooms/${roomCode}`));

  if (!roomSnap.exists()) {
    resultsList.innerHTML = `<div class="empty-wait">Bu oyun bulunamadı.</div>`;
    return;
  }

  renderResults(roomSnap.val());
}

function renderResults(room) {
  const stories = room.stories || {};
  const continuesByRound = room.continues || {};
  const storyEntries = Object.entries(stories);

  resultsList.innerHTML = "";

  if (!storyEntries.length) {
    resultsList.innerHTML = `<div class="empty-wait">Henüz gösterilecek hikaye yok.</div>`;
    return;
  }

  storyEntries
    .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
    .forEach(([storyKey, story]) => {
      const card = document.createElement("article");
      card.className = "result-card result-card-merged";

      const parts = collectStoryParts(storyKey, story, continuesByRound);

      card.innerHTML = `
        <div class="result-card-head">
          <span>Tamamlanan Hikaye</span>
          <strong>${escapeHtml(story.author || "Anonim")}'in Öyküsü</strong>
        </div>

        <div class="merged-story-flow"></div>
      `;

      const flow = card.querySelector(".merged-story-flow");

      parts.forEach((part) => {
        const block = document.createElement("div");
        block.className = "merged-story-part";

        block.innerHTML = `
          <span>${escapeHtml(part.author || "Anonim")}</span>
          <p>${escapeHtml(part.text || "")}</p>
        `;

        flow.appendChild(block);
      });

      resultsList.appendChild(card);
    });
}

function collectStoryParts(storyKey, story, continuesByRound) {
  const parts = [
    {
      author: story.author || "Anonim",
      text: story.text || "",
      createdAt: story.createdAt || 0,
    },
  ];

  Object.entries(continuesByRound)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([, continues]) => {
      Object.values(continues || {}).forEach((item) => {
        if (item.storyKey !== storyKey) return;

        parts.push({
          author: item.author || "Anonim",
          text: item.text || "",
          createdAt: item.createdAt || 0,
        });
      });
    });

  return parts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}