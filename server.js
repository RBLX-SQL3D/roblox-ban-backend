const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BANNED_LIST_ID = process.env.BANNED_LIST_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

let banCache = new Map();

function getPHTime() {
    return new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila"
    });
}

async function getRobloxAvatar(userId) {
    try {
        const response = await axios.get(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot`,
            {
                params: {
                    userIds: userId,
                    size: "150x150",
                    format: "Png",
                    isCircular: false
                }
            }
        );
        return response.data.data[0].imageUrl;
    } catch {
        return null;
    }
}

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
        banCache.set(userId, card.id);
    }

    console.log("Ban cache refreshed:", banCache.size);
}

async function logToDiscord(message) {
    if (!DISCORD_WEBHOOK) return;
    await axios.post(DISCORD_WEBHOOK, { content: message });
}

aapp.get("/webhook", (req, res) => {
    res.status(200).send("Webhook ready");
});

app.post("/webhook", async (req, res) => {
    await refreshBanCache();
    res.sendStatus(200);
});

app.post("/logalt", async (req, res) => {
    const { mainUserId, altUserId, altUsername } = req.body;

    const cardId = banCache.get(mainUserId);
    if (!cardId) return res.sendStatus(404);

    const avatar = await getRobloxAvatar(altUserId);
    const time = getPHTime();

    const comment = `
ALT DETECTED
Username: ${altUsername}
UserId: ${altUserId}
Time (PH): ${time}
Avatar: ${avatar}
`;

    await axios.post(
        `https://api.trello.com/1/cards/${cardId}/actions/comments`,
        { text: comment },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await logToDiscord(
        `ALT DETECTED\nMain: ${mainUserId}\nAlt: ${altUsername} (${altUserId})\nTime: ${time}`
    );

    res.sendStatus(200);
});

app.get("/checkban", async (req, res) => {
    const userId = req.query.userId;

    if (!userId) return res.json({ permanent: false });

    if (banCache.has(userId)) {
        await logToDiscord(
            `BANNED PLAYER ATTEMPTED JOIN\nUserId: ${userId}\nTime: ${getPHTime()}`
        );
        return res.json({ permanent: true });
    }

    res.json({ permanent: false });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server running on port", PORT);
    await refreshBanCache();
});