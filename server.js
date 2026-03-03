const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BANNED_LIST_ID = process.env.BANNED_LIST_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

let banCache = new Map();

/* =========================================
   Philippine Time
========================================= */
function getPHTime() {
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(new Date());
}

/* =========================================
   Roblox Avatar
========================================= */
async function getRobloxAvatar(userId) {
    try {
        const response = await axios.get(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot",
            {
                params: {
                    userIds: userId,
                    size: "150x150",
                    format: "Png",
                    isCircular: false
                }
            }
        );
        return response.data.data[0]?.imageUrl || null;
    } catch {
        return null;
    }
}

/* =========================================
   Refresh Ban Cache
========================================= */
async function refreshBanCache() {
    const response = await axios.get(
        `https://api.trello.com/1/lists/${BANNED_LIST_ID}/cards`,
        {
            params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
        }
    );

    banCache.clear();

    for (const card of response.data) {
        const userId = card.name.split("|")[0].trim();
        banCache.set(userId, card);
    }

    console.log("Ban cache refreshed:", banCache.size);
}

/* =========================================
   Discord Embed Logging
========================================= */
async function logToDiscord(title, fields, color = 16711680) {
    if (!DISCORD_WEBHOOK) return;

    await axios.post(DISCORD_WEBHOOK, {
        embeds: [
            {
                title,
                color,
                fields,
                timestamp: new Date().toISOString(),
                footer: { text: "Roblox Ban System • Asia/Manila" }
            }
        ]
    });
}

/* =========================================
   Trello Webhook
========================================= */
app.get("/webhook", (req, res) => {
    res.status(200).send("Webhook ready");
});

app.head("/webhook", (req, res) => {
    res.sendStatus(200);
});

app.post("/webhook", async (req, res) => {
    await refreshBanCache();
    res.sendStatus(200);
});

/* =========================================
   LINK ALT ACCOUNT (AUTO-PERSIST)
========================================= */
app.post("/logalt", async (req, res) => {
    const { mainUserId, altUserId, altUsername } = req.body;

    const card = banCache.get(mainUserId);
    if (!card) return res.sendStatus(404);

    const avatar = await getRobloxAvatar(altUserId);
    const time = getPHTime();

    const altEntry = `
ALT LINKED:
Username: ${altUsername}
UserId: ${altUserId}
Time (PH): ${time}
Avatar: ${avatar}
`;

    const updatedDesc = (card.desc || "") + "\n\n" + altEntry;

    await axios.put(
        `https://api.trello.com/1/cards/${card.id}`,
        { desc: updatedDesc },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await logToDiscord(
        "⚠️ ALT ACCOUNT LINKED",
        [
            { name: "Main User ID", value: mainUserId, inline: true },
            { name: "Alt Username", value: altUsername, inline: true },
            { name: "Alt User ID", value: altUserId, inline: true },
            { name: "Time (PH)", value: time, inline: false }
        ],
        16753920
    );

    await refreshBanCache();

    res.sendStatus(200);
});

/* =========================================
   CHECK BAN (AUTO ALT DETECTION)
========================================= */
app.get("/checkban", async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ permanent: false });

    // Direct ban
    if (banCache.has(userId)) {
        return res.json({ permanent: true });
    }

    // Check alt detection from Trello descriptions
    for (const [mainId, card] of banCache.entries()) {
        if (!card.desc) continue;

        if (card.desc.includes(`UserId: ${userId}`)) {
            return res.json({ permanent: true });
        }
    }

    res.json({ permanent: false });
});

/* =========================================
   Start Server
========================================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server running on port", PORT);
    await refreshBanCache();
});