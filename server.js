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
  DISCORD_WEBHOOK
} = process.env;

if (!TRELLO_KEY || !TRELLO_TOKEN || !BANNED_LIST_ID) {
  console.log("❌ Missing Trello environment variables.");
}

/* ========================= */
/* DISCORD LOGGER */
/* ========================= */

async function logToDiscord(title, description) {
  if (!DISCORD_WEBHOOK) return;

  try {
    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title,
          description,
          color: 15158332,
          timestamp: new Date().toISOString()
        }
      ]
    });
  } catch (err) {
    console.log("Discord error:", err.message);
  }
}

/* ========================= */
/* APPLY BAN LOGIC */
/* ========================= */

async function applyBan(cardId, reason, userId) {

  const reasonUpper = reason.toUpperCase().trim();

  let start = null;
  let due = null;
  let listId = BANNED_LIST_ID;
  let duration = "PERMANENT";
  let appealable = "NO";

  if (!reasonUpper.includes("EXPLOIT")) {

    const startDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(startDate.getDate() + 60);

    start = startDate.toISOString();
    due = dueDate.toISOString();

    listId = TEMP_BANNED_LIST_ID;
    duration = "60 Days";
    appealable = "YES";
  }

  const desc =
`Profile: https://www.roblox.com/users/${userId}/profile
Reason: ${reason}
Duration: ${duration}
Appealable: ${appealable}
Join Attempts: 0`;

  await axios.put(
    `https://api.trello.com/1/cards/${cardId}`,
    {
      desc,
      idList: listId,
      start,
      due
    },
    { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
  );
}

/* ========================= */
/* BAN ENDPOINT */
/* ========================= */

app.post("/ban", async (req, res) => {

  console.log("Ban request:", req.body);

  const { userId, username, type } = req.body;

  if (!userId || !username || !type) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {

    const reason = type === "perm" ? "EXPLOITING" : "Rule Violation";

    const newCard = await axios.post(
      "https://api.trello.com/1/cards",
      {
        name: `${userId} | ${username}`,
        idList: BANNED_LIST_ID,
        desc: ""
      },
      { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    const cardId = newCard.data.id;

    await applyBan(cardId, reason, userId);

    await logToDiscord(
      "🔨 Ban Issued",
      `User: ${username}\nType: ${type}`
    );

    res.json({ success: true });

  } catch (err) {
    console.log("❌ Ban error:", err.message);
    res.status(500).json({ error: "Ban failed" });
  }
});

/* ========================= */
/* START SERVER */
/* ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});