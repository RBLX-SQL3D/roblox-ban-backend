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

const GAMES = JSON.parse(process.env.ROBLOX_GAMES_CONFIG || "{}");

let banCache = new Map();

/* ========================= */
/* UTILITIES */
/* ========================= */

function phTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

async function discordLog(title, description) {
  if (!DISCORD_WEBHOOK) return;
  await axios.post(DISCORD_WEBHOOK, {
    embeds: [{
      title,
      description,
      color: 15158332,
      timestamp: new Date().toISOString()
    }]
  }).catch(()=>{});
}

/* ========================= */
/* ROBLOX BAN API */
/* ========================= */

async function robloxBan(gameKey, userId, permanent, days = 60) {
  const game = GAMES[gameKey];
  if (!game) return;

  const url = `https://apis.roblox.com/cloud/v2/universes/${game.universeId}/user-restrictions`;

  let body = {
    user: `users/${userId}`,
    gameJoinRestriction: { active: true }
  };

  if (!permanent) {
    const expire = new Date();
    expire.setDate(expire.getDate() + days);
    body.gameJoinRestriction.expireTime = expire.toISOString();
  }

  await axios.post(url, body, {
    headers: {
      "x-api-key": game.apiKey,
      "Content-Type": "application/json"
    }
  }).catch(()=>{});
}

async function robloxUnban(gameKey, userId) {
  const game = GAMES[gameKey];
  if (!game) return;

  const url = `https://apis.roblox.com/cloud/v2/universes/${game.universeId}/user-restrictions/users/${userId}`;

  await axios.delete(url, {
    headers: { "x-api-key": game.apiKey }
  }).catch(()=>{});
}

/* ========================= */
/* ALT DETECTION */
/* ========================= */

async function detectAndBanAlts(gameKey, mainUserId, cardId) {
  const game = GAMES[gameKey];
  if (!game) return;

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

  } catch {}
}

/* ========================= */
/* CACHE */
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
/* CARD MANAGEMENT */
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

async function applyBan(gameKey, cardId, userId, username, type) {

  const isPermanent = type === "perm";

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  let desc = card.data.desc || "";
  const joinMatch = desc.match(/Join Attempts:\s*(\d+)/);
  const attempts = joinMatch ? joinMatch[1] : "0";

  if (isPermanent) {

    const permTime = phTime();

    const updatedDescription =
`Profile: https://www.roblox.com/users/${userId}/profile
Reason: EXPLOITING
Duration: PERMANENT
Appealable: NO
Permanent Ban Issued: ${permTime}
Join Attempts: ${attempts}`;

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      {
        desc: updatedDescription,
        idList: BANNED_LIST_ID,
        start: null,
        due: null
      },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await robloxBan(gameKey, userId, true);

  } else {

    const startDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(startDate.getDate() + 60);

    const updatedDescription =
`Profile: https://www.roblox.com/users/${userId}/profile
Reason: Rule Violation
Duration: 60 Days
Appealable: YES
Start Date: ${phTime()}
Join Attempts: ${attempts}`;

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      {
        desc: updatedDescription,
        idList: TEMP_BANNED_LIST_ID,
        start: startDate.toISOString(),
        due: dueDate.toISOString()
      },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await robloxBan(gameKey, userId, false);
  }

  await detectAndBanAlts(gameKey, userId, cardId);
  await discordLog("Ban Issued", `User: ${username}`);
}

/* ========================= */
/* JOIN ATTEMPTS */
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
/* ENDPOINTS */
/* ========================= */

app.post("/ban", async (req, res) => {

  const { userId, username, type, game } = req.body;

  if (!userId || !username || !type || !game)
    return res.status(400).json({ error: "Missing data" });

  const cardId = await getOrCreateCard(userId, username);
  await applyBan(game, cardId, userId, username, type);
  await refreshCache();

  res.json({ success: true });
});

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
  console.log("NOX Enterprise Moderation Running");
});