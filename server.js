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

function phTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/* ========================= */
/* DISCORD */
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
/* DESCRIPTION PARSE */
/* ========================= */

function parseDescription(desc) {
  const get = (key) => {
    const match = desc.match(new RegExp(`${key}:\\s*(.*)`));
    return match ? match[1].trim() : "";
  };

  return {
    profile: get("Profile"),
    reason: get("Reason"),
    duration: get("Duration"),
    startDate: get("Start Date"),
    dueDate: get("Due Date"),
    appealable: get("Appealable"),
    attempts: parseInt(get("Join Attempts") || "0")
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
/* CACHE REFRESH */
/* ========================= */

async function refreshBanCache() {
  if (!TRELLO_KEY || !TRELLO_TOKEN) return;

  const lists = [BANNED_LIST_ID, TEMP_BANNED_LIST_ID];
  banCache.clear();

  for (const listId of lists) {
    if (!listId) continue;

    const res = await axios.get(
      `https://api.trello.com/1/lists/${listId}/cards`,
      {
        params: {
          key: TRELLO_KEY,
          token: TRELLO_TOKEN
        }
      }
    );

    for (const card of res.data) {
      const match = card.name.match(/\d+/);
      if (!match) continue;

      const userId = match[0];

      banCache.set(userId, {
        cardId: card.id
      });
    }
  }

  console.log("Cache loaded:", banCache.size);
}

/* ========================= */
/* INCREMENT ATTEMPT (FIXED) */
/* ========================= */

async function incrementJoinAttempt(userId, cardId) {
  // ALWAYS fetch fresh card
  const cardRes = await axios.get(
    `https://api.trello.com/1/cards/${cardId}`,
    {
      params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
    }
  );

  const parsed = parseDescription(cardRes.data.desc);

  parsed.attempts = (parsed.attempts || 0) + 1;

  const updatedDesc = buildDescription(parsed);

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { desc: updatedDesc },
    {
      params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
    }
  );

  await axios.post(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    {
      text: `Attempted to join\nTime (PH): ${phTime()}\nProfile: https://www.roblox.com/users/${userId}/profile`
    },
    {
      params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
    }
  );

  await logToDiscord(
    "🚨 Join Attempt",
    `User ID: ${userId}\nAttempts: ${parsed.attempts}`,
    16753920
  );

  console.log("Attempts updated:", parsed.attempts);
}

/* ========================= */
/* MOVE CARD */
/* ========================= */

async function moveCard(cardId, listId) {
  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    { idList: listId },
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

  try {
    const cardRes = await axios.get(
      `https://api.trello.com/1/cards/${record.cardId}`,
      {
        params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
      }
    );

    const due = cardRes.data.due;
    const parsed = parseDescription(cardRes.data.desc);

    // AUTO EXPIRE TEMP BAN
    if (due && new Date() > new Date(due)) {
      await moveCard(record.cardId, RESOLVED_LIST_ID);
      await refreshBanCache();

      await logToDiscord(
        "✅ Ban Expired",
        `User ID: ${userId}`
      );

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
/* WEBHOOK */
/* ========================= */

app.get("/webhook", (req, res) => res.sendStatus(200));
app.head("/webhook", (req, res) => res.sendStatus(200));

app.post("/webhook", async (req, res) => {
  await refreshBanCache();
  res.sendStatus(200);
});

/* ========================= */
/* DISCORD TEST */
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

  try {
    await refreshBanCache();
  } catch (err) {
    console.log("Startup warning:", err.message);
  }
});