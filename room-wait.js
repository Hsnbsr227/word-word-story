/* ============================================================
   WORD WORD STORY — room-wait.js
   Bekleme odası: kod + oyuncu listesi + oyunu başlat
   ============================================================ */

let db;
let roomData = null;

const $ = (id) => document.getElementById(id);

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

  await set(ref(db, `rooms/${roomCode}/players/${safeKey(username)}`), {
    name: username,
    joinedAt: Date.now(),
    isHost: roomSnap.val().createdBy === username,
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

    renderRoom(roomData);
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

      item.innerHTML = `
        <div class="player-avatar">${getInitial(player.name)}</div>
        <div class="player-info">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.isHost ? "Oyun kurucusu" : "Oyuncu"}</span>
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

async function addTestBots() {
  if (!db) {
    showMessage("Veritabanı bağlantısı hazır değil.");
    return;
  }

  const bots = [
    "Bot Deniz",
    "Bot Mavi",
    "Bot Defne",
    "Bot Atlas",
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

  if (players.length < 2) {
    showMessage("Oyunu başlatmak için en az 2 oyuncu gerekli.");
    return;
  }

  try {
    const { ref, update } = await fbMod();

    await update(ref(db, `rooms/${roomCode}`), {
      status: "first-word",
      startedAt: Date.now(),
    });
  } catch (error) {
    console.error(error);
    showMessage("Oyun başlatılırken bir sorun çıktı.");
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
  waitMessage.textContent = text;
}
