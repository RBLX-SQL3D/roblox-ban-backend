const BACKEND = "hhttps://roblox-ban-backend.onrender.com";

async function searchUser() {
    const input = document.getElementById("searchInput").value.trim();
    if (!input) return;

    const resultDiv = document.getElementById("result");
    resultDiv.classList.remove("hidden");
    resultDiv.innerHTML = "Searching...";

    try {
        let userId = input;

        // If username entered, convert to userId
        if (!/^\d+$/.test(input)) {
            const res = await fetch(`https://users.roblox.com/v1/usernames/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    usernames: [input],
                    excludeBannedUsers: false
                })
            });

            const data = await res.json();
            if (!data.data.length) {
                resultDiv.innerHTML = "User not found.";
                return;
            }

            userId = data.data[0].id;
        }

        const response = await fetch(`${BACKEND}/search?userId=${userId}`);
        const data = await response.json();

        if (!data.found) {
            resultDiv.innerHTML = "No moderation record found.";
            return;
        }

        const permanent = data.description?.toLowerCase().includes("permanent");

        resultDiv.innerHTML = `
            <img class="avatar" src="${data.avatar}" />
            <h2>${data.username}</h2>
            <p class="status ${permanent ? "permanent" : "temp"}">
                ${permanent ? "Permanent Ban" : "Temporary Ban"}
            </p>
            <p><strong>Reason:</strong> ${extractReason(data.description)}</p>
            <p><strong>Join Attempts:</strong> ${extractAttempts(data.description)}</p>
            <p><a class="link" href="${data.profile}" target="_blank">View Roblox Profile</a></p>
        `;

    } catch (err) {
        resultDiv.innerHTML = "Error retrieving record.";
    }
}

function extractReason(desc) {
    if (!desc) return "Not specified";
    const match = desc.match(/Reason:\s*(.*)/);
    return match ? match[1] : "Not specified";
}

function extractAttempts(desc) {
    if (!desc) return "0";
    const match = desc.match(/Join Attempts:\s*(\d+)/);
    return match ? match[1] : "0";
}