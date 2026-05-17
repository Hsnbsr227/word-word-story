let db;
let roomData = null;

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username");
const myKey = safeKey(username);

const continueKicker = $("continueKicker");
const continueTitle = $("continueTitle");

const continueWordBox = $("continueWordBox");
const continueWordInput = $("continueWordInput");
const sendContinueWordBtn = $("sendContinueWordBtn");

const continueWritingBox = $("continueWritingBox");
const requiredWordBox = $("requiredWordBox");
const requiredContinueWord = $("requiredContinueWord");

const givenStoryText = $("givenStoryText");
const continueText = $("continueText");
const continueWordCount = $("continueWordCount");
const sendContinueBtn = $("sendContinueBtn");

const continueProgressTitle = $("continueProgressTitle");
const continueProgress = $("continueProgress");
const continuePlayersList = $("continuePlayersList");

const finishGameBtn = $("finishGameBtn");
const continueInfo = $("continueInfo");
const continueMessage = $("continueMessage");

if (!roomCode || !username) {
  window.location.href = "index.html";
}

if (window.__firebaseDB) {
  db = window.__firebaseDB;
  initStoryContinue();
} else {
  window.addEventListener("firebase-ready", () => {
    db = window.__firebaseDB;
    initStoryContinue();
  });
}

continueWordInput.addEventListener("input", () => {
  continueWordInput.value = continueWordInput.value.replace(/\s+/g, "");
});

sendContinueWordBtn.addEventListener("click", sendContinueWord);
continueText.addEventListener("input", updateContinueWordCount);
sendContinueBtn.addEventListener("click", sendContinue);
finishGameBtn.addEventListener("click", finishGame);

async function fbMod() {
  return await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
}

async function initStoryContinue() {
  const { ref, get, onValue } = await fbMod();

  const roomRef = ref(db, `rooms/${roomCode}`);
  const roomSnap = await get(roomRef);

  if (!roomSnap.exists()) {
    window.location.href = "index.html";
    return;
  }

  roomData = roomSnap.val();

  await createContinueAssignmentsIfNeeded(roomData);
  await createBotContinueWordsIfNeeded(roomData);
  await createBotContinuesIfNeeded(roomData);

  onValue(roomRef, async (snapshot) => {
    if (!snapshot.exists()) {
      window.location.href = "index.html";
      return;
    }

    roomData = snapshot.val();

    if (roomData.status === "finished") {
      window.location.href = `results.html?code=${encodeURIComponent(roomCode)}`;
      return;
    }

    await createBotContinueWordsIfNeeded(roomData);
    await createContinueAssignmentsIfNeeded(roomData);
    await createBotContinuesIfNeeded(roomData);

    renderStoryContinue(roomData);
  });
}

function needsNewWord(round) {
  return round > 1 && round % 2 === 0;
}

async function createContinueAssignmentsIfNeeded(room) {
  const round = room.currentContinueRound || 1;

  if (room.continueAssignments?.[round]) return;

  const players = room.players || {};
  const stories = room.stories || {};
  const playerKeys = Object.keys(players).sort();
  const storyKeys = Object.keys(stories).sort();

  if (playerKeys.length < 2 || storyKeys.length < 2) return;

  if (needsNewWord(round)) {
    const words = room.continueWords?.[round] || {};
    if (Object.keys(words).length < playerKeys.length) return;
  }

  const updates = {};
  const roundWords = room.continueWords?.[round] || {};
  const wordOwnerKeys = Object.keys(roundWords).sort();

  playerKeys.forEach((playerKey, index) => {
    let storyKey = storyKeys[(index + round) % storyKeys.length];

    if (storyKey === playerKey && storyKeys.length > 1) {
      storyKey = storyKeys[(index + round + 1) % storyKeys.length];
    }

    let requiredWord = "";

    if (needsNewWord(round) && wordOwnerKeys.length) {
      let wordOwnerKey = wordOwnerKeys[(index + 1) % wordOwnerKeys.length];

      if (wordOwnerKey === playerKey && wordOwnerKeys.length > 1) {
        wordOwnerKey = wordOwnerKeys[(index + 2) % wordOwnerKeys.length];
      }

      requiredWord = roundWords[wordOwnerKey]?.word || "";
    }

    const story = stories[storyKey];

    updates[`rooms/${roomCode}/continueAssignments/${round}/${playerKey}`] = {
      round,
      storyKey,
      originalAuthor: story.author,
      originalText: story.text,
      previousContinues: getPreviousContinues(room, storyKey, round),
      requiredWord,
      assignedAt: Date.now() + index,
    };
  });

  const { ref, update } = await fbMod();
  await update(ref(db), updates);
}

