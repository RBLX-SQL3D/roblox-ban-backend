const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

/* ========================= */
/* ENV CONFIG */
/* ========================= */

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  BANNED_LIST_ID,
  TEMP_BANNED_LIST_ID,
  RESOLVED_LIST_ID,
  DISCORD_WEBHOOK
} = process.env;

/* ========================= */
/* CACHE */
/* ========================= */

let banCache = new Map();

/* ========================= */
/* UTILITIES */
/* ========================= */

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function phTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
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
/* DESCRIPTION PARSER */
/* ========================= */

function parseDescription(desc) {
  const get = (key) => {
    const m = desc.match(new RegExp(`${key}:\\s*(.*)`));
    return m ? m[1].trim() : "";
  };

  return {
    profile: get("Profile"),
    reason: get("Reason"),
    duration: get("Duration"),
    startDate: get("Start Date"),
    dueDate: get("Due Date"),
    appealable: get("Appealable"),
    attempts: parseInt(get("Join Attempts") || 0)
  };
}

function buildDescription(data) {
  return `
Profile: ${data.profile}
Reason: ${data.reason}
Duration: ${data.duration}
Start Date: ${data.startDate}
Due Date: ${data.dueDate}
Appealable: ${data.appealable}
Join Attempts: ${data.attempts}
`.trim();
}

/* ========================= */
/* REFRESH CACHE */
/* ========================= */

async function refreshBanCache() {
  const lists = [BANNED_LIST_ID, TEMP_BANNED_LIST_ID];

  banCache.clear();

  for (const listId of lists) {
    const res = await axios.get(
      `https://api.trello.com/1/lists/${listId}/cards`,
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    for (const card of res.data) {
      const match = card.name.match(/\d+/);
      if (!match) continue;

      const userId = match[0];

      banCache.set(userId, {
        cardId: card.id,
        desc: card.desc,
        listId
      });
    }
  }

  console.log("Cache loaded:", banCache.size);
}

/* ========================= */
/* APPLY BAN LOGIC */
/* ========================= */

async function syncBanToTrello(cardId, data) {
  let startISO = null;
  let dueISO = null;
  let listId = BANNED_LIST_ID;

  if (data.appealable === "YES") {
    const startDate = new Date();
    const dueDate = addDays(60);

    startISO = startDate.toISOString();
    dueISO = dueDate;

    data.duration = "60 Days";
    data.startDate = startDate.toISOString().split("T")[0];
    data.dueDate = new Date(dueDate).toISOString().split("T")[0];

    listId = TEMP_BANNED_LIST_ID;
  } else {
    data.duration = "PERMANENT";
    data.startDate = todayISO();
    data.dueDate = "N/A";
  }

  const updatedDesc = buildDescription(data);

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    {
      desc: updatedDesc,
      idList: listId,
      start: startISO,
      due: dueISO
    },
    {
      params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
    }
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

  const cardRes = await axios.get(
    `https://api.trello.com/1/cards/${record.cardId}`,
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  const due = cardRes.data.due;

  // AUTO EXPIRE
  if (due && new Date() > new Date(due)) {
    await moveCard(record.cardId, RESOLVED_LIST_ID);
    banCache.delete(userId);

    await logToDiscord(
      "✅ Ban Expired",
      `User ID: ${userId}`
    );

    return res.json({ permanent: false });
  }

  await incrementJoinAttempt(userId, record);

  const parsed = parseDescription(record.desc);

  return res.json({
    permanent: parsed.duration === "PERMANENT"
  });
});

/* ========================= */
/* INCREMENT ATTEMPT */
/* ========================= */

async function incrementJoinAttempt(userId, record) {
  const parsed = parseDescription(record.desc);
  parsed.attempts++;

  const updatedDesc = buildDescription(parsed);

  await axios.put(
    `https://api.trello.com/1/cards/${record.cardId}`,
    { desc: updatedDesc },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );

  await axios.post(
    `https://api.trello.com/1/cards/${record.cardId}/actions/comments`,
    {
      text: `Attempted to join
Time (PH): ${phTime()}
Profile: https://www.roblox.com/users/${userId}/profile`
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
/* MOVE CARD */
/* ========================= */

async function moveCard(cardId, listId) {
  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { idList: listId },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );
}

/* ========================= */
/* WEBHOOK */
/* ========================= */

app.get("/webhook", (req, res) => res.sendStatus(200));
app.head("/webhook", (req, res) => res.sendStatus(200));

app.post("/webhook", async (req, res) => {
  await refreshBanCache();
  res.sendStatus(200);
});

/* ========================= */
/* TEST DISCORD */
/* ========================= */

app.get("/test-discord", async (req, res) => {
  await logToDiscord("🧪 Test", "Webhook working");
  res.send("Test sent");
});

/* ========================= */
/* START */
/* ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("Server running...");
  await refreshBanCache();
});