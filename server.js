const express = require("express");
const axios = require("axios");

const app = express();

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BANNED_LIST_ID = process.env.BANNED_LIST_ID;

let banCache = new Map();

async function refreshBanCache() {
    try {
        const response = await axios.get(
            `https://api.trello.com/1/lists/${BANNED_LIST_ID}/cards`,
            {
                params: {
                    key: TRELLO_KEY,
                    token: TRELLO_TOKEN
                }
            }
        );

        banCache.clear();

        for (const card of response.data) {
            const parts = card.name.split("|");
            const userId = parts[0].trim();
            banCache.set(userId, true);
        }

        console.log("Ban cache refreshed:", banCache.size, "users");
    } catch (err) {
        console.error("Failed to refresh ban cache:", err.message);
    }
}

// refresh every 60 seconds
setInterval(refreshBanCache, 60000);

app.get("/", (req, res) => {
    res.send("Backend is running.");
});

app.get("/checkban", (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
        return res.json({ permanent: false });
    }

    if (banCache.has(userId)) {
        return res.json({ permanent: true });
    }

    res.json({ permanent: false });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await refreshBanCache();
});