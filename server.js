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
  RESOLVED_LIST_ID
} = process.env;

let banCache = new Map();

/* ====================== */
/* UTIL */
/* ====================== */

function extractReason(desc) {
  if (!desc) return "Not Specified";
  const match = desc.match(/Reason:\s*(.*)/i);
  return match ? match[1].trim() : "Not Specified";
}

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

async function getOrCreateCard(userId, username) {

  if (banCache.has(userId))
    return banCache.get(userId).cardId;

  const card = await axios.post(
    "https://api.trello.com/1/cards",
    {
      name: `${userId} | ${username}`,
      idList: TEMP_BANNED_LIST_ID,
      desc: `Profile: https://www.roblox.com/users/${userId}/profile
Reason: Not Specified
Join Attempts: 0`
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  return card.data.id;
}

/* ====================== */
/* BAN */
/* ====================== */

app.post("/ban", async (req, res) => {

  const { userId, username, type } = req.body;

  if (!userId || !username || !type)
    return res.status(400).json({ error: "Missing data" });

  const cardId = await getOrCreateCard(userId, username);

  await refreshCache(); // fix for :pb issue

  if (type === "perm") {
    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      { idList: BANNED_LIST_ID },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );
  } else {
    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      { idList: TEMP_BANNED_LIST_ID },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );
  }

  await refreshCache();
  res.json({ success: true });
});

/* ====================== */
/* RESOLVE */
/* ====================== */

app.post("/resolve", async (req, res) => {

  const { userId } = req.body;

  if (!banCache.has(userId))
    return res.status(404).json({ error: "Card not found" });

  const { cardId } = banCache.get(userId);

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { idList: RESOLVED_LIST_ID },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await refreshCache();
  res.json({ success: true });
});

/* ====================== */
/* CHECK BAN */
/* ====================== */

app.get("/checkban", async (req, res) => {

  const { userId } = req.query;

  if (!banCache.has(userId))
    return res.json({ banned: false });

  const { cardId } = banCache.get(userId);

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  if (card.data.idList === RESOLVED_LIST_ID)
    return res.json({ banned: false });

  const reason = extractReason(card.data.desc);

  return res.json({
    banned: true,
    reason: reason
  });
});

app.listen(process.env.PORT || 3000, async () => {
  await refreshCache();
  console.log("NOX System Running");
});