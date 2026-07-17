/* ============================================================
   WORD WORD STORY — room-wait.js
   Bekleme odası: kod + oyuncu listesi + oyunu başlat
   ============================================================ */

let db;
let roomData = null;

const $ = (id) => document.getElementById(id);
const DEFAULT_SETTINGS = {
  wordSeconds: 30,
  writingSeconds: 120,
  continueRounds: 0,
  maxWords: 100,
};

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username");

const roomCodeText = $("roomCodeText");
const copyCodeBtn = $("copyCodeBtn");
const copyLinkBtn = $("copyLinkBtn");
const backHomeBtn = $("backHomeBtn");
const playersList = $("playersList");
const playerCount = $("playerCount");
const startGameBtn = $("startGameBtn");
const addBotsBtn = $("addBotsBtn");
const readyBtn = $("readyBtn");
const roomSettingsForm = $("roomSettingsForm");
const wordSecondsSelect = $("wordSecondsSelect");
const writingSecondsSelect = $("writingSecondsSelect");
const continueRoundsSelect = $("continueRoundsSelect");
const maxWordsSelect = $("maxWordsSelect");
const waitInfo = $("waitInfo");
const waitMessage = $("waitMessage");

if (!roomCode || !username) {
  window.location.href = "index.html";
}

roomCodeText.textContent = roomCode;

if (window.__firebaseDB) {
  db = window.__firebaseDB;
  initWaitRoom();
} else {
  window.addEventListener("firebase-ready", () => {
    db = window.__firebaseDB;
    initWaitRoom();
  });
}


backHomeBtn.addEventListener("click", () => {
  window.location.href = "index.html";
});

copyCodeBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    showMessage("Kod kopyalandı.");
  } catch {
    showMessage("Kod kopyalanamadı. Elle seçip kopyalayabilirsin.");
  }
});

copyLinkBtn.addEventListener("click", async () => {
  const roomLink = `${window.location.origin}/room-wait.html?code=${encodeURIComponent(roomCode)}`;

  try {
    await navigator.clipboard.writeText(roomLink);
    showMessage("Oda linki kopyalandı.");
  } catch {
    showMessage("Link kopyalanamadı. Tarayıcı adresini elle kopyalayabilirsin.");
  }
});

startGameBtn.addEventListener("click", startGame);
addBotsBtn.addEventListener("click", addTestBots);
readyBtn.addEventListener("click", toggleReady);

[wordSecondsSelect, writingSecondsSelect, continueRoundsSelect, maxWordsSelect].forEach((select) => {
  select.addEventListener("change", saveSettings);
});


async function fbMod() {
  return await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
}

async function initWaitRoom() {
  const { ref, get, set, onValue, onDisconnect } = await fbMod();

  const roomRef = ref(db, `rooms/${roomCode}`);
  const roomSnap = await get(roomRef);

  if (!roomSnap.exists()) {
    showMessage("Bu oda bulunamadı.");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
    return;
  }

  const existingPlayer = roomSnap.val().players?.[safeKey(username)] || {};

  await set(ref(db, `rooms/${roomCode}/players/${safeKey(username)}`), {
    ...existingPlayer,
    name: username,
    joinedAt: existingPlayer.joinedAt || Date.now(),
    isHost: roomSnap.val().createdBy === username,
    isReady: existingPlayer.isReady || roomSnap.val().createdBy === username,
    color: existingPlayer.color || getPlayerColor(username),
    lastSeenAt: Date.now(),
  });

  // Sayfa geçişlerinde oyuncu silinmesin diye şimdilik kapalı.
// onDisconnect(ref(db, `rooms/${roomCode}/players/${safeKey(username)}`)).remove();


  onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      window.location.href = "index.html";
      return;
    }

    roomData = snapshot.val();

    if (roomData.status === "first-word") {
      window.location.href = `first-word.html?code=${encodeURIComponent(roomCode)}`;
      return;
    }

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

    renderRoom(roomData);
    renderSettings(getSettings(roomData), roomData.createdBy === username);
  });
}

function renderRoom(room) {
  const players = room.players ? Object.values(room.players) : [];
  const isHost = room.createdBy === username;

  playerCount.textContent = `${players.length} kişi`;
  playersList.innerHTML = "";

  if (!players.length) {
    playersList.innerHTML = `<div class="empty-wait">Henüz kimse yok.</div>`;
    return;
  }

  players
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
    .forEach((player) => {
      const item = document.createElement("div");
      item.className = "player-item";

      const isReady = player.isReady || player.isHost;

      item.innerHTML = `
        <div class="player-avatar" style="background:${escapeAttr(player.color || getPlayerColor(player.name))}">${getInitial(player.name)}</div>
        <div class="player-info">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.isHost ? "Oyun kurucusu" : isReady ? "Hazır" : "Hazırlanıyor"}</span>
        </div>
        <div class="ready-pill ${isReady ? "ready" : ""}">
          ${isReady ? "Hazır" : "Bekliyor"}
        </div>
      `;

      playersList.appendChild(item);
    });

  if (isHost) {
  addBotsBtn.classList.remove("hidden");
  startGameBtn.classList.remove("hidden");
  waitInfo.textContent = "Herkes geldiyse oyunu başlatabilirsin.";
} else {
  addBotsBtn.classList.add("hidden");
  startGameBtn.classList.add("hidden");
  waitInfo.textContent = "Oyun kurucusu oyunu başlatınca buradan devam edeceksin.";
}

}

