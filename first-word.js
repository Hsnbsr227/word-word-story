/* ============================================================
   WORD WORD STORY — first-word.js
   İlk tur: herkes sadece bir kelime bırakır
   ============================================================ */

let db;
let roomData = null;
let firstWordTimerId = null;
let firstWordAutoAdvanceStarted = false;

const $ = (id) => document.getElementById(id);
const DEFAULT_WORD_SECONDS = 30;
const AUTO_WORDS = [
  "zaman",
  "ışık",
  "kapı",
  "rüya",
  "orman",
  "anahtar",
  "yol",
  "ses",
];

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
const firstWordTimerRing = $("firstWordTimerRing");
const firstWordTimerText = $("firstWordTimerText");
const firstWordTimerTitle = $("firstWordTimerTitle");
const firstWordTimerNote = $("firstWordTimerNote");

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

    if (roomData.status === "story-continue") {
      window.location.href = `story-continue.html?code=${encodeURIComponent(roomCode)}`;
      return;
    }

    if (roomData.status === "finished") {
      window.location.href = `results.html?code=${encodeURIComponent(roomCode)}`;
      return;
    }



    renderFirstWord(roomData);
    startFirstWordTimer();
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

  updateFirstWordTimer();
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



function startFirstWordTimer() {
  if (firstWordTimerId) return;

  updateFirstWordTimer();
  firstWordTimerId = setInterval(updateFirstWordTimer, 250);
}

function updateFirstWordTimer() {
  if (!roomData || roomData.status !== "first-word") return;

  const startedAt = getFirstWordStartedAt(roomData);
  const elapsed = Math.max(0, Date.now() - startedAt);
  const durationMs = getWordRoundDurationMs(roomData);
  const remainingMs = Math.max(0, durationMs - elapsed);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(1, remainingMs / durationMs));

  renderTimer({
    ring: firstWordTimerRing,
    text: firstWordTimerText,
    title: firstWordTimerTitle,
    note: firstWordTimerNote,
    remainingSeconds,
    progress,
    expired: remainingMs <= 0,
    waitingText: "Süre bitince eksik kelimeler otomatik tamamlanır.",
  });

  if (remainingMs <= 0) {
    autoCompleteFirstWordRound();
  }
}

function getFirstWordStartedAt(room) {
  return room.firstWordStartedAt || room.startedAt || room.createdAt || Date.now();
}

function getWordRoundDurationMs(room) {
  return Number(room.settings?.wordSeconds || DEFAULT_WORD_SECONDS) * 1000;
}

async function autoCompleteFirstWordRound() {
  if (firstWordAutoAdvanceStarted || !roomData || roomData.status !== "first-word") return;

  firstWordAutoAdvanceStarted = true;

  try {
    const { ref, get, set, update } = await fbMod();

    if (!roomData.firstWords?.[safeKey(username)] && isValidWord(firstWordInput.value)) {
      const typedWord = firstWordInput.value.trim().toLocaleLowerCase("tr-TR");

      await set(ref(db, `rooms/${roomCode}/firstWords/${safeKey(username)}`), {
        word: typedWord,
        by: username,
        createdAt: Date.now(),
      });
    }

    const roomRef = ref(db, `rooms/${roomCode}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) return;

    const room = roomSnap.val();
    if (room.status !== "first-word") return;

    const players = room.players || {};
    const firstWords = room.firstWords || {};
    const updates = {
      [`rooms/${roomCode}/status`]: "story-writing",
      [`rooms/${roomCode}/storyStartedAt`]: Date.now(),
    };

    Object.entries(players).forEach(([playerKey, player], index) => {
      if (firstWords[playerKey]) return;

      const typedWord =
        playerKey === safeKey(username) && isValidWord(firstWordInput.value)
          ? firstWordInput.value.trim().toLocaleLowerCase("tr-TR")
          : "";

      updates[`rooms/${roomCode}/firstWords/${playerKey}`] = {
        word: typedWord || AUTO_WORDS[index % AUTO_WORDS.length],
        by: player.name || "Oyuncu",
        createdAt: Date.now() + index,
        isAuto: !typedWord,
      };
    });

    await update(ref(db), updates);
  } catch (error) {
    console.error(error);
    firstWordAutoAdvanceStarted = false;
    showMessage("Süre doldu ama tur otomatik geçerken bir sorun çıktı.");
  }
}

function renderTimer({ ring, text, title, note, remainingSeconds, progress, expired, waitingText }) {
  if (!ring || !text || !title || !note) return;

  ring.style.setProperty("--timer-progress", `${progress * 100}%`);
  ring.closest(".round-timer")?.classList.toggle("is-low", remainingSeconds <= 7);
  text.textContent = String(remainingSeconds).padStart(2, "0");
  title.textContent = expired ? "Süre doldu" : `${remainingSeconds} saniye`;
  note.textContent = expired ? "Tur otomatik hazırlanıyor..." : waitingText;
}

function isValidWord(value) {
  const word = String(value || "").trim();
  return Boolean(word) && !word.includes(" ") && /^[a-zA-ZğüşöçıİĞÜŞÖÇ]+$/.test(word);
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
