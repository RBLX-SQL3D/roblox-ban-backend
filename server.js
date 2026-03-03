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
/* DISCORD */
/* ========================= */

async function logToDiscord(title, description, color = 15158332) {
  if (!DISCORD_WEBHOOK) return;

  await axios.post(DISCORD_WEBHOOK, {
    embeds: [
      {
        title,
        description,
        color,
        timestamp: new Date().toISOString()
      }
    ]
  }).catch(() => {});
}

/* ========================= */
/* CACHE */
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
/* APPLY BAN */
/* ========================= */

async function applyBan(cardId, data) {

  const reasonUpper = data.reason.toUpperCase().trim();

  let start = null;
  let due = null;
  let listId = BANNED_LIST_ID;

  // POLICY RULE
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
}

/* ========================= */
/* CREATE / UPDATE BAN */
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

      const newCard = await axios.post(
        "https://api.trello.com/1/cards",
        {
          name: `${userId} | ${username}`,
          idList: BANNED_LIST_ID,
          desc: ""
        },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
      );

      cardId = newCard.data.id;
    }

    const profileLink = `https://www.roblox.com/users/${userId}/profile`;

    const banData = {
      profile: profileLink,
      reason: type === "perm" ? "EXPLOITING" : "Rule Violation",
      duration: "",
      appealable: "",
      attempts: 0
    };

    await applyBan(cardId, banData);

    await logToDiscord(
      "🔨 Ban Issued",
      `User: ${username}\nType: ${type}`
    );

    res.json({ success: true });

  } catch (err) {
    console.log(err.message);
    res.status(500).json({ error: "Ban failed" });
  }
});

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
  const parsed = parseDescription(cardRes.data.desc);

  if (due && new Date() > new Date(due)) {

    await axios.put(
      `https://api.trello.com/1/cards/${record.cardId}`,
      { idList: RESOLVED_LIST_ID },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await refreshBanCache();

    return res.json({ permanent: false });
  }

  return res.json({
    permanent: parsed.duration === "PERMANENT"
  });
});

/* ========================= */
/* WEBHOOK */
/* ========================= */

app.post("/webhook", async (req, res) => {
  await refreshBanCache();
  res.sendStatus(200);
});

/* ========================= */
/* START */
/* ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("Server running...");
  await refreshBanCache();
});