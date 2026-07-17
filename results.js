let db;
let currentRoom = null;

const $ = (id) => document.getElementById(id);
const STORY_VOTES = [
  { key: "like", label: "Beğendim", score: 1 },
  { key: "ww", label: "WW", score: 2 },
  { key: "dislike", label: "Beğenmedim", score: -1 },
];

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username") || "Anonim";
const myKey = safeKey(username);

const resultsList = $("resultsList");
const leaderboardSection = $("leaderboardSection");
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
  const { ref, onValue } = await fbMod();

  onValue(ref(db, `rooms/${roomCode}`), (roomSnap) => {
    if (!roomSnap.exists()) {
      resultsList.innerHTML = `<div class="empty-wait">Bu oyun bulunamadı.</div>`;
      return;
    }

    currentRoom = roomSnap.val();
    renderResults(currentRoom);
  });
}

function renderResults(room) {
  const stories = room.stories || {};
  const continuesByRound = room.continues || {};
  const readStories = room.readStories || {};
  const storyEntries = Object.entries(stories);
  const visibleEntries = storyEntries.filter(([storyKey]) => !readStories[storyKey]);

  resultsList.innerHTML = "";
  leaderboardSection.classList.add("hidden");
  leaderboardSection.innerHTML = "";

  if (!storyEntries.length) {
    resultsList.innerHTML = `<div class="empty-wait">Henüz gösterilecek hikaye yok.</div>`;
    return;
  }

  if (!visibleEntries.length) {
    resultsList.innerHTML = `<div class="empty-wait">Tüm hikayeler okundu. Oylama tamamlandı.</div>`;
    renderLeaderboard(room);
    return;
  }

  visibleEntries
    .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
    .forEach(([storyKey, story]) => {
      const card = document.createElement("article");
      card.className = "result-card result-card-merged";
      const parts = collectStoryParts(storyKey, story, continuesByRound);

      card.innerHTML = `
        <div class="result-card-head">
          <span>Tamamlanan Hikaye</span>
          <strong>${escapeHtml(story.author || "Anonim")} Öyküsü</strong>
        </div>

        <div class="merged-story-flow"></div>
        <div class="story-reaction-panel"></div>
      `;

      const flow = card.querySelector(".merged-story-flow");

      parts.forEach((part) => {
        const block = document.createElement("div");
        block.className = "merged-story-part";
        block.innerHTML = `
          <span>Anlatıcı ${escapeHtml(part.author || "Anonim")}</span>
          <p>${highlightRequiredWord(part.text || "", part.requiredWord || "")}</p>
        `;
        flow.appendChild(block);
      });

      renderStoryVoting(card.querySelector(".story-reaction-panel"), room, storyKey);
      resultsList.appendChild(card);
    });
}

function renderStoryVoting(container, room, storyKey) {
  const isOwner = storyKey === myKey;
  const isHost = room.createdBy === username;
  const players = room.players || {};
  const playerKeys = Object.keys(players);
  const eligibleVoters = playerKeys.length
    ? playerKeys.filter((playerKey) => playerKey !== storyKey)
    : [myKey].filter((playerKey) => playerKey !== storyKey);
  const storyVotes = room.storyVotes?.[storyKey] || {};
  const votedCount = eligibleVoters.filter((playerKey) => storyVotes[playerKey]).length;
  const allVoted = eligibleVoters.length > 0 && votedCount >= eligibleVoters.length;
  const myVote = storyVotes[myKey] || "";

  const voteButtons = STORY_VOTES.map((vote) => `
    <button
      class="story-vote-btn ${myVote === vote.key ? "selected" : ""}"
      type="button"
      data-vote="${escapeHtml(vote.key)}"
      ${isOwner ? "disabled" : ""}
    >
      ${escapeHtml(vote.label)}
    </button>
  `).join("");

  container.innerHTML = `
    <div class="story-vote-actions">
      ${voteButtons}
    </div>
    <div class="story-vote-status">
      ${isOwner ? "Kendi öyküne oy veremezsin." : `${votedCount} / ${eligibleVoters.length} oy kullanıldı.`}
    </div>
    ${
      isHost && allVoted
        ? `<button class="mark-read-btn" type="button">Okundu</button>`
        : ""
    }
  `;

  container.querySelectorAll(".story-vote-btn").forEach((button) => {
    button.addEventListener("click", () => {
      voteForStory(storyKey, button.dataset.vote);
    });
  });

  container.querySelector(".mark-read-btn")?.addEventListener("click", () => {
    markStoryRead(storyKey);
  });
}