function renderSettings(settings, isHost) {
  const players = Object.values(roomData?.players || {});
  const readyCount = players.filter((player) => player.isReady || player.isHost).length;

  playerCount.textContent = `${readyCount} / ${players.length} hazır`;
  wordSecondsSelect.value = String(settings.wordSeconds);
  writingSecondsSelect.value = String(settings.writingSeconds);
  continueRoundsSelect.value = String(settings.continueRounds);
  maxWordsSelect.value = String(settings.maxWords);

  roomSettingsForm.classList.toggle("is-locked", !isHost);
  [wordSecondsSelect, writingSecondsSelect, continueRoundsSelect, maxWordsSelect].forEach((select) => {
    select.disabled = !isHost;
  });

  const myPlayer = roomData?.players?.[safeKey(username)] || {};
  const isReady = Boolean(myPlayer.isReady || myPlayer.isHost);
  readyBtn.textContent = isReady ? "Hazırı Geri Al" : "Hazır Ver";
  readyBtn.classList.toggle("is-ready", isReady);
}

async function toggleReady() {
  if (!db || !roomData) return;

  const myKey = safeKey(username);
  const myPlayer = roomData.players?.[myKey] || {};

  if (myPlayer.isHost) {
    showMessage("Oyun kurucusu zaten hazır sayılır.");
    return;
  }
  try {
    const { ref, update } = await fbMod();
    await update(ref(db, `rooms/${roomCode}/players/${myKey}`), {
      isReady: !myPlayer.isReady,
      lastSeenAt: Date.now(),
    });
  } catch (error) {
    console.error(error);
    showMessage("Hazır durumu güncellenemedi.");
  }
}

async function saveSettings() {
  if (!db || !roomData || roomData.createdBy !== username) return;

  try {
    const { ref, update } = await fbMod();

    await update(ref(db, `rooms/${roomCode}/settings`), {
      wordSeconds: Number(wordSecondsSelect.value),
      writingSeconds: Number(writingSecondsSelect.value),
      continueRounds: Number(continueRoundsSelect.value),
      maxWords: Number(maxWordsSelect.value),
    });
  } catch (error) {
    console.error(error);
    showMessage("Oda ayarları kaydedilemedi.");
  }
}

async function addTestBots() {
  if (!db) {
    showMessage("Veritabanı bağlantısı hazır değil.");
    return;
  }

  const bots = [
    "Deniz Anlatıcı",
    "Mavi Tuhaf",
    "Defne Dedektif",
    "Atlas Şair",
  ];

  try {
    addBotsBtn.disabled = true;
    addBotsBtn.textContent = "Botlar ekleniyor...";

    const { ref, update } = await fbMod();
    const botPlayers = {};

    bots.forEach((botName, index) => {
      botPlayers[`bot_${index + 1}`] = {
        name: botName,
        joinedAt: Date.now() + index,
        isHost: false,
        isBot: true,
        isReady: true,
        color: getPlayerColor(botName),
      };
    });

    await update(ref(db, `rooms/${roomCode}/players`), botPlayers);

    showMessage("4 bot bekleme odasına eklendi.");
  } catch (error) {
    console.error(error);
    showMessage("Botlar eklenirken bir sorun çıktı.");
  } finally {
    addBotsBtn.disabled = false;
    addBotsBtn.textContent = "4 Bot Ekle";
  }
}



async function startGame() {
  if (!roomData) return;

  const players = roomData.players ? Object.values(roomData.players) : [];
  const readyPlayers = players.filter((player) => player.isReady || player.isHost);

  if (readyPlayers.length < players.length) {
    showMessage("Oyunu başlatmadan önce herkes hazır olmalı.");
    return;
  }

  if (players.length < 2) {
    showMessage("Oyunu başlatmak için en az 2 oyuncu gerekli.");
    return;
  }

  try {
    const { ref, update } = await fbMod();

    const startedAt = Date.now();

    await update(ref(db, `rooms/${roomCode}`), {
      status: "first-word",
      startedAt,
      firstWordStartedAt: startedAt,
      settings: getSettings(roomData),
    });
  } catch (error) {
    console.error(error);
    showMessage("Oyun başlatılırken bir sorun çıktı.");
  }
}

function getSettings(room) {
  return {
    ...DEFAULT_SETTINGS,
    ...(room.settings || {}),
  };
}

function getPlayerColor(value) {
  const colors = [
    "#315c4b",
    "#8f3f35",
    "#4a5f9f",
    "#9a6a2f",
    "#6d4b8f",
    "#2f7287",
    "#7a5635",
    "#4f6f3b",
  ];
  let hash = 0;

  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return colors[hash % colors.length];
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

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function showMessage(text) {
  waitMessage.textContent = text;
}
