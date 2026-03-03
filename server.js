const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/* ============================= */
/* ENV VARIABLES */
/* ============================= */

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BANNED_LIST_ID = process.env.BANNED_LIST_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

/* ============================= */
/* CACHE */
/* ============================= */

let banCache = new Map();

/* ============================= */
/* UTILITIES */
/* ============================= */

function getPHTime() {
    return new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila"
    });
}

async function getRobloxUser(userId) {
    const res = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
    return res.data;
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

async function logToDiscord(message) {
    if (!DISCORD_WEBHOOK) return;
    await axios.post(DISCORD_WEBHOOK, { content: message });
}

/* ============================= */
/* TRELLO SYNC */
/* ============================= */

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
        banCache.set(userId, {
            cardId: card.id,
            description: card.desc
        });
    }

    console.log("Ban cache refreshed:", banCache.size);
}

/* ============================= */
/* SEARCH API (For Website) */
/* ============================= */

app.get("/search", async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ found: false });

    const record = banCache.get(userId);
    if (!record) return res.json({ found: false });

    const user = await getRobloxUser(userId);
    const avatar = await getRobloxAvatar(userId);

    return res.json({
        found: true,
        username: user.name,
        avatar,
        profile: `https://www.roblox.com/users/${userId}/profile`,
        reason: extractReason(record.description),
        duration: extractDuration(record.description),
        appealable: extractAppealable(record.description),
        attempts: extractAttempts(record.description)
    });
});

/* ============================= */
/* CHECK BAN + JOIN TRACKING */
/* ============================= */

app.get("/checkban", async (req, res) => {
    const userId = req.query.userId;
    const linkedMainId = req.query.mainId; // optional

    if (!userId) return res.json({ permanent: false });

    const record = banCache.get(userId);

    // If user is banned
    if (record) {
        await logJoinAttempt(userId, record.cardId, "MAIN");
        return res.json({ permanent: true });
    }

    // If alt linked to banned main
    if (linkedMainId && banCache.has(linkedMainId)) {
        const mainRecord = banCache.get(linkedMainId);

        await logJoinAttempt(userId, mainRecord.cardId, "ALT");

        // AUTO BAN ALT (Roblox API)
        await autoBanAlt(userId);

        return res.json({ permanent: true });
    }

    return res.json({ permanent: false });
});

/* ============================= */
/* JOIN ATTEMPT LOGGER */
/* ============================= */

async function logJoinAttempt(userId, cardId, type) {
    const timestamp = getPHTime();
    const profileLink = `https://www.roblox.com/users/${userId}/profile`;

    const comment = `
Attempted to join (${type})
Time (PH): ${timestamp}
Profile: ${profileLink}
`;

    await axios.post(
        `https://api.trello.com/1/cards/${cardId}/actions/comments`,
        { text: comment },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    await incrementAttemptCounter(cardId);
}

/* ============================= */
/* INCREMENT ATTEMPT COUNTER */
/* ============================= */

async function incrementAttemptCounter(cardId) {
    const card = await axios.get(
        `https://api.trello.com/1/cards/${cardId}`,
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    let desc = card.data.desc;
    let attempts = extractAttempts(desc);
    attempts++;

    desc = desc.replace(/Join Attempts:\s*\d+/, `Join Attempts: ${attempts}`);

    await axios.put(
        `https://api.trello.com/1/cards/${cardId}`,
        { desc },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );
}

/* ============================= */
/* AUTO BAN ALT */
/* ============================= */

async function autoBanAlt(userId) {
    try {
        await axios.post(
            `https://apis.roblox.com/cloud/v2/universes/YOUR_UNIVERSE_ID/bans`,
            {
                userId: userId,
                duration: "P9999D",
                reason: "Linked to permanently banned account"
            },
            {
                headers: {
                    "x-api-key": process.env.ROBLOX_API_KEY
                }
            }
        );
    } catch (err) {
        console.log("Alt auto-ban failed:", err.response?.data || err.message);
    }
}

/* ============================= */
/* DESCRIPTION PARSERS */
/* ============================= */

function extractReason(desc) {
    const match = desc.match(/Reason:\s*(.*)/);
    return match ? match[1] : "Not specified";
}

function extractDuration(desc) {
    const match = desc.match(/Duration:\s*(.*)/);
    return match ? match[1] : "Permanent";
}

function extractAppealable(desc) {
    const match = desc.match(/Appealable:\s*(.*)/);
    return match ? match[1] : "No";
}

function extractAttempts(desc) {
    const match = desc.match(/Join Attempts:\s*(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

/* ============================= */
/* WEBHOOK */
/* ============================= */

app.post("/webhook", async (req, res) => {
    await refreshBanCache();
    res.sendStatus(200);
});

/* ============================= */
/* SERVER START */
/* ============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server running on port", PORT);
    await refreshBanCache();
});