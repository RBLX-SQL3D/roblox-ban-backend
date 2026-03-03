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
    DISCORD_WEBHOOK,
    ROBLOX_API_KEY,
    ROBLOX_UNIVERSE_ID
} = process.env;

/* ========================= */
/* CACHE */
/* ========================= */

let banCache = new Map();

/* ========================= */
/* UTILITIES */
/* ========================= */

function getPHTime() {
    return new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila"
    });
}

async function getRobloxUser(userId) {
    const res = await axios.get(
        `https://users.roblox.com/v1/users/${userId}`
    );
    return res.data;
}

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
        return response.data.data[0].imageUrl;
    } catch {
        return null;
    }
}

async function logToDiscord(message) {
    if (!DISCORD_WEBHOOK) return;
    await axios.post(DISCORD_WEBHOOK, { content: message });
}

/* ========================= */
/* TRELO CACHE SYNC */
/* ========================= */

async function refreshBanCache() {
    const response = await axios.get(
        `https://api.trello.com/1/lists/${BANNED_LIST_ID}/cards`,
        {
            params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
        }
    );

    banCache.clear();

    for (const card of response.data) {
        const userId = String(card.name.split("|")[0].trim());

        banCache.set(userId, {
            cardId: card.id,
            description: card.desc
        });
    }

    console.log("Ban cache refreshed:", banCache.size);
}

/* ========================= */
/* SEARCH (Website API) */
/* ========================= */

app.get("/search", async (req, res) => {
    let { userId, username } = req.query;

    try {
        /* Convert username → userId */
        if (!userId && username) {
            const usernameRes = await axios.post(
                "https://users.roblox.com/v1/usernames/users",
                {
                    usernames: [username],
                    excludeBannedUsers: false
                },
                {
                    headers: { "Content-Type": "application/json" }
                }
            );

            if (
                !usernameRes.data ||
                !usernameRes.data.data ||
                !usernameRes.data.data.length
            ) {
                return res.json({ found: false });
            }

            userId = String(usernameRes.data.data[0].id);
        }

        if (!userId) return res.json({ found: false });

        userId = String(userId);

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

    } catch (err) {
        console.log("Search error:", err.response?.data || err.message);
        res.status(500).json({ found: false });
    }
});

/* ========================= */
/* CHECK BAN + ALT AUTO BAN */
/* ========================= */

app.get("/checkban", async (req, res) => {
    let { userId, mainId } = req.query;

    if (!userId) return res.json({ permanent: false });

    userId = String(userId);

    const record = banCache.get(userId);

    /* MAIN banned */
    if (record) {
        await logJoinAttempt(userId, record.cardId, "MAIN");
        return res.json({ permanent: true });
    }

    /* ALT of banned main */
    if (mainId && banCache.has(String(mainId))) {
        const mainRecord = banCache.get(String(mainId));

        await logJoinAttempt(userId, mainRecord.cardId, "ALT");

        await autoBanAlt(userId);

        return res.json({ permanent: true });
    }

    return res.json({ permanent: false });
});

/* ========================= */
/* JOIN ATTEMPT LOGGING */
/* ========================= */

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

    await logToDiscord(
        `Join Attempt (${type})\nUserId: ${userId}\nTime: ${timestamp}`
    );
}

async function incrementAttemptCounter(cardId) {
    const card = await axios.get(
        `https://api.trello.com/1/cards/${cardId}`,
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    let desc = card.data.desc;
    let attempts = extractAttempts(desc) + 1;

    if (/Join Attempts:\s*\d+/.test(desc)) {
        desc = desc.replace(/Join Attempts:\s*\d+/, `Join Attempts: ${attempts}`);
    } else {
        desc += `\nJoin Attempts: ${attempts}`;
    }

    await axios.put(
        `https://api.trello.com/1/cards/${cardId}`,
        { desc },
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    /* Update cache */
    banCache.get(card.data.name.split("|")[0].trim()).description = desc;
}

/* ========================= */
/* AUTO BAN ALT */
/* ========================= */

async function autoBanAlt(userId) {
    if (!ROBLOX_API_KEY || !ROBLOX_UNIVERSE_ID) return;

    try {
        await axios.post(
            `https://apis.roblox.com/cloud/v2/universes/${ROBLOX_UNIVERSE_ID}/bans`,
            {
                userId: Number(userId),
                duration: "P9999D",
                reason: "Linked to permanently banned account"
            },
            {
                headers: {
                    "x-api-key": ROBLOX_API_KEY
                }
            }
        );

        console.log("Alt auto-banned:", userId);

    } catch (err) {
        console.log("Alt ban failed:", err.response?.data || err.message);
    }
}

/* ========================= */
/* DESCRIPTION PARSERS */
/* ========================= */

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

/* ========================= */
/* WEBHOOK */
/* ========================= */

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
    await refreshBanCache();
});