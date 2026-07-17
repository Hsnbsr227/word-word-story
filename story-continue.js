let db;
let roomData = null;
let continueWordTimerId = null;
let continueWordAutoCompleteRound = null;
let continueTimerId = null;
let continueAutoSubmitKey = "";

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("code");
const username = localStorage.getItem("wws_username");
const myKey = safeKey(username);
let activeContinueDraftKey = "";
let activeContinueWordDraftKey = "";
const DEFAULT_WORD_SECONDS = 30;
const DEFAULT_WRITING_SECONDS = 120;
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

const continueKicker = $("continueKicker");
const continueTitle = $("continueTitle");

const continueWordBox = $("continueWordBox");
const continueWordInput = $("continueWordInput");
const sendContinueWordBtn = $("sendContinueWordBtn");
const continueWordTimerRing = $("continueWordTimerRing");
const continueWordTimerText = $("continueWordTimerText");
const continueWordTimerTitle = $("continueWordTimerTitle");
const continueWordTimerNote = $("continueWordTimerNote");

const continueWritingBox = $("continueWritingBox");
const requiredWordBox = $("requiredWordBox");
const requiredContinueWord = $("requiredContinueWord");

const givenStoryText = $("givenStoryText");
const continueText = $("continueText");
const continueWordCount = $("continueWordCount");
const sendContinueBtn = $("sendContinueBtn");
const continueTimerRing = $("continueTimerRing");
const continueTimerText = $("continueTimerText");
const continueTimerTitle = $("continueTimerTitle");
const continueTimerNote = $("continueTimerNote");

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
  const round = roomData?.currentContinueRound || 1;
  localStorage.setItem(getContinueWordDraftKey(round), continueWordInput.value);
});