function getPreviousContinues(room, storyKey, currentRound) {
  const continuesByRound = room.continues || {};
  const texts = [];

  for (let round = 1; round < currentRound; round++) {
    const roundContinues = continuesByRound[round] || {};

    Object.values(roundContinues).forEach((item) => {
      if (item.storyKey === storyKey && item.text) {
        texts.push(item.text);
      }
    });
  }

  return texts;
}

async function createBotContinueWordsIfNeeded(room) {
  const round = room.currentContinueRound || 1;

  if (!needsNewWord(round)) return;

  const players = room.players || {};
  const words = room.continueWords?.[round] || {};
  const botWords = [
    "merdiven",
    "gölge",
    "anahtar",
    "dakika",
    "cam",
    "yolculuk",
    "sessizlik",
    "harita",
  ];
  const updates = {};

  Object.entries(players).forEach(([playerKey, player], index) => {
    if (!player.isBot || words[playerKey]) return;

    updates[`rooms/${roomCode}/continueWords/${round}/${playerKey}`] = {
      word: botWords[(index + round) % botWords.length],
      by: player.name,
      createdAt: Date.now() + index,
      isBot: true,
    };
  });

  if (!Object.keys(updates).length) return;

  const { ref, update } = await fbMod();
  await update(ref(db), updates);
}

async function createBotContinuesIfNeeded(room) {
  const players = room.players || {};
  const round = room.currentContinueRound || 1;
  const assignments = room.continueAssignments?.[round] || {};
  const continues = room.continues?.[round] || {};
  const updates = {};

  Object.entries(players).forEach(([playerKey, player], index) => {
    if (!player.isBot || continues[playerKey] || !assignments[playerKey]) return;

    const requiredWord = assignments[playerKey].requiredWord || "";
    const text = createBotContinue(player.name, round, requiredWord);

    updates[`rooms/${roomCode}/continues/${round}/${playerKey}`] = {
      author: player.name,
      storyKey: assignments[playerKey].storyKey,
      text,
      requiredWord,
      createdAt: Date.now() + index,
      isBot: true,
    };
  });

  if (!Object.keys(updates).length) return;

  const { ref, update } = await fbMod();
  await update(ref(db), updates);
}

function renderStoryContinue(room) {
  const players = room.players || {};
  const round = room.currentContinueRound || 1;
  const totalRounds = room.totalContinueRounds || 1;
  const playerEntries = Object.entries(players);
  const isHost = room.createdBy === username;

  const wordMode = needsNewWord(round);
  const roundWords = room.continueWords?.[round] || {};
  const assignments = room.continueAssignments?.[round] || {};
  const continues = room.continues?.[round] || {};
  const myWord = roundWords[myKey];
  const myAssignment = assignments[myKey];
  const myContinue = continues[myKey];

  continueKicker.textContent = `Devam Turu ${round} / ${totalRounds}`;

  if (wordMode && Object.keys(roundWords).length < playerEntries.length) {
    renderWordMode(playerEntries, roundWords, myWord, round, totalRounds);
    return;
  }

  renderWritingMode(
    playerEntries,
    assignments,
    continues,
    myAssignment,
    myContinue,
    isHost,
    round,
    totalRounds
  );
}

