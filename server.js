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

/* ================= TIME ================= */

function phNow() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

function isoNow() {
  return new Date().toISOString();
}

function isoPlus60() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString();
}

/* ================= CACHE ================= */

async function refreshCache() {
  banCache.clear();

  const res = await axios.get(
    `https://api.trello.com/1/boards/${BOARD_ID}/cards`,
    {
      params: {
        key: TRELLO_KEY,
        token: TRELLO_TOKEN,
        cards: "open"
      }
    }
  );

  for (const card of res.data) {
    const match = card.name.match(/\d+/);
    if (!match) continue;
    banCache.set(match[0], { cardId: card.id });
  }
}

/* ================= DESCRIPTION ================= */

function parseDesc(desc) {
  const lines = desc ? desc.split("\n") : [];
  const data = {};
  for (const line of lines) {
    const parts = line.split(": ");
    if (parts.length >= 2)
      data[parts[0].trim()] = parts.slice(1).join(": ").trim();
  }
  return data;
}

function buildDesc(d) {
  return `Profile: ${d.Profile}
Reason: ${d.Reason}
Duration: ${d.Duration}
Appealable: ${d.Appealable}
Start Date: ${d["Start Date"] || "N/A"}
Due Date: ${d["Due Date"] || "N/A"}
Join Attempts: ${d["Join Attempts"]}`;
}

/* ================= CREATE ================= */

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
Duration: 60 Days
Appealable: YES
Start Date: ${phNow()}
Due Date: ${phNow()}
Join Attempts: 0`,
      start: isoNow(),
      due: isoPlus60()
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await refreshCache();
  return card.data.id;
}

/* ================= BAN ================= */

app.post("/ban", async (req, res) => {

  const { userId, username, type } = req.body;
  if (!userId || !username || !type)
    return res.status(400).json({ error: "Missing data" });

  const cardId = await getOrCreateCard(userId, username);

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  const existing = parseDesc(card.data.desc);
  const reason = existing.Reason || "Not Specified";

  let updated = {
    Profile: existing.Profile || `https://www.roblox.com/users/${userId}/profile`,
    Reason: reason,
    "Join Attempts": existing["Join Attempts"] || 0
  };

  if (type === "perm" || reason.toUpperCase() === "EXPLOITING") {

    updated.Duration = "PERMANENT";
    updated.Appealable = "NO";
    updated["Start Date"] = `Permanently banned on ${phNow()}`;
    updated["Due Date"] = "N/A";

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      {
        idList: BANNED_LIST_ID,
        desc: buildDesc(updated),
        start: null,
        due: null
      },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

  } else {

    updated.Duration = "60 Days";
    updated.Appealable = "YES";
    updated["Start Date"] = phNow();
    updated["Due Date"] = phNow();

    await axios.put(
      `https://api.trello.com/1/cards/${cardId}`,
      {
        idList: TEMP_BANNED_LIST_ID,
        desc: buildDesc(updated),
        start: isoNow(),
        due: isoPlus60()
      },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );
  }

  await refreshCache();
  res.json({ success: true });
});

/* ================= CHECK BAN ================= */

app.get("/checkban", async (req, res) => {

  const { userId } = req.query;
  if (!banCache.has(userId))
    return res.json({ banned: false });

  const { cardId } = banCache.get(userId);

  const card = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  if (card.data.closed === true)
    return res.json({ banned: false });

  if (card.data.idList === RESOLVED_LIST_ID)
    return res.json({ banned: false });

  /* AUTO EXPIRE TEMP BAN */

  if (card.data.idList === TEMP_BANNED_LIST_ID && card.data.due) {
    const due = new Date(card.data.due);
    if (new Date() > due) {
      await axios.put(
        `https://api.trello.com/1/cards/${cardId}`,
        { idList: RESOLVED_LIST_ID, start: null, due: null },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
      );
      await refreshCache();
      return res.json({ banned: false });
    }
  }

  const data = parseDesc(card.data.desc);

  const attempts = parseInt(data["Join Attempts"] || "0") + 1;
  data["Join Attempts"] = attempts;

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: buildDesc(data) },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await axios.post(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    { text: `Attempted to join: ${phNow()}` },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  return res.json({
    banned: true,
    reason: data.Reason
  });
});

/* ================= RESOLVE ================= */

app.post("/resolve", async (req, res) => {

  const { userId } = req.body;
  if (!banCache.has(userId))
    return res.status(404).json({ error: "Not found" });

  const { cardId } = banCache.get(userId);

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { idList: RESOLVED_LIST_ID, start: null, due: null },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await refreshCache();
  res.json({ success: true });
});

app.listen(process.env.PORT || 3000, async () => {
  await refreshCache();
  console.log("NOX System Running");
});