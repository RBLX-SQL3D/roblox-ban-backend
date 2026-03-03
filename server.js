const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

/* ========================= */
/* ENV VARIABLES */
/* ========================= */

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  BANNED_LIST_ID,
  TEMP_BANNED_LIST_ID,
  RESOLVED_LIST_ID,
  DISCORD_WEBHOOK
} = process.env;

if (!TRELLO_KEY || !TRELLO_TOKEN) {
  console.log("Missing Trello credentials.");
}

let banCache = new Map();

/* ========================= */
/* UTILITIES */
/* ========================= */

function phTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

function extractField(desc, key) {
  const regex = new RegExp(`${key}:\\s*(.*)`, "gi");
  let match;
  let value = "";

  while ((match = regex.exec(desc)) !== null) {
    value = match[1].trim();
  }

  return value;
}

function parseDescription(desc) {
  return {
    profile: extractField(desc, "Profile"),
    reason: extractField(desc, "Reason") || "Not specified",
    duration: extractField(desc, "Duration") || "PERMANENT",
    appealable: extractField(desc, "Appealable") || "NO",
    attempts: parseInt(extractField(desc, "Join Attempts") || "0")
  };
}

function buildDescription(data) {
  return [
    `Profile: ${data.profile}`,
    `Reason: ${data.reason}`,
    `Duration: ${data.duration}`,
    `Appealable: ${data.appealable}`,
    `Join Attempts: ${data.attempts}`
  ].join("\n");
}

/* ========================= */
/* DISCORD LOGGER */
/* ========================= */

async function logToDiscord(title, description, color = 15158332) {
  if (!DISCORD_WEBHOOK) return;

  try {
    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title,
          description,
          color,
          timestamp: new Date().toISOString()
        }
      ]
    });
  } catch (err) {
    console.log("Discord error:", err.message);
  }
}

/* ========================= */
/* REFRESH CACHE */
/* ========================= */

async function refreshBanCache() {

  banCache.clear();

  const lists = [BANNED_LIST_ID, TEMP_BANNED_LIST_ID];

  for (const listId of lists) {
    if (!listId) continue;

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

  console.log("Ban cache loaded:", banCache.size);
}

/* ========================= */
/* APPLY / UPDATE BAN */
/* ========================= */

async function applyBan(cardId, data) {

  const reasonUpper = data.reason.toUpperCase().trim();

  let start = null;
  let due = null;
  let listId = BANNED_LIST_ID;

  // POLICY:
  // If NOT EXPLOITING → 60 DAYS TEMP
  if (!reasonUpper.includes("EXPLOIT")) {

    const startDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(startDate.getDate() + 60);

    start = startDate.toISOString();
    due = dueDate.toISOString();

    data.duration = "60 Days";
    data.appealable = "YES";
    listId = TEMP_BANNED_LIST_ID;

  } else {

    data.duration = "PERMANENT";
    data.appealable = "NO";
    listId = BANNED_LIST_ID;

  }

  const updatedDesc = buildDescription(data);

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    {
      desc: updatedDesc,
      idList: listId,
      start: start,
      due: due
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await refreshBanCache();

  await logToDiscord(
    "🔨 Ban Applied/Updated",
    `Card ID: ${cardId}\nReason: ${data.reason}\nDuration: ${data.duration}`
  );
}

/* ========================= */
/* INCREMENT JOIN ATTEMPT */
/* ========================= */

async function incrementJoinAttempt(userId, cardId) {

  const cardRes = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  const parsed = parseDescription(cardRes.data.desc);
  parsed.attempts += 1;

  const updatedDesc = buildDescription(parsed);

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: updatedDesc },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await axios.post(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    {
      text: `Attempted to join\nTime (PH): ${phTime()}\nProfile: https://www.roblox.com/users/${userId}/profile`
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await logToDiscord(
    "🚨 Join Attempt",
    `User ID: ${userId}\nAttempts: ${parsed.attempts}`,
    16753920
  );
}

/* ========================= */
/* CHECK BAN */
/* ========================= */

app.get("/checkban", async (req, res) => {

  const { userId } = req.query;
  if (!userId) return res.json({ permanent: false });

  const record = banCache.get(userId);
  if (!record) return res.json({ permanent: false });

  try {

    const cardRes = await axios.get(
      `https://api.trello.com/1/cards/${record.cardId}`,
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    const due = cardRes.data.due;
    const parsed = parseDescription(cardRes.data.desc);

    // AUTO EXPIRE TEMP BAN
    if (due && new Date() > new Date(due)) {

      await axios.put(
        `https://api.trello.com/1/cards/${record.cardId}`,
        { idList: RESOLVED_LIST_ID },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
      );

      await refreshBanCache();

      await logToDiscord("✅ Ban Expired", `User ID: ${userId}`);

      return res.json({ permanent: false });
    }

    await incrementJoinAttempt(userId, record.cardId);

    return res.json({
      permanent: parsed.duration === "PERMANENT"
    });

  } catch (err) {
    console.log("Checkban error:", err.message);
    return res.json({ permanent: false });
  }
});

/* ========================= */
/* TRELLO WEBHOOK */
/* ========================= */

app.head("/webhook", (req, res) => res.sendStatus(200));
app.get("/webhook", (req, res) => res.sendStatus(200));

app.post("/webhook", async (req, res) => {
  await refreshBanCache();
  res.sendStatus(200);
});

/* ========================= */
/* START SERVER */
/* ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("Server running on port", PORT);

  try {
    await refreshBanCache();
  } catch (err) {
    console.log("Startup cache error:", err.message);
  }
});