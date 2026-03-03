const BACKEND = "https://roblox-ban-backend.onrender.com";

function toggleTheme() {
    document.body.classList.toggle("light");
}

async function searchUser() {
    const container = document.getElementById("container");
    container.classList.add("animate-out");

    setTimeout(async () => {
        container.classList.remove("animate-out");

        const input = document.getElementById("searchInput").value.trim();
        if (!input) return;

        const resultDiv = document.getElementById("result");
        resultDiv.classList.remove("hidden");
        resultDiv.innerHTML = `<div class="spinner"></div>`;

        try {
            const response = await fetch(`${BACKEND}/search?userId=${input}`);
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

    }, 200);
}

/* PARTICLE ENGINE */
const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let particles = [];

for (let i = 0; i < 80; i++) {
    particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2,
        dx: (Math.random() - 0.5) * 0.5,
        dy: (Math.random() - 0.5) * 0.5
    });
}

function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(59,130,246,0.5)";
    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;

        if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
    });

    requestAnimationFrame(animateParticles);
}

animateParticles();