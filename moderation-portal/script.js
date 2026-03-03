const BACKEND = "https://roblox-ban-backend.onrender.com";

async function searchUser() {
    const input = document.getElementById("searchInput").value.trim();
    if (!input) return;

    const resultDiv = document.getElementById("result");
    resultDiv.classList.remove("hidden");
    resultDiv.innerHTML = `<div class="spinner"></div>`;

    try {
        const response = await fetch(
            `${BACKEND}/search?username=${encodeURIComponent(input)}`
        );

        if (!response.ok) {
            throw new Error("Backend error");
        }

        const data = await response.json();

        console.log("Backend response:", data); // Debug

        if (!data.found) {
            resultDiv.innerHTML = "No moderation record found.";
            return;
        }

        const isPermanent =
            data.duration &&
            data.duration.toLowerCase() === "permanent";

        resultDiv.innerHTML = `
            <div class="card ${isPermanent ? "permanent" : "temporary"}">
                <img class="avatar" src="${data.avatar}" />
                <h2>${data.username}</h2>

                <div class="status ${isPermanent ? "permanent" : "temporary"}">
                    ${isPermanent ? "Permanent Ban" : data.duration}
                </div>

                <p><strong>Reason:</strong> ${data.reason}</p>
                <p><strong>Appealable:</strong> ${data.appealable}</p>
                <p><strong>Join Attempts:</strong> ${data.attempts}</p>

                <a class="profile-link" href="${data.profile}" target="_blank">
                    View Roblox Profile
                </a>
            </div>
        `;

    } catch (err) {
        console.error("Frontend error:", err);
        resultDiv.innerHTML = "Error retrieving record.";
    }
}