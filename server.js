const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  BOARD_ID,
  BANNED_LIST_ID,
  TEMP_BANNED_LIST_ID,
  RESOLVED_LIST_ID,
  DISCORD_WEBHOOK
} = process.env;

let banCache = new Map();

/* ===================================== */
/* UTILITIES */
/* ===================================== */

function phTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

async function discordLog(title, description, color = 15158332) {
  if (!DISCORD_WEBHOOK) return;

  await axios.post(DISCORD_WEBHOOK, {
    embeds: [{
      title,
      description,
      color,
      timestamp: new Date().toISOString()
    }]
  }).catch(()=>{});
}

/* ===================================== */
/* CACHE ALL CARDS FROM BOARD */
/* ===================================== */

async function refreshCache() {

  banCache.clear();

  const res = await axios.get(
    `https://api.trello.com/1/boards/${BOARD_ID}/cards`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  for (const card of res.data) {

    const match = card.name.match(/\d+/);
    if (!match) continue;

    banCache.set(match[0], {
      cardId: card.id,
      listId: card.idList
    });
  }
}

/* ===================================== */
/* CREATE OR GET CARD */
/* ===================================== */

async function getOrCreateCard(userId, username) {

  if (banCache.has(userId)) {
    return banCache.get(userId).cardId;
  }

  const card = await axios.post(
    "https://api.trello.com/1/cards",
    {
      name: `${userId} | ${username}`,
      idList: TEMP_BANNED_LIST_ID,
      desc: ""
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  return card.data.id;
}

/* ===================================== */
/* APPLY BAN LOGIC */
/* ===================================== */

async function applyBan(cardId, userId, username, type, reason) {

  const isPermanent = type === "perm";

  let start = null;
  let due = null;
  let listId = isPermanent ? BANNED_LIST_ID : TEMP_BANNED_LIST_ID;
  let duration = "PERMANENT";
  let appealable = "NO";

  if (!isPermanent) {

    const startDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(startDate.getDate() + 60);

    start = startDate.toISOString();
    due = dueDate.toISOString();
    duration = "60 Days";
    appealable = "YES";
  }

  const description =
`Profile: https://www.roblox.com/users/${userId}/profile
Reason: ${reason}
Duration: ${duration}
Appealable: ${appealable}
Join Attempts: 0`;

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: description, idList: listId, start, due },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await discordLog(
    "Ban Updated",
    `User: ${username}\nType: ${duration}\nReason: ${reason}`
  );
}

/* ===================================== */
/* JOIN ATTEMPT HANDLER */
/* ===================================== */

async function handleJoinAttempt(cardId) {

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  const desc = card.data.desc || "";

  const match = desc.match(/Join Attempts:\s*(\d+)/);
  let attempts = match ? parseInt(match[1]) : 0;
  attempts++;

  const newDesc = desc.replace(
    /Join Attempts:\s*\d+/,
    `Join Attempts: ${attempts}`
  );

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: newDesc },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await axios.post(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    {
      text: `Attempted to join\nTime (PH): ${phTime()}`
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );
}

/* ===================================== */
/* BAN ENDPOINT */
/* ===================================== */

app.post("/ban", async (req, res) => {

  const { userId, username, type } = req.body;

  if (!userId || !username || !type)
    return res.status(400).json({ error: "Missing data" });

  try {

    const cardId = await getOrCreateCard(userId, username);

    const reason = type === "perm"
      ? "EXPLOITING"
      : "Rule Violation";

    await applyBan(cardId, userId, username, type, reason);

    await refreshCache();

    res.json({ success: true });

  } catch (err) {
    console.log(err.message);
    res.status(500).json({ error: "Ban failed" });
  }
});

/* ===================================== */
/* CHECKBAN */
/* ===================================== */

app.get("/checkban", async (req, res) => {

  const { userId } = req.query;
  if (!userId) return res.json({ permanent: false });

  if (!banCache.has(userId))
    return res.json({ permanent: false });

  const { cardId } = banCache.get(userId);

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  if (card.data.due && new Date() > new Date(card.data.due)) {

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      { idList: RESOLVED_LIST_ID },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await refreshCache();
    return res.json({ permanent: false });
  }

  await handleJoinAttempt(cardId);

  return res.json({
    permanent: !card.data.due
  });
});

/* ===================================== */

app.listen(process.env.PORT || 3000, async () => {
  await refreshCache();
  console.log("Enterprise moderation backend active.");
});