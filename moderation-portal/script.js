const BACKEND = "https://roblox-ban-backend.onrender.com";

async function searchUser() {
    const input = document.getElementById("searchInput").value.trim();
    if (!input) return;

    const resultDiv = document.getElementById("result");
    resultDiv.classList.remove("hidden");
    resultDiv.innerHTML = "Searching...";

    try {
        let userId = input;

        // Convert username → userId if needed
        if (!/^\d+$/.test(input)) {
            const res = await fetch("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    usernames: [input],
                    excludeBannedUsers: false
                })
            });

            const userData = await res.json();

            if (!userData.data || !userData.data.length) {
                resultDiv.innerHTML = "User not found.";
                return;
            }

            userId = userData.data[0].id;
        }

        // Call backend
        const response = await fetch(`${BACKEND}/search?userId=${userId}`);

        if (!response.ok) {
            throw new Error("Backend error");
        }

        const data = await response.json();

        if (!data.found) {
            resultDiv.innerHTML = "No moderation record found.";
            return;
        }

        const isPermanent = data.duration.toLowerCase().includes("permanent");

        resultDiv.innerHTML = `
            <div class="card">
                <img class="avatar" src="${data.avatar}" alt="Avatar">
                <h2>${data.username}</h2>

                <div class="status ${isPermanent ? "permanent" : "temporary"}">
                    ${isPermanent ? "Permanent Ban" : data.duration}
                </div>

                <div class="details">
                    <p><strong>Reason:</strong> ${data.reason}</p>
                    <p><strong>Duration:</strong> ${data.duration}</p>
                    <p><strong>Appealable:</strong> ${data.appealable}</p>
                    <p><strong>Join Attempts:</strong> ${data.attempts}</p>
                </div>

                <a class="profile-link" href="${data.profile}" target="_blank">
                    View Roblox Profile
                </a>
            </div>
        `;

    } catch (error) {
        console.error(error);
        resultDiv.innerHTML = "Error retrieving record.";
    }
}