function renderWordMode(playerEntries, roundWords, myWord, round, totalRounds) {
  continueTitle.textContent = "Bu tur için yeni bir kelime bırak";
  continueWordBox.classList.remove("hidden");
  continueWritingBox.classList.add("hidden");
  finishGameBtn.classList.add("hidden");

  continueProgressTitle.textContent = "Kelime Durumu";
  continueProgress.textContent = `${Object.keys(roundWords).length} / ${playerEntries.length}`;
  continueInfo.textContent = `Devam turu ${round} / ${totalRounds}. Herkes kelime verince yazma kısmı açılacak.`;

  if (myWord) {
    continueWordInput.value = myWord.word || "";
    continueWordInput.disabled = true;
    sendContinueWordBtn.disabled = true;
    sendContinueWordBtn.textContent = "Gönderildi";
  } else {
    continueWordInput.disabled = false;
    sendContinueWordBtn.disabled = false;
    sendContinueWordBtn.textContent = "Kelimeyi Gönder";
  }

  renderStatusList(playerEntries, roundWords, "Kelimesini verdi", "Kelime bekleniyor");
}

function renderWritingMode(
  playerEntries,
  assignments,
  continues,
  myAssignment,
  myContinue,
  isHost,
  round,
  totalRounds
) {
  continueTitle.textContent = "Başkasının öyküsünü devam ettir";
  continueWordBox.classList.add("hidden");
  continueWritingBox.classList.remove("hidden");

  continueProgressTitle.textContent = "Devam Durumu";
  continueProgress.textContent = `${Object.keys(continues).length} / ${playerEntries.length}`;

  if (myAssignment) {
  const previousParts = myAssignment.previousContinues || [];
  const lastPart = previousParts.length
    ? previousParts[previousParts.length - 1]
    : myAssignment.originalText;

  givenStoryText.textContent = lastPart || "Öykü atanıyor...";

  if (myAssignment.requiredWord) {
    requiredWordBox.classList.remove("hidden");
    requiredContinueWord.textContent = myAssignment.requiredWord;
  } else {
    requiredWordBox.classList.add("hidden");
    requiredContinueWord.textContent = "---";
  }
} else {
  givenStoryText.textContent = "Öykü atanıyor...";
  requiredWordBox.classList.add("hidden");
}

  if (myContinue) {
    continueText.value = myContinue.text || "";
    continueText.disabled = true;
    sendContinueBtn.disabled = true;
    sendContinueBtn.textContent = "Gönderildi";
    updateContinueWordCount();
  } else {
    continueText.disabled = false;
    sendContinueBtn.disabled = false;
    sendContinueBtn.textContent = "Devamı Gönder";

    if (continueText.disabled === false && continueText.value && !myContinue) {
      continueText.value = continueText.value;
    }

    updateContinueWordCount();
  }

  renderStatusList(playerEntries, continues, "Devamı gönderdi", "Devamı yazıyor");

  const submittedCount = Object.keys(continues).length;
  const totalCount = playerEntries.length;

  if (isHost && submittedCount === totalCount && totalCount > 0) {
    finishGameBtn.classList.remove("hidden");
    finishGameBtn.textContent =
      round >= totalRounds ? "Sonuçları Gör" : "Sonraki Devam Turuna Geç";

    continueInfo.textContent =
      round >= totalRounds
        ? "Tüm devam turları bitti. Sonuçları açabilirsin."
        : "Herkes devamını gönderdi. Sonraki devam turuna geçebilirsin.";
  } else if (isHost) {
    finishGameBtn.classList.add("hidden");
    continueInfo.textContent = `Devam turu ${round} / ${totalRounds}. Herkesin devamını göndermesi bekleniyor.`;
  } else {
    finishGameBtn.classList.add("hidden");
    continueInfo.textContent = `Devam turu ${round} / ${totalRounds}. Oyun kurucusu sonraki adıma geçince devam edeceksin.`;
  }
}

