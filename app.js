/* ============================================================
   WORD WORD STORY — app.js
   Ana sayfa: kullanıcı adı + oyun oluştur + koda göre katıl
   ============================================================ */

let db;

const DEFAULT_SETTINGS = {
  wordSeconds: 30,
  writingSeconds: 120,
  continueRounds: 0,
  maxWords: 100,
};

const state = {
  username: localStorage.getItem("wws_username") || "",
};

const $ = (id) => document.getElementById(id);

// Firebase hazır olunca veritabanını al
if (window.__firebaseDB) {
  db = window.__firebaseDB;
  cleanupOldRooms();
  console.log("Firebase zaten hazır");
} else {
  window.addEventListener("firebase-ready", () => {
    db = window.__firebaseDB;
    cleanupOldRooms();
    console.log("Firebase sonradan hazır oldu");
  });
}

// Sayfa elemanları
const usernameInput = $("username");
const createGameBtn = $("createGameBtn");
const joinGameBtn = $("joinGameBtn");
const joinPanel = $("joinPanel");
const roomCodeInput = $("roomCode");
const confirmJoinBtn = $("confirmJoinBtn");
const message = $("message");

// Kayıtlı kullanıcı adını geri getir
usernameInput.value = state.username;

usernameInput.addEventListener("input", () => {
  const username = usernameInput.value.trim();
  state.username = username;
  localStorage.setItem("wws_username", username);
});

// Oyun oluştur
createGameBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();

  if (!username) {
    showMessage("Önce kullanıcı adını yazmalısın.");
    usernameInput.focus();
    return;
  }

  if (!db) {
    showMessage("Veritabanı bağlantısı henüz hazır değil. Birkaç saniye sonra tekrar dene.");
    return;
  }

  localStorage.setItem("wws_username", username);

  try {
    const { ref, set } = await fbMod();

    const roomCode = createRoomCode();
    const roomRef = ref(db, `rooms/${roomCode}`);

    await set(roomRef, {
      code: roomCode,
      status: "waiting",
      createdBy: username,
      createdAt: Date.now(),
      settings: DEFAULT_SETTINGS,
      players: {
        [safeKey(username)]: {
          name: username,
          joinedAt: Date.now(),
          isHost: true,
          isReady: true,
          color: getPlayerColor(username),
        },
      },
      firstWords: {},
      stories: {},
    });

    localStorage.setItem("wws_room_code", roomCode);
    window.location.href = `room-wait.html?code=${encodeURIComponent(roomCode)}`;
  } catch (error) {
    console.error(error);
    showMessage("Oyun oluşturulurken bir sorun çıktı.");
  }
});

// Oyuna katıl panelini aç/kapat
joinGameBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();

  if (!username) {
    showMessage("Oyuna katılmadan önce kullanıcı adını yaz.");
    usernameInput.focus();
    return;
  }

  localStorage.setItem("wws_username", username);
  message.textContent = "";
  joinPanel.classList.toggle("hidden");

  if (!joinPanel.classList.contains("hidden")) {
    roomCodeInput.focus();
  }
});

// Koda göre oyuna katıl
confirmJoinBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  const roomCode = roomCodeInput.value.trim().toUpperCase();

  if (!username) {
    showMessage("Önce kullanıcı adını yazmalısın.");
    usernameInput.focus();
    return;
  }

  if (!roomCode) {
    showMessage("Oda kodunu yazmalısın.");
    roomCodeInput.focus();
    return;
  }

  if (!db) {
    showMessage("Veritabanı bağlantısı henüz hazır değil. Birkaç saniye sonra tekrar dene.");
    return;
  }

  try {
    const { ref, get, set } = await fbMod();
    const roomRef = ref(db, `rooms/${roomCode}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
      showMessage("Bu kodla bir oyun bulunamadı.");
      return;
    }

    await set(ref(db, `rooms/${roomCode}/players/${safeKey(username)}`), {
      name: username,
      joinedAt: Date.now(),
      isHost: false,
      isReady: false,
      color: getPlayerColor(username),
    });

    localStorage.setItem("wws_username", username);
    localStorage.setItem("wws_room_code", roomCode);

    window.location.href = `room-wait.html?code=${encodeURIComponent(roomCode)}`;
  } catch (error) {
    console.error(error);
    showMessage("Oyuna katılırken bir sorun çıktı.");
  }
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

async function fbMod() {
  return await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function safeKey(value) {
  return String(value)
    .trim()
    .replace(/[.#$/[\]]/g, "_");
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

function showMessage(text) {
  message.textContent = text;
}

async function cleanupOldRooms() {
  if (!db) return;

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const { ref, get, remove } = await fbMod();
    const roomsSnap = await get(ref(db, "rooms"));

    if (!roomsSnap.exists()) return;

    const deleteJobs = [];

    roomsSnap.forEach((roomSnap) => {
      const room = roomSnap.val();
      const roomKey = roomSnap.key;

      const baseTime =
        room.finishedAt ||
        room.continueStartedAt ||
        room.storyStartedAt ||
        room.startedAt ||
        room.createdAt ||
        0;

      if (!baseTime) return;

      const isOld = now - baseTime > ONE_DAY;

      if (isOld) {
        deleteJobs.push(remove(ref(db, `rooms/${roomKey}`)));
      }
    });

    await Promise.all(deleteJobs);

    if (deleteJobs.length) {
      console.log(`${deleteJobs.length} eski oda temizlendi.`);
    }
  } catch (error) {
    console.warn("Eski odalar temizlenemedi:", error);
  }
}
