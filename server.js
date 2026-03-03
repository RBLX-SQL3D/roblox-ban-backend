const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BANNED_LIST_ID = process.env.BANNED_LIST_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

let banCache = new Map();

/* ==============================
   Philippine Time
============================== */
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

/* ==============================
   Roblox User + Avatar
============================== */
async function getRobloxUser(userId) {
    try {
        const userRes = await axios.get(
            `https://users.roblox.com/v1/users/${userId}`
        );

        const avatarRes = await axios.get(
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

        return {
            username: userRes.data.name,
            avatar: avatarRes.data.data[0]?.imageUrl || null,
            profile: `https://www.roblox.com/users/${userId}/profile`
        };
    } catch {
        return null;
    }
}

/* ==============================
   Discord Logging
============================== */
async function logToDiscord(title, fields, color = 16711680) {
    if (!DISCORD_WEBHOOK) return;

    await axios.post(DISCORD_WEBHOOK, {
        embeds: [{
            title,
            color,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: "Moderation System • Asia/Manila" }
        }]
    });
}

/* ==============================
   Set Avatar as Trello Cover
============================== */
async function setCardCover(cardId, avatarUrl) {
    try {
        const attach = await axios.post(
            `https://api.trello.com/1/cards/${cardId}/attachments`,
            { url: avatarUrl },
            { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
        );

        await axios.put(
            `https://api.trello.com/1/cards/${cardId}`,
            { idAttachmentCover: attach.data.id },
            { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
        );
    } catch {}
}

/* ==============================
   Refresh Ban Cache
============================== */
async function refreshBanCache() {
    const res = await axios.get(
        `https://api.trello.com/1/lists/${BANNED_LIST_ID}/cards`,
        { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
    );

    banCache.clear();

    for (const card of res.data) {
        const userId = card.name.split("|")[0].trim();
        banCache.set(userId, card);

        if (!card.idAttachmentCover) {
            const user = await getRobloxUser(userId);
            if (user?.avatar) {
                await setCardCover(card.id, user.avatar);
            }
        }
    }

    console.log("Cache refreshed:", banCache.size);
}

/* ==============================
   Join Attempt Counter
============================== */
function incrementAttempts(desc) {
    const match = desc?.match(/Join Attempts:\s*(\d+)/);
    let count = match ? parseInt(match[1]) : 0;

    count++;
    const cleaned = (desc || "").replace(/Join Attempts:\s*\d+/, "");
    return {
        newDesc: cleaned + `\nJoin Attempts: ${count}`,
        count
    };
}

/* ==============================
   Webhook Routes
============================== */
app.get("/webhook", (req, res) => res.send("Webhook ready"));
app.head("/webhook", (req, res) => res.sendStatus(200));
app.post("/webhook", async (req, res) => {
    await refreshBanCache();
    res.sendStatus(200);
});

/* ==============================
   CHECK BAN (Roblox calls this)
============================== */
app.get("/checkban", async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ banned: false });

    let card = banCache.get(userId);

    // Alt detection from description
    if (!card) {
        for (const [, c] of banCache.entries()) {
            if (c.desc?.includes(`UserId: ${userId}`)) {
                card = c;
                break;
            }
        }
    }

    if (card) {
        const updated = incrementAttempts(card.desc);

        await axios.put(
            `https://api.trello.com/1/cards/${card.id}`,
            { desc: updated.newDesc },
            { params: { key: TRELLO_KEY, token: TRELLO_TOKEN } }
        );

        await logToDiscord(
            "🚫 BANNED USER JOIN ATTEMPT",
            [
                { name: "User ID", value: userId, inline: true },
                { name: "Attempts", value: String(updated.count), inline: true },
                { name: "Time (PH)", value: getPHTime(), inline: false }
            ]
        );

        return res.json({ banned: true });
    }

    res.json({ banned: false });
});

/* ==============================
   PUBLIC SEARCH API
============================== */
app.get("/search", async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ found: false });

    const card = banCache.get(userId);
    if (!card) return res.json({ found: false });

    const user = await getRobloxUser(userId);

    const reason = card.desc?.match(/Reason:\s*(.*)/)?.[1] || "Not specified";
    const duration = card.desc?.match(/Duration:\s*(.*)/)?.[1] || "Permanent";
    const appealable = card.desc?.match(/Appealable:\s*(.*)/)?.[1] || "No";
    const attempts = card.desc?.match(/Join Attempts:\s*(\d+)/)?.[1] || "0";

    res.json({
        found: true,
        username: user?.username,
        avatar: user?.avatar,
        profile: user?.profile,
        reason,
        duration,
        appealable,
        attempts
    });
});

/* ==============================
   Start Server
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server running on port", PORT);
    await refreshBanCache();
});