sendContinueWordBtn.addEventListener("click", sendContinueWord);
continueText.addEventListener("input", () => {
  const round = roomData?.currentContinueRound || 1;
  localStorage.setItem(getContinueDraftKey(round), continueText.value);
  updateContinueWordCount();
});
sendContinueBtn.addEventListener("click", sendContinue);
finishGameBtn.addEventListener("click", finishGame);
lockMobileFocusScroll(continueText);

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

  await ensureContinueWordTimerStarted(roomData);
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

    await ensureContinueWordTimerStarted(roomData);
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
  const previousAssignments = room.continueAssignments?.[round - 1] || {};
  const storyPairings = createPairings(
    playerKeys,
    storyKeys,
    previousAssignments,
    `continue-stories:${roomCode}:${room.createdAt || ""}:${round}`
  );
  const wordPairings = createPairings(
    playerKeys,
    wordOwnerKeys,
    {},
    `continue-words:${roomCode}:${room.createdAt || ""}:${round}`
  );

  playerKeys.forEach((playerKey, index) => {
    const storyKey = storyPairings[playerKey] || storyKeys[index % storyKeys.length];

    let requiredWord = "";

    if (needsNewWord(round) && wordOwnerKeys.length) {
      const wordOwnerKey = wordPairings[playerKey] || wordOwnerKeys[index % wordOwnerKeys.length];

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
  startContinueWordTimer();
  updateContinueWordTimer();

  if (myWord) {
  continueWordInput.value = myWord.word || "";
  continueWordInput.disabled = true;
  sendContinueWordBtn.disabled = true;
  sendContinueWordBtn.textContent = "Gönderildi";
  localStorage.removeItem(getContinueWordDraftKey(round));
} else {
  const draftKey = getContinueWordDraftKey(round);

  if (activeContinueWordDraftKey !== draftKey) {
    continueWordInput.value = localStorage.getItem(draftKey) || "";
    activeContinueWordDraftKey = draftKey;
  }

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
  startContinueTimer();
  updateContinueTimer();

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
  localStorage.removeItem(getContinueDraftKey(round));
  updateContinueWordCount();
} else {
  const draftKey = getContinueDraftKey(round);

  if (activeContinueDraftKey !== draftKey) {
    continueText.value = localStorage.getItem(draftKey) || "";
    activeContinueDraftKey = draftKey;
  }

  continueText.disabled = false;
  sendContinueBtn.disabled = false;
  sendContinueBtn.textContent = "Devamı Gönder";
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

    localStorage.removeItem(getContinueWordDraftKey(round));
    showMessage("");
  } catch (error) {
    console.error(error);
    showMessage("Kelime gönderilirken bir sorun çıktı.");
  }
}

function startContinueTimer() {
  if (continueTimerId) return;

  updateContinueTimer();
  continueTimerId = setInterval(updateContinueTimer, 250);
}

function updateContinueTimer() {
  if (!roomData || roomData.status !== "story-continue") return;

  const round = roomData.currentContinueRound || 1;
  const assignments = roomData.continueAssignments?.[round] || {};
  const continues = roomData.continues?.[round] || {};

  if (!assignments[myKey] || continues[myKey]) return;

  const startedAt = getContinueWritingStartedAt(roomData, round);
  const durationMs = getWritingRoundDurationMs(roomData);
  const elapsed = Math.max(0, Date.now() - startedAt);
  const remainingMs = Math.max(0, durationMs - elapsed);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(1, remainingMs / durationMs));

  renderTimer({
    ring: continueTimerRing,
    text: continueTimerText,
    title: continueTimerTitle,
    note: continueTimerNote,
    remainingSeconds,
    progress,
    expired: remainingMs <= 0,
    waitingText: "Süre bitince taslak otomatik gönderilir.",
  });

  if (remainingMs <= 0) {
    autoSubmitContinue(round);
  }
}

function getContinueWritingStartedAt(room, round) {
  const assignedAt = room.continueAssignments?.[round]?.[myKey]?.assignedAt;
  return assignedAt || room.continueStartedAt || Date.now();
}

async function autoSubmitContinue(round) {
  const submitKey = `${round}:${myKey}`;
  if (continueAutoSubmitKey === submitKey || roomData?.continues?.[round]?.[myKey]) return;

  continueAutoSubmitKey = submitKey;

  const assignment = roomData.continueAssignments?.[round]?.[myKey];
  if (!assignment) return;

  let text = continueText.value.trim() || createTimeoutContinue(assignment.requiredWord, username);

  if (assignment.requiredWord && !containsAssignedWord(text, assignment.requiredWord)) {
    text = `${text} ${assignment.requiredWord}`;
  }

  try {
    await saveContinue(round, assignment, text);
    localStorage.removeItem(getContinueDraftKey(round));
  } catch (error) {
    console.error(error);
    continueAutoSubmitKey = "";
    showMessage("Süre doldu ama devam otomatik gönderilemedi.");
  }
}

async function sendContinue() {
  const text = continueText.value.trim();
  const words = countWords(text);
  const round = roomData.currentContinueRound || 1;
  const assignment = roomData.continueAssignments?.[round]?.[myKey];
  const maxWords = getMaxWords(roomData);

  if (!assignment) {
    showMessage("Sana henüz öykü atanmadı.");
    return;
  }

  if (!text) {
    showMessage("Devam öyküsünü yazmalısın.");
    continueText.focus();
    return;
  }

  if (words > maxWords) {
    showMessage(`Devam metni en fazla ${maxWords} kelime olabilir.`);
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

    localStorage.removeItem(getContinueDraftKey(round));
    showMessage("");
  } catch (error) {
    console.error(error);
    showMessage("Devam gönderilirken bir sorun çıktı.");
  }
}

async function saveContinue(round, assignment, text) {
  const { ref, set } = await fbMod();

  await set(ref(db, `rooms/${roomCode}/continues/${round}/${myKey}`), {
    author: username,
    storyKey: assignment.storyKey,
    text,
    requiredWord: assignment.requiredWord || "",
    createdAt: Date.now(),
  });
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
  const maxWords = getMaxWords(roomData || {});
  continueWordCount.textContent = `${count} / ${maxWords} kelime`;
  continueWordCount.classList.toggle("danger", count > maxWords);
}

function getMaxWords(room) {
  return Number(room.settings?.maxWords || 100);
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

async function ensureContinueWordTimerStarted(room) {
  const round = room.currentContinueRound || 1;

  if (!needsNewWord(round) || room.continueAssignments?.[round]) return;

  const players = room.players || {};
  const words = room.continueWords?.[round] || {};

  if (Object.keys(words).length >= Object.keys(players).length) return;
  if (getContinueWordStartedAt(room, round)) return;

  try {
    const { ref, update } = await fbMod();

    await update(ref(db, `rooms/${roomCode}/continueWordStartedAtByRound`), {
      [round]: Date.now(),
    });
  } catch (error) {
    console.warn("Devam kelime sayacı başlatılamadı:", error);
  }
}

function startContinueWordTimer() {
  if (continueWordTimerId) return;

  updateContinueWordTimer();
  continueWordTimerId = setInterval(updateContinueWordTimer, 250);
}

function updateContinueWordTimer() {
  if (!roomData) return;

  const round = roomData.currentContinueRound || 1;
  const players = roomData.players || {};
  const roundWords = roomData.continueWords?.[round] || {};

  if (
    !needsNewWord(round) ||
    roomData.continueAssignments?.[round] ||
    Object.keys(roundWords).length >= Object.keys(players).length
  ) {
    return;
  }

  const startedAt = getContinueWordStartedAt(roomData, round) || Date.now();
  const elapsed = Math.max(0, Date.now() - startedAt);
  const durationMs = getWordRoundDurationMs(roomData);
  const remainingMs = Math.max(0, durationMs - elapsed);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(1, remainingMs / durationMs));

  renderTimer({
    ring: continueWordTimerRing,
    text: continueWordTimerText,
    title: continueWordTimerTitle,
    note: continueWordTimerNote,
    remainingSeconds,
    progress,
    expired: remainingMs <= 0,
    waitingText: "Süre bitince eksik kelimeler otomatik tamamlanır.",
  });

  if (remainingMs <= 0) {
    autoCompleteContinueWordRound(round);
  }
}

function getContinueWordStartedAt(room, round) {
  return room.continueWordStartedAtByRound?.[round] || 0;
}

function getWordRoundDurationMs(room) {
  return Number(room.settings?.wordSeconds || DEFAULT_WORD_SECONDS) * 1000;
}

function getWritingRoundDurationMs(room) {
  return Number(room.settings?.writingSeconds || DEFAULT_WRITING_SECONDS) * 1000;
}

async function autoCompleteContinueWordRound(round) {
  if (continueWordAutoCompleteRound === round || !roomData) return;

  continueWordAutoCompleteRound = round;

  try {
    const { ref, get, set, update } = await fbMod();

    if (!roomData.continueWords?.[round]?.[myKey] && isValidWord(continueWordInput.value)) {
      const typedWord = continueWordInput.value.trim().toLocaleLowerCase("tr-TR");

      await set(ref(db, `rooms/${roomCode}/continueWords/${round}/${myKey}`), {
        word: typedWord,
        by: username,
        createdAt: Date.now(),
      });

      localStorage.removeItem(getContinueWordDraftKey(round));
    }

    const roomRef = ref(db, `rooms/${roomCode}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) return;

    const room = roomSnap.val();
    const currentRound = room.currentContinueRound || 1;

    if (currentRound !== round || !needsNewWord(round) || room.continueAssignments?.[round]) return;

    const players = room.players || {};
    const words = room.continueWords?.[round] || {};
    const updates = {};

    Object.entries(players).forEach(([playerKey, player], index) => {
      if (words[playerKey]) return;

      const typedWord =
        playerKey === myKey && isValidWord(continueWordInput.value)
          ? continueWordInput.value.trim().toLocaleLowerCase("tr-TR")
          : "";

      updates[`rooms/${roomCode}/continueWords/${round}/${playerKey}`] = {
        word: typedWord || AUTO_WORDS[(index + round) % AUTO_WORDS.length],
        by: player.name || "Oyuncu",
        createdAt: Date.now() + index,
        isAuto: !typedWord,
      };
    });

    if (Object.keys(updates).length) {
      await update(ref(db), updates);
    }
  } catch (error) {
    console.error(error);
    continueWordAutoCompleteRound = null;
    showMessage("Süre doldu ama kelimeler otomatik tamamlanırken bir sorun çıktı.");
  }
}

function renderTimer({ ring, text, title, note, remainingSeconds, progress, expired, waitingText }) {
  if (!ring || !text || !title || !note) return;

  ring.style.setProperty("--timer-progress", `${progress * 100}%`);
  ring.closest(".round-timer")?.classList.toggle("is-low", remainingSeconds <= 7);
  text.textContent = String(remainingSeconds).padStart(2, "0");
  title.textContent = expired ? "SÜRE DOLDU" : "KELİME SÜRESİ";
  note.textContent = expired ? "Tur otomatik hazırlanıyor..." : waitingText;
}

function isValidWord(value) {
  const word = String(value || "").trim();
  return Boolean(word) && !word.includes(" ") && /^[a-zA-ZğüşöçıİĞÜŞÖÇ]+$/.test(word);
}

function getContinueDraftKey(round) {
  return `wws_continue_draft_${roomCode}_${myKey}_${round}`;
}

function getContinueWordDraftKey(round) {
  return `wws_continue_word_draft_${roomCode}_${myKey}_${round}`;
}

function createPairings(sourceKeys, targetKeys, previousAssignments, seed) {
  if (!sourceKeys.length || !targetKeys.length) return {};

  let bestTargets = targetKeys.slice();
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 100; attempt++) {
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

function createBotContinue(botName, round, requiredWord) {
  const wordPart = requiredWord
    ? `${requiredWord} kelimesini usulca ortaya bıraktı`
    : "hikayenin akışını bozmadan ilerledi";
  const templates = [
    `${botName}, ${wordPart}. Karakterler bir an duraksadı, sonra en mantıksız görünen fikir hepsine fazla mantıklı gelmeye başladı.`,
    `${botName}, ${wordPart} ve sahnenin havası değişti. Artık kimse önceki cümlenin güvenli olduğundan emin değildi.`,
    `${botName}, ${wordPart}. Bu küçük hamle, hikayeyi hem komik hem de şüpheli bir çıkmaza sürükledi.`,
    `${botName}, ${wordPart}; ardından herkesin sakladığı küçük sır bir anda fazla görünür oldu.`,
  ];

  return templates[(round + Math.abs(hashString(`${botName}:${requiredWord}`))) % templates.length];
}

function createTimeoutContinue(requiredWord, authorName) {
  const wordPart = requiredWord
    ? `${requiredWord} kelimesini hikayeye iliştirerek`
    : "hikayenin ritmini bozmadan";

  return `${authorName || "Oyuncu"}, ${wordPart} kısa ama net bir devam yazdı. Olaylar hızlandı, karakterler yeni bir kararın eşiğine geldi.`;
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
