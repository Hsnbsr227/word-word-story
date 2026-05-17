/* ============================================================
   WORD WORD STORY — first-word.js
   İlk tur: herkes sadece bir kelime bırakır
   ============================================================ */

let db;
let roomData = null;

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username");

const backWaitBtn = $("backWaitBtn");
const firstWordInput = $("firstWordInput");
const sendWordBtn = $("sendWordBtn");
const wordHint = $("wordHint");
const wordPlayersList = $("wordPlayersList");
const wordProgress = $("wordProgress");
const nextRoundBtn = $("nextRoundBtn");
const wordInfo = $("wordInfo");
const wordMessage = $("wordMessage");

if (!roomCode || !username) {
  window.location.href = "index.html";
}

if (window.__firebaseDB) {
  db = window.__firebaseDB;
  initFirstWord();
} else {
  window.addEventListener("firebase-ready", () => {
    db = window.__firebaseDB;
    initFirstWord();
  });
}

backWaitBtn.addEventListener("click", () => {
  window.location.href = `room-wait.html?code=${encodeURIComponent(roomCode)}`;
});

sendWordBtn.addEventListener("click", sendFirstWord);

firstWordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendFirstWord();
  }
});

firstWordInput.addEventListener("input", () => {
  firstWordInput.value = firstWordInput.value.replace(/\s+/g, "");
});

nextRoundBtn.addEventListener("click", goStoryRound);

async function fbMod() {
  return await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
}

async function initFirstWord() {
  const { ref, get, onValue } = await fbMod();

  const roomRef = ref(db, `rooms/${roomCode}`);
  const roomSnap = await get(roomRef);

  if (!roomSnap.exists()) {
    showMessage("Bu oda bulunamadı.");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
    return;
  }

  roomData = roomSnap.val();

  if (roomData.status !== "first-word") {
    showMessage("Bu oda şu anda ilk kelime turunda değil.");
  }

  await createBotWordsIfNeeded(roomData);

  onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      window.location.href = "index.html";
      return;
    }

    roomData = snapshot.val();

    if (roomData.status === "story-writing") {
     window.location.href = `story-write.html?code=${encodeURIComponent(roomCode)}`;
     return;
    }



    renderFirstWord(roomData);
  });
}

function renderFirstWord(room) {
  const playersObj = room.players || {};
  const players = Object.entries(playersObj);
  const firstWords = room.firstWords || {};
  const submittedCount = Object.keys(firstWords).length;
  const totalCount = players.length;
  const isHost = room.createdBy === username;
  const myKey = safeKey(username);
  const myWord = firstWords[myKey];

  wordProgress.textContent = `${submittedCount} / ${totalCount}`;
  wordPlayersList.innerHTML = "";

  players
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
    .forEach(([playerKey, player]) => {
      const hasWord = Boolean(firstWords[playerKey]);

      const item = document.createElement("div");
      item.className = "player-item";

      item.innerHTML = `
        <div class="player-avatar">${getInitial(player.name)}</div>
        <div class="player-info">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${hasWord ? "Kelimesini gönderdi" : "Kelime bekleniyor"}</span>
        </div>
        <div class="word-status ${hasWord ? "done" : ""}">
          ${hasWord ? "✓" : "…"}
        </div>
      `;

      wordPlayersList.appendChild(item);
    });

  if (myWord) {
    firstWordInput.value = myWord.word || "";
    firstWordInput.disabled = true;
    sendWordBtn.disabled = true;
    sendWordBtn.textContent = "Gönderildi";
    wordHint.textContent = "Kelimen kaydedildi. Diğer oyuncular bekleniyor.";
  }

  if (isHost && submittedCount === totalCount && totalCount > 0) {
    nextRoundBtn.classList.remove("hidden");
    wordInfo.textContent = "Herkes kelimesini gönderdi. Sonraki tura geçebilirsin.";
  } else if (isHost) {
    nextRoundBtn.classList.add("hidden");
    wordInfo.textContent = "Herkes kelimesini gönderince sonraki tura geçebilirsin.";
  } else {
    nextRoundBtn.classList.add("hidden");
    wordInfo.textContent = "Oyun kurucusu sonraki tura geçince devam edeceksin.";
  }
}

async function sendFirstWord() {
  const word = firstWordInput.value.trim().toLowerCase();

  if (!word) {
    showMessage("Bir kelime yazmalısın.");
    firstWordInput.focus();
    return;
  }

  if (word.includes(" ")) {
    showMessage("Sadece tek kelime yazabilirsin.");
    return;
  }

  if (!/^[a-zA-ZğüşöçıİĞÜŞÖÇ]+$/.test(word)) {
    showMessage("Kelime sadece harflerden oluşmalı.");
    return;
  }

  try {
    const { ref, set } = await fbMod();

    await set(ref(db, `rooms/${roomCode}/firstWords/${safeKey(username)}`), {
      word,
      by: username,
      createdAt: Date.now(),
    });

    showMessage("");
  } catch (error) {
    console.error(error);
    showMessage("Kelime gönderilirken bir sorun çıktı.");
  }
}

async function createBotWordsIfNeeded(room) {
  const players = room.players || {};
  const firstWords = room.firstWords || {};
  const updates = {};
  const botWords = [
    "ayna",
    "fener",
    "orman",
    "bulut",
    "merdiven",
    "sandık",
    "pusula",
    "rüya",
  ];

  Object.entries(players).forEach(([playerKey, player], index) => {
    if (!player.isBot || firstWords[playerKey]) return;

    updates[`rooms/${roomCode}/firstWords/${playerKey}`] = {
      word: botWords[index % botWords.length],
      by: player.name,
      createdAt: Date.now() + index,
      isBot: true,
    };
  });

  if (!Object.keys(updates).length) return;

  const { ref, update } = await fbMod();
  await update(ref(db), updates);
}

async function goStoryRound() {
  if (!roomData) return;

  const players = roomData.players || {};
  const firstWords = roomData.firstWords || {};

  if (Object.keys(firstWords).length < Object.keys(players).length) {
    showMessage("Herkes kelime göndermeden geçemezsin.");
    return;
  }

  try {
    const { ref, update } = await fbMod();

    await update(ref(db, `rooms/${roomCode}`), {
      status: "story-writing",
      storyStartedAt: Date.now(),
    });
  } catch (error) {
    console.error(error);
    showMessage("Sonraki tura geçerken bir sorun çıktı.");
  }
}



function safeKey(value) {
  return String(value)
    .trim()
    .replace(/[.#$/[\]]/g, "_");
}

function getInitial(name) {
  return String(name || "?")
    .trim()
    .charAt(0)
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showMessage(text) {
  wordMessage.textContent = text;
}