function renderStatusList(playerEntries, doneMap, doneText, waitText) {
  continuePlayersList.innerHTML = "";

  playerEntries
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
    .forEach(([playerKey, player]) => {
      const done = Boolean(doneMap[playerKey]);

      const item = document.createElement("div");
      item.className = "player-item";
      item.innerHTML = `
        <div class="player-avatar">${getInitial(player.name)}</div>
        <div class="player-info">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${done ? doneText : waitText}</span>
        </div>
        <div class="word-status ${done ? "done" : ""}">
          ${done ? "✓" : "…"}
        </div>
      `;

      continuePlayersList.appendChild(item);
    });
}

async function sendContinueWord() {
  const word = continueWordInput.value.trim().toLocaleLowerCase("tr-TR");

  if (!word) {
    showMessage("Bir kelime yazmalısın.");
    continueWordInput.focus();
    return;
  }

  if (!/^[a-zA-ZğüşöçıİĞÜŞÖÇ]+$/.test(word)) {
    showMessage("Kelime sadece harflerden oluşmalı.");
    return;
  }

  try {
    const { ref, set } = await fbMod();
    const round = roomData.currentContinueRound || 1;

    await set(ref(db, `rooms/${roomCode}/continueWords/${round}/${myKey}`), {
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

async function sendContinue() {
  const text = continueText.value.trim();
  const words = countWords(text);
  const round = roomData.currentContinueRound || 1;
  const assignment = roomData.continueAssignments?.[round]?.[myKey];

  if (!assignment) {
    showMessage("Sana henüz öykü atanmadı.");
    return;
  }

  if (!text) {
    showMessage("Devam öyküsünü yazmalısın.");
    continueText.focus();
    return;
  }

  if (words > 100) {
    showMessage("Devam metni en fazla 100 kelime olabilir.");
    return;
  }

  if (assignment.requiredWord && !containsAssignedWord(text, assignment.requiredWord)) {
    showMessage(`Devam metninde "${assignment.requiredWord}" kelimesi geçmeli.`);
    return;
  }

  try {
    const { ref, set } = await fbMod();

    await set(ref(db, `rooms/${roomCode}/continues/${round}/${myKey}`), {
      author: username,
      storyKey: assignment.storyKey,
      text,
      requiredWord: assignment.requiredWord || "",
      createdAt: Date.now(),
    });

    showMessage("");
  } catch (error) {
    console.error(error);
    showMessage("Devam gönderilirken bir sorun çıktı.");
  }
}

async function finishGame() {
  const round = roomData.currentContinueRound || 1;
  const totalRounds = roomData.totalContinueRounds || 1;

  try {
    const { ref, update } = await fbMod();

    if (round >= totalRounds) {
      await update(ref(db, `rooms/${roomCode}`), {
        status: "finished",
        finishedAt: Date.now(),
      });
      return;
    }

    await update(ref(db, `rooms/${roomCode}`), {
      currentContinueRound: round + 1,
    });
  } catch (error) {
    console.error(error);
    showMessage("Sonraki tura geçerken bir sorun çıktı.");
  }
}

function updateContinueWordCount() {
  const count = countWords(continueText.value);
  continueWordCount.textContent = `${count} / 100 kelime`;
  continueWordCount.classList.toggle("danger", count > 100);
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

function createBotContinue(botName, round, requiredWord) {
  const wordPart = requiredWord
    ? `${requiredWord} kelimesini de hikayenin içine katarak`
    : "hikayenin akışını bozmadan";

  return `${botName}, ${wordPart} olayları beklenmedik bir yöne çevirdi. Herkes bundan sonra ne olacağını merak ederken, hikaye daha da tuhaf ve eğlenceli bir hale geldi.`;
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
  continueMessage.textContent = text;
}
