let db;
let roomData = null;

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username");
const myKey = safeKey(username);
const storyDraftKey = `wws_story_draft_${roomCode}_${myKey}`;

const assignedWord = $("assignedWord");
const storyText = $("storyText");
const storyWordCount = $("storyWordCount");
const sendStoryBtn = $("sendStoryBtn");
const storyProgress = $("storyProgress");
const storyPlayersList = $("storyPlayersList");
const nextStoryBtn = $("nextStoryBtn");
const storyInfo = $("storyInfo");
const storyMessage = $("storyMessage");

if (!roomCode || !username) {
  window.location.href = "index.html";
}

if (window.__firebaseDB) {
  db = window.__firebaseDB;
  initStoryWrite();
} else {
  window.addEventListener("firebase-ready", () => {
    db = window.__firebaseDB;
    initStoryWrite();
  });
}

storyText.addEventListener("input", () => {
  localStorage.setItem(storyDraftKey, storyText.value);
  updateWordCount();
});
sendStoryBtn.addEventListener("click", sendStory);
nextStoryBtn.addEventListener("click", goNextRound);
lockMobileFocusScroll(storyText);

async function fbMod() {
  return await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
}

async function initStoryWrite() {
  const { ref, get, onValue } = await fbMod();

  const roomRef = ref(db, `rooms/${roomCode}`);
  const roomSnap = await get(roomRef);

  if (!roomSnap.exists()) {
    window.location.href = "index.html";
    return;
  }

  roomData = roomSnap.val();

  await createAssignmentsIfNeeded(roomData);
  await createBotStoriesIfNeeded(roomData);

  onValue(roomRef, async (snapshot) => {
    if (!snapshot.exists()) {
      window.location.href = "index.html";
      return;
    }

    roomData = snapshot.val();

    if (roomData.status === "story-continue") {
      window.location.href = `story-continue.html?code=${encodeURIComponent(roomCode)}`;
      return;
    }

    await createBotStoriesIfNeeded(roomData);
    renderStoryWrite(roomData);
  });
}

async function createAssignmentsIfNeeded(room) {
  if (room.storyAssignments) return;

  const players = room.players || {};
  const firstWords = room.firstWords || {};

  const playerKeys = Object.keys(players).sort();
  const wordKeys = Object.keys(firstWords).sort();

  if (playerKeys.length < 2 || wordKeys.length < 2) return;

  const updates = {};
  const wordPairings = createPairings(
    playerKeys,
    wordKeys,
    {},
    `story-words:${roomCode}:${room.createdAt || ""}`
  );

  playerKeys.forEach((playerKey, index) => {
    const wordOwnerKey = wordPairings[playerKey] || wordKeys[index % wordKeys.length];

    const wordData = firstWords[wordOwnerKey];

    updates[`rooms/${roomCode}/storyAssignments/${playerKey}`] = {
      word: wordData.word,
      from: wordData.by || "",
      fromKey: wordOwnerKey,
      assignedAt: Date.now() + index,
    };
  });

  const { ref, update } = await fbMod();
  await update(ref(db), updates);
}


async function createBotStoriesIfNeeded(room) {
  const players = room.players || {};
  const assignments = room.storyAssignments || {};
  const stories = room.stories || {};
  const updates = {};

  Object.entries(players).forEach(([playerKey, player], index) => {
    if (!player.isBot || stories[playerKey] || !assignments[playerKey]) return;

    const word = assignments[playerKey].word;

    updates[`rooms/${roomCode}/stories/${playerKey}`] = {
      author: player.name,
      text: createBotStory(word, player.name),
      assignedWord: word,
      createdAt: Date.now() + index,
      isBot: true,
    };
  });

  if (!Object.keys(updates).length) return;

  const { ref, update } = await fbMod();
  await update(ref(db), updates);
}

function renderStoryWrite(room) {
  const players = room.players || {};
  const assignments = room.storyAssignments || {};
  const stories = room.stories || {};
  const playerEntries = Object.entries(players);
  const submittedCount = Object.keys(stories).length;
  const totalCount = playerEntries.length;
  const isHost = room.createdBy === username;
  const myAssignment = assignments[myKey];
  const myStory = stories[myKey];

  assignedWord.textContent = myAssignment ? myAssignment.word : "---";
  storyProgress.textContent = `${submittedCount} / ${totalCount}`;
  storyPlayersList.innerHTML = "";

  playerEntries
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
    .forEach(([playerKey, player]) => {
      const hasStory = Boolean(stories[playerKey]);

      const item = document.createElement("div");
      item.className = "player-item";
      item.innerHTML = `
        <div class="player-avatar">${getInitial(player.name)}</div>
        <div class="player-info">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${hasStory ? "Öyküsünü gönderdi" : "Öykü yazıyor"}</span>
        </div>
        <div class="word-status ${hasStory ? "done" : ""}">
          ${hasStory ? "✓" : "…"}
        </div>
      `;

      storyPlayersList.appendChild(item);
    });

  if (myStory) {
    storyText.value = myStory.text || "";
    storyText.disabled = true;
    sendStoryBtn.disabled = true;
    sendStoryBtn.textContent = "Gönderildi";
    updateWordCount();
  } else {
    const savedDraft = localStorage.getItem(storyDraftKey);

    if (!storyText.value && savedDraft) {
      storyText.value = savedDraft;
      updateWordCount();
    }

    storyText.disabled = false;
    sendStoryBtn.disabled = false;
    sendStoryBtn.textContent = "Öyküyü Gönder";
  }

  if (isHost && submittedCount === totalCount && totalCount > 0) {
    nextStoryBtn.classList.remove("hidden");
    storyInfo.textContent = "Herkes öyküsünü gönderdi. Devam turuna geçebilirsin.";
  } else if (isHost) {
    nextStoryBtn.classList.add("hidden");
    storyInfo.textContent = "Herkesin öyküsünü göndermesi bekleniyor.";
  } else {
    nextStoryBtn.classList.add("hidden");
    storyInfo.textContent = "Oyun kurucusu sonraki tura geçince devam edeceksin.";
  }
}

async function sendStory() {
  const text = storyText.value.trim();
  const words = countWords(text);
  const assignment = roomData.storyAssignments?.[myKey];

  if (!assignment) {
    showMessage("Sana henüz kelime atanmadı.");
    return;
  }

  if (!text) {
    showMessage("Öykünü yazmalısın.");
    storyText.focus();
    return;
  }

  if (words > 100) {
    showMessage("Öykü en fazla 100 kelime olabilir.");
    return;
  }

  if (!containsAssignedWord(text, assignment.word)) {
   showMessage(`Öykünün içinde "${assignment.word}" kelimesi geçmeli.`);
   return;
}


  try {
    const { ref, set } = await fbMod();

    await set(ref(db, `rooms/${roomCode}/stories/${myKey}`), {
      author: username,
      text,
      assignedWord: assignment.word,
      createdAt: Date.now(),
    });

    localStorage.removeItem(storyDraftKey);
    showMessage("");
  } catch (error) {
    console.error(error);
    showMessage("Öykü gönderilirken bir sorun çıktı.");
  }
}

async function goNextRound() {
  try {
    const { ref, update } = await fbMod();
    const playerCount = Object.keys(roomData.players || {}).length;

    await update(ref(db, `rooms/${roomCode}`), {
      status: "story-continue",
      currentContinueRound: 1,
      totalContinueRounds: Math.max(playerCount - 1, 1),
      continueStartedAt: Date.now(),
    });
  } catch (error) {
    console.error(error);
    showMessage("Sonraki tura geçerken bir sorun çıktı.");
  }
}


function updateWordCount() {
  const count = countWords(storyText.value);
  storyWordCount.textContent = `${count} / 100 kelime`;
  storyWordCount.classList.toggle("danger", count > 100);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function containsAssignedWord(text, assignedWord) {
  const cleanAssigned = normalizeTurkish(assignedWord);

  const words = normalizeTurkish(text)
    .split(/[^a-zçğıöşü]+/i)
    .filter(Boolean);

  return words.some((word) => word.startsWith(cleanAssigned));
}

function normalizeTurkish(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

function createPairings(sourceKeys, targetKeys, previousAssignments, seed) {
  if (!sourceKeys.length || !targetKeys.length) return {};

  let bestTargets = targetKeys.slice();
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 80; attempt++) {
    const shuffledTargets = seededShuffle(targetKeys, `${seed}:${attempt}`);
    const score = sourceKeys.reduce((total, sourceKey, index) => {
      const targetKey = shuffledTargets[index % shuffledTargets.length];
      const repeatsPreviousStory = previousAssignments?.[sourceKey]?.storyKey === targetKey;
      const repeatsPreviousWord = previousAssignments?.[sourceKey]?.fromKey === targetKey;

      return total
        + (targetKey === sourceKey ? 100 : 0)
        + (repeatsPreviousStory || repeatsPreviousWord ? 10 : 0);
    }, 0);

    if (score < bestScore) {
      bestScore = score;
      bestTargets = shuffledTargets;
    }

    if (score === 0) break;
  }

  return sourceKeys.reduce((pairings, sourceKey, index) => {
    pairings[sourceKey] = bestTargets[index % bestTargets.length];
    return pairings;
  }, {});
}

function seededShuffle(values, seed) {
  const shuffled = values.slice();
  const random = mulberry32(hashString(seed));

  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function hashString(value) {
  let hash = 2166136261;

  for (let index = 0; index < String(value).length; index++) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}


function createBotStory(word, botName) {
  return `${botName}, ${word} kelimesini duyunca kısa bir an durdu. Sonra herkesin sustuğu o masada, bu kelimenin aslında bütün hikayeyi değiştireceğini fark etti.`;
}

function safeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$/[\]]/g, "_");
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

function showMessage(text) {
  storyMessage.textContent = text;
}


function lockMobileFocusScroll(element) {
  if (!element) return;

  element.addEventListener("touchstart", () => {
    element.dataset.scrollY = String(window.scrollY || 0);
  }, { passive: true });

  element.addEventListener("focus", () => {
    if (window.innerWidth > 760) return;

    const savedY = Number(element.dataset.scrollY || window.scrollY || 0);

    requestAnimationFrame(() => {
      window.scrollTo({ top: savedY, left: 0, behavior: "auto" });
    });

    setTimeout(() => {
      window.scrollTo({ top: savedY, left: 0, behavior: "auto" });
    }, 80);

    setTimeout(() => {
      window.scrollTo({ top: savedY, left: 0, behavior: "auto" });
    }, 180);
  });
}
