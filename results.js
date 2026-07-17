let db;
let currentRoom = null;

const $ = (id) => document.getElementById(id);
const VOTE_CATEGORIES = [
  { key: "funny", label: "En Komik" },
  { key: "twist", label: "En Beklenmedik" },
  { key: "flow", label: "En İyi Devam" },
];

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username") || "Anonim";
const myKey = safeKey(username);

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

  currentRoom = roomSnap.val();
  renderResults(currentRoom);
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
        <div class="vote-panel"></div>
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

      renderVotePanel(card.querySelector(".vote-panel"), room, storyKey);
      resultsList.appendChild(card);
    });
}

function renderVotePanel(container, room, storyKey) {
  const votes = room.votes || {};

  container.innerHTML = VOTE_CATEGORIES.map((category) => {
    const categoryVotes = votes[category.key] || {};
    const myVote = categoryVotes[myKey];
    const count = Object.values(categoryVotes).filter((voteStoryKey) => voteStoryKey === storyKey).length;
    const isSelected = myVote === storyKey;

    return `
      <button
        class="vote-btn ${isSelected ? "selected" : ""}"
        type="button"
        data-category="${escapeHtml(category.key)}"
        data-story="${escapeHtml(storyKey)}"
      >
        <span>${escapeHtml(category.label)}</span>
        <strong>${count}</strong>
      </button>
    `;
  }).join("");

  container.querySelectorAll(".vote-btn").forEach((button) => {
    button.addEventListener("click", () => {
      voteForStory(button.dataset.category, button.dataset.story);
    });
  });
}

async function voteForStory(category, storyKey) {
  try {
    const { ref, get, set } = await fbMod();
    await set(ref(db, `rooms/${roomCode}/votes/${category}/${myKey}`), storyKey);

    const roomSnap = await get(ref(db, `rooms/${roomCode}`));
    if (roomSnap.exists()) {
      currentRoom = roomSnap.val();
      renderResults(currentRoom);
    }
  } catch (error) {
    console.error(error);
  }
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

function safeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$/[\]]/g, "_");
}