async function voteForStory(storyKey, vote) {
  if (storyKey === myKey) return;

  try {
    const { ref, set } = await fbMod();
    await set(ref(db, `rooms/${roomCode}/storyVotes/${storyKey}/${myKey}`), vote);
  } catch (error) {
    console.error(error);
  }
}

async function markStoryRead(storyKey) {
  if (!currentRoom || currentRoom.createdBy !== username) return;

  try {
    const { ref, update } = await fbMod();
    const storyKeys = Object.keys(currentRoom.stories || {});
    const readStories = {
      ...(currentRoom.readStories || {}),
      [storyKey]: true,
    };
    const allRead = storyKeys.length > 0 && storyKeys.every((key) => readStories[key]);

    await update(ref(db, `rooms/${roomCode}`), {
      [`readStories/${storyKey}`]: true,
      resultsReviewedAt: allRead ? Date.now() : currentRoom.resultsReviewedAt || null,
      resultsStatus: allRead ? "complete" : "reviewing",
    });
  } catch (error) {
    console.error(error);
  }
}

function renderLeaderboard(room) {
  const players = room.players || {};
  const stories = room.stories || {};
  const leaderboard = Object.entries(stories)
    .map(([storyKey, story]) => {
      const votes = room.storyVotes?.[storyKey] || {};
      const score = Object.values(votes).reduce((total, vote) => {
        return total + (STORY_VOTES.find((item) => item.key === vote)?.score || 0);
      }, 0);

      return {
        storyKey,
        name: story.author || players[storyKey]?.name || "Anonim",
        color: players[storyKey]?.color || getPlayerColor(story.author || storyKey),
        score,
        votes,
      };
    })
    .sort((a, b) => b.score - a.score);

  leaderboardSection.classList.remove("hidden");
  leaderboardSection.innerHTML = `
    <div class="leaderboard-head">
      <p class="wait-kicker">Final Tablosu</p>
      <h2>Liderlik tablosu</h2>
    </div>
    <div class="leaderboard-list"></div>
    <div id="storyPreview" class="story-preview hidden"></div>
  `;

  const list = leaderboardSection.querySelector(".leaderboard-list");

  leaderboard.forEach((entry, index) => {
    const item = document.createElement("button");
    item.className = "leaderboard-item";
    item.type = "button";
    item.innerHTML = `
      <span class="leader-rank">${index + 1}</span>
      <span class="player-avatar" style="background:${escapeAttr(entry.color)}">${getInitial(entry.name)}</span>
      <span class="leader-name">${escapeHtml(entry.name)}</span>
      <strong>${entry.score} puan</strong>
    `;
    item.addEventListener("click", () => showStoryPreview(room, entry.storyKey));
    list.appendChild(item);
  });
}

function showStoryPreview(room, storyKey) {
  const story = room.stories?.[storyKey];
  if (!story) return;

  const text = collectStoryParts(storyKey, story, room.continues || {})
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n\n");
  const preview = $("storyPreview");

  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="story-preview-head">
      <strong>${escapeHtml(story.author || "Anonim")} Öyküsü</strong>
      <button class="small-btn" type="button">Kopyala</button>
    </div>
    <p>${escapeHtml(text)}</p>
  `;

  preview.querySelector("button")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error(error);
    }
  });
}

function collectStoryParts(storyKey, story, continuesByRound) {
  const parts = [
    {
      author: story.author || "Anonim",
      text: story.text || "",
      requiredWord: story.assignedWord || "",
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
          requiredWord: item.requiredWord || "",
          createdAt: item.createdAt || 0,
        });
      });
    });

  return parts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function highlightRequiredWord(text, requiredWord) {
  const escapedText = escapeHtml(text);
  const word = String(requiredWord || "").trim();

  if (!word) return escapedText;

  const escapedWord = escapeRegExp(escapeHtml(word));
  return escapedText.replace(
    new RegExp(`(${escapedWord}[\\wığüşöçİĞÜŞÖÇ]*)`, "gi"),
    `<mark>$1</mark>`
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPlayerColor(value) {
  const colors = ["#315c4b", "#8f3f35", "#4a5f9f", "#9a6a2f", "#6d4b8f", "#2f7287"];
  let hash = 0;

  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return colors[hash % colors.length];
}

function getInitial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function safeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$/[\]]/g, "_");
}
