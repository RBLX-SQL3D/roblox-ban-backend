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

/* ========================= */
/* MULTI-GAME CONFIG */
/* ========================= */

const GAMES = {
  GAME1: {
    universeId: process.env.GAME1_UNIVERSE_ID,
    apiKey: process.env.GAME1_ROBLOX_API_KEY
  },
  GAME2: {
    universeId: process.env.GAME2_UNIVERSE_ID,
    apiKey: process.env.GAME2_ROBLOX_API_KEY
  }
};

let banCache = new Map();

/* ========================= */
/* UTILITIES */
/* ========================= */

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

/* ========================= */
/* ROBLOX BAN API */
/* ========================= */

async function robloxBan(gameKey, userId, isPermanent, days = 60) {

  const game = GAMES[gameKey];
  if (!game || !game.apiKey) return;

  const url = `https://apis.roblox.com/cloud/v2/universes/${game.universeId}/user-restrictions`;

  let body = {
    user: `users/${userId}`,
    gameJoinRestriction: {
      active: true
    }
  };

  if (!isPermanent) {
    const expire = new Date();
    expire.setDate(expire.getDate() + days);
    body.gameJoinRestriction.expireTime = expire.toISOString();
  }

  await axios.post(url, body, {
    headers: {
      "x-api-key": game.apiKey,
      "Content-Type": "application/json"
    }
  }).catch(err => console.log("Roblox Ban Error:", err.message));
}

async function robloxUnban(gameKey, userId) {

  const game = GAMES[gameKey];
  if (!game || !game.apiKey) return;

  const url = `https://apis.roblox.com/cloud/v2/universes/${game.universeId}/user-restrictions/users/${userId}`;

  await axios.delete(url, {
    headers: { "x-api-key": game.apiKey }
  }).catch(err => console.log("Roblox Unban Error:", err.message));
}

/* ========================= */
/* ALT DETECTION */
/* ========================= */

async function detectAndBanAlts(gameKey, mainUserId, cardId) {

  const game = GAMES[gameKey];
  if (!game || !game.apiKey) return;

  try {
    const res = await axios.get(
      `https://apis.roblox.com/experimental/ban/v1/users/${mainUserId}/linked-accounts`,
      { headers: { "x-api-key": game.apiKey } }
    );

    const alts = res.data.linkedAccounts || [];

    for (const alt of alts) {

      await robloxBan(gameKey, alt.userId, false);

      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/actions/comments`,
        {
          text: `ALT DETECTED & BANNED
Username: ${alt.username}
UserId: ${alt.userId}
Time (PH): ${phTime()}`
        },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
      );
    }

  } catch (err) {
    console.log("Alt Detection Error:", err.message);
  }
}

/* ========================= */
/* CACHE SYSTEM */
/* ========================= */

async function refreshCache() {

  banCache.clear();

  const res = await axios.get(
    `https://api.trello.com/1/boards/${BOARD_ID}/cards`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  for (const card of res.data) {
    const match = card.name.match(/\d+/);
    if (!match) continue;

    banCache.set(match[0], { cardId: card.id });
  }
}

/* ========================= */
/* CREATE OR GET CARD */
/* ========================= */

async function getOrCreateCard(userId, username) {

  if (banCache.has(userId))
    return banCache.get(userId).cardId;

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

/* ========================= */
/* APPLY BAN */
/* ========================= */

async function applyBan(gameKey, cardId, userId, username, type) {

  const isPermanent = type === "perm";

  let start = null;
  let due = null;
  let listId = isPermanent ? BANNED_LIST_ID : TEMP_BANNED_LIST_ID;
  let duration = isPermanent ? "PERMANENT" : "60 Days";
  let appealable = isPermanent ? "NO" : "YES";

  if (!isPermanent) {
    const startDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(startDate.getDate() + 60);

    start = startDate.toISOString();
    due = dueDate.toISOString();
  }

  const description =
`Profile: https://www.roblox.com/users/${userId}/profile
Reason: ${isPermanent ? "EXPLOITING" : "Rule Violation"}
Duration: ${duration}
Appealable: ${appealable}
Join Attempts: 0`;

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: description, idList: listId, start, due },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await robloxBan(gameKey, userId, isPermanent);
  await detectAndBanAlts(gameKey, userId, cardId);

  await discordLog("Ban Issued",
    `User: ${username}
Duration: ${duration}
Game: ${gameKey}`);
}

/* ========================= */
/* JOIN ATTEMPT */
/* ========================= */

async function handleJoinAttempt(cardId) {

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  const desc = card.data.desc || "";
  const match = desc.match(/Join Attempts:\s*(\d+)/);
  let attempts = match ? parseInt(match[1]) : 0;
  attempts++;

  const updated = desc.replace(
    /Join Attempts:\s*\d+/,
    `Join Attempts: ${attempts}`
  );

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: updated },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await axios.post(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    {
      text: `Attempted to join
Time (PH): ${phTime()}`
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );
}

/* ========================= */
/* BAN ENDPOINT */
/* ========================= */

app.post("/ban", async (req, res) => {

  const { userId, username, type, game } = req.body;

  if (!userId || !username || !type || !game)
    return res.status(400).json({ error: "Missing data" });

  try {

    const cardId = await getOrCreateCard(userId, username);

    await applyBan(game, cardId, userId, username, type);

    await refreshCache();

    res.json({ success: true });

  } catch (err) {
    console.log("Ban Error:", err.message);
    res.status(500).json({ error: "Ban failed" });
  }
});

/* ========================= */
/* CHECK BAN */
/* ========================= */

app.get("/checkban", async (req, res) => {

  const { userId, game } = req.query;

  if (!banCache.has(userId))
    return res.json({ banned: false });

  const { cardId } = banCache.get(userId);

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  if (card.data.due && new Date() > new Date(card.data.due)) {

    await robloxUnban(game, userId);

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      { idList: RESOLVED_LIST_ID },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await refreshCache();
    return res.json({ banned: false });
  }

  await handleJoinAttempt(cardId);

  return res.json({ banned: true });
});

app.listen(process.env.PORT || 3000, async () => {
  await refreshCache();
  console.log("NOX Enterprise Multi-Game System Running");
});