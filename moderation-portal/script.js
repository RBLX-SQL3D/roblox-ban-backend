const BACKEND = "https://roblox-ban-backend.onrender.com";

function toggleTheme() {
    document.body.classList.toggle("light");
}

async function searchUser() {
    const input = document.getElementById("searchInput").value.trim();
    if (!input) return;

    const resultDiv = document.getElementById("result");
    resultDiv.classList.remove("hidden");
    resultDiv.innerHTML = `<div class="spinner"></div>`;

    try {
        let userId = input;

        if (!/^\d+$/.test(input)) {
            const res = await fetch("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usernames: [input] })
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

        const isPermanent = data.duration.toLowerCase().includes("permanent");

        resultDiv.innerHTML = `
            <div class="card ${isPermanent ? "permanent" : "temporary"}">
                <img class="avatar" src="${data.avatar}">
                <h2>${data.username}</h2>
                <div class="status ${isPermanent ? "permanent" : "temporary"}">
                    ${data.duration}
                </div>
                <p><strong>Reason:</strong> ${data.reason}</p>
                <p><strong>Appealable:</strong> ${data.appealable}</p>
                <p><strong>Join Attempts:</strong> ${data.attempts}</p>
                <a class="profile-link" href="${data.profile}" target="_blank">
                    View Roblox Profile
                </a>
            </div>
        `;
    } catch {
        resultDiv.innerHTML = "Error retrieving record.";
    }
}