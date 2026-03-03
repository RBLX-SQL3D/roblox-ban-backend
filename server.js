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
    DISCORD_WEBHOOK,
    ROBLOX_API_KEY,
    ROBLOX_UNIVERSE_ID
} = process.env;

/* ========================= */
/* CACHES */
/* ========================= */

let banCache = new Map();
let userCache = new Map();        // userId → response
let usernameCache = new Map();    // username → userId

/* ========================= */
/* UTILITIES */
/* ========================= */

function getPHTime() {
    return new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila"
    });
}

/* ========================= */
/* TRELL0 CACHE */
/* ========================= */

async function refreshBanCache() {
    try {
        const response = await axios.get(
            `https://api.trello.com/1/lists/${BANNED_LIST_ID}/cards`,
            {
                params: { key: TRELLO_KEY, token: TRELLO_TOKEN }
            }
        );

        banCache.clear();

        for (const card of response.data) {
            const match = card.name.match(/\d+/);
            if (!match) continue;

            const userId = String(match[0]);

            banCache.set(userId, {
                cardId: card.id,
                description: card.desc
            });
        }

        console.log("Ban cache refreshed:", banCache.size);
    } catch (err) {
        console.log("Trello refresh failed:", err.message);
    }
}

/* ========================= */
/* SEARCH */
/* ========================= */

app.get("/search", async (req, res) => {
    let { userId, username } = req.query;

    try {
        // ID direct search
        if (!userId && username) {
            if (usernameCache.has(username.toLowerCase())) {
                userId = usernameCache.get(username.toLowerCase());
            } else {
                const robloxRes = await axios.post(
                    "https://users.roblox.com/v1/usernames/users",
                    {
                        usernames: [username],
                        excludeBannedUsers: false
                    },
                    { headers: { "Content-Type": "application/json" } }
                );

                if (!robloxRes.data.data.length) {
                    return res.json({ found: false });
                }

                userId = String(robloxRes.data.data[0].id);
                usernameCache.set(username.toLowerCase(), userId);
            }
        }

        if (!userId) return res.json({ found: false });

        userId = String(userId);

        if (userCache.has(userId)) {
            return res.json(userCache.get(userId));
        }

        const record = banCache.get(userId);
        if (!record) return res.json({ found: false });

        // PARALLEL ROBLOX CALLS
        const [userRes, avatarRes] = await Promise.all([
            axios.get(`https://users.roblox.com/v1/users/${userId}`),
            axios.get(
                "https://thumbnails.roblox.com/v1/users/avatar-headshot",
                {
                    params: {
                        userIds: userId,
                        size: "150x150",
                        format: "Png",
                        isCircular: false
                    }
                }
            )
        ]);

        const avatar = avatarRes.data.data[0]?.imageUrl;

        const responseData = {
            found: true,
            username: userRes.data.name,
            avatar,
            profile: `https://www.roblox.com/users/${userId}/profile`,
            reason: extractReason(record.description),
            duration: extractDuration(record.description),
            appealable: extractAppealable(record.description),
            attempts: extractAttempts(record.description)
        };

        userCache.set(userId, responseData);

        return res.json(responseData);

    } catch (err) {
        console.log("Search error:", err.message);
        res.status(500).json({ found: false });
    }
});

/* ========================= */
/* CHECKBAN */
/* ========================= */

app.get("/checkban", async (req, res) => {
    let { userId, mainId } = req.query;
    if (!userId) return res.json({ permanent: false });

    userId = String(userId);

    const record = banCache.get(userId);

    if (record) {
        logJoinAttempt(userId, record.cardId, "MAIN");
        return res.json({ permanent: true });
    }

    if (mainId && banCache.has(String(mainId))) {
        const mainRecord = banCache.get(String(mainId));
        logJoinAttempt(userId, mainRecord.cardId, "ALT");
        autoBanAlt(userId);
        return res.json({ permanent: true });
    }

    res.json({ permanent: false });
});

/* ========================= */
/* JOIN LOG */
/* ========================= */

async function logJoinAttempt(userId, cardId, type) {
    const timestamp = getPHTime();

    const comment = `
Attempted to join (${type})
Time (PH): ${timestamp}
Profile: https://www.roblox.com/users/${userId}/profile
`;

    try {
        await axios.post(
            `https://api.trello.com/1/cards/${cardId}/actions/comments`,
            { text: comment },
            { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
        );

        console.log("Join attempt logged");
    } catch (err) {
        console.log("Join log failed:", err.message);
    }
}

/* ========================= */
/* WEBHOOK FIX */
/* ========================= */

app.get("/webhook", (req, res) => {
    res.status(200).send("OK");
});

app.head("/webhook", (req, res) => {
    res.sendStatus(200);
});

app.post("/webhook", async (req, res) => {
    console.log("Webhook triggered");
    refreshBanCache(); // non-blocking
    res.sendStatus(200);
});

/* ========================= */
/* ALT BAN */
/* ========================= */

async function autoBanAlt(userId) {
    if (!ROBLOX_API_KEY || !ROBLOX_UNIVERSE_ID) return;

    try {
        await axios.post(
            `https://apis.roblox.com/cloud/v2/universes/${ROBLOX_UNIVERSE_ID}/bans`,
            {
                userId: Number(userId),
                duration: "P9999D",
                reason: "Linked to banned account"
            },
            { headers: { "x-api-key": ROBLOX_API_KEY } }
        );

        console.log("Alt auto-banned");
    } catch (err) {
        console.log("Alt ban failed:", err.message);
    }
}

/* ========================= */
/* DESCRIPTION PARSERS */
/* ========================= */

function extractReason(desc) {
    const m = desc.match(/Reason:\s*(.*)/);
    return m ? m[1] : "Not specified";
}

function extractDuration(desc) {
    const m = desc.match(/Duration:\s*(.*)/);
    return m ? m[1] : "Permanent";
}

function extractAppealable(desc) {
    const m = desc.match(/Appealable:\s*(.*)/);
    return m ? m[1] : "No";
}

function extractAttempts(desc) {
    const m = desc.match(/Join Attempts:\s*(\d+)/);
    return m ? parseInt(m[1]) : 0;
}

/* ========================= */
/* START */
/* ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server running");
    await refreshBanCache();
});