const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  BANNED_LIST_ID,
  TEMP_BANNED_LIST_ID,
  RESOLVED_LIST_ID,
  DISCORD_WEBHOOK,
  ROBLOX_API_KEY
} = process.env;

let banCache = new Map();

/* ========================= */
/* UTILITIES */
/* ========================= */

function phTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

async function logToDiscord(title, description, color = 15158332) {
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
/* CACHE */
/* ========================= */

async function refreshCache() {

  banCache.clear();

  const lists = [BANNED_LIST_ID, TEMP_BANNED_LIST_ID];

  for (const listId of lists) {

    const res = await axios.get(
      `https://api.trello.com/1/lists/${listId}/cards`,
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    for (const card of res.data) {

      const match = card.name.match(/\d+/);
      if (!match) continue;

      banCache.set(match[0], {
        cardId: card.id
      });
    }
  }
}

/* ========================= */
/* AUTO ALT DETECTION */
/* ========================= */

async function checkAltAccounts(userId) {

  if (!ROBLOX_API_KEY) return [];

  try {

    const res = await axios.get(
      `https://apis.roblox.com/cloud/v2/users/${userId}/linked-accounts`,
      {
        headers: {
          "x-api-key": ROBLOX_API_KEY
        }
      }
    );

    return res.data.accounts || [];

  } catch {
    return [];
  }
}

/* ========================= */
/* CREATE CARD */
/* ========================= */

async function createCard(userId, username) {

  const newCard = await axios.post(
    "https://api.trello.com/1/cards",
    {
      name: `${userId} | ${username}`,
      idList: BANNED_LIST_ID,
      desc: ""
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  return newCard.data.id;
}

/* ========================= */
/* APPLY BAN */
/* ========================= */

async function applyBan(cardId, userId, username, reason) {

  const isExploit = reason.toUpperCase().includes("EXPLOIT");

  let start = null;
  let due = null;
  let listId = BANNED_LIST_ID;
  let duration = "PERMANENT";
  let appealable = "NO";

  if (!isExploit) {

    const startDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(startDate.getDate() + 60);

    start = startDate.toISOString();
    due = dueDate.toISOString();

    duration = "60 Days";
    appealable = "YES";
    listId = TEMP_BANNED_LIST_ID;
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

  await logToDiscord(
    "🔨 Ban Issued",
    `User: ${username}\nReason: ${reason}\nDuration: ${duration}`
  );
}

/* ========================= */
/* JOIN ATTEMPT TRACKING */
/* ========================= */

async function incrementJoin(cardId, userId) {

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  const match = card.data.desc.match(/Join Attempts:\s*(\d+)/);
  let attempts = match ? parseInt(match[1]) : 0;
  attempts++;

  const updatedDesc = card.data.desc.replace(
    /Join Attempts:\s*\d+/,
    `Join Attempts: ${attempts}`
  );

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: updatedDesc },
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

/* ========================= */
/* BAN ENDPOINT */
/* ========================= */

app.post("/ban", async (req, res) => {

  const { userId, username, type } = req.body;

  if (!userId || !username || !type)
    return res.status(400).json({ error: "Missing data" });

  try {

    let cardId;

    if (banCache.has(userId)) {
      cardId = banCache.get(userId).cardId;
    } else {
      cardId = await createCard(userId, username);
    }

    const reason = type === "perm"
      ? "EXPLOITING"
      : "Rule Violation";

    await applyBan(cardId, userId, username, reason);

    const alts = await checkAltAccounts(userId);

    for (const alt of alts) {
      await createCard(alt.id, alt.username);
    }

    await refreshCache();

    res.json({ success: true });

  } catch (err) {
    console.log(err.message);
    res.status(500).json({ error: "Ban failed" });
  }
});

/* ========================= */
/* CHECKBAN */
/* ========================= */

app.get("/checkban", async (req, res) => {

  const { userId } = req.query;
  if (!userId) return res.json({ permanent: false });

  if (!banCache.has(userId))
    return res.json({ permanent: false });

  const cardId = banCache.get(userId).cardId;

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

  await incrementJoin(cardId, userId);

  return res.json({
    permanent: !card.data.due
  });
});

app.listen(process.env.PORT || 3000, async () => {
  await refreshCache();
  console.log("Server running.");
});