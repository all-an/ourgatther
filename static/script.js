function createConstructButtonIfNeeded() {
    // Check if it already exists
    if (document.getElementById("constructBtn")) return;

    const btn = document.createElement("button");
    btn.id = "constructBtn";
    btn.textContent = "Construct";
    btn.style.position = "absolute";
    btn.style.bottom = "20px";
    btn.style.left = "20px";
    btn.style.zIndex = "1000";
    btn.style.padding = "10px";
    btn.style.display = "none"; // initially hidden

    // Append to body or container
    document.body.appendChild(btn);
}

window.addEventListener("DOMContentLoaded", () => {
    createConstructButtonIfNeeded();
});

function updateUIBasedOnControl() {
    const btn = document.getElementById("constructBtn");
    if (!btn) return;

    btn.style.display = myId ? "block" : "none";
}

const sidebar = document.getElementById('sidebar');
const constructBtn = document.getElementById('constructBtn');

constructBtn.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
});

const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");

socket.onopen = () => {
    console.log("Connected to WebSocket");
    socket.send(JSON.stringify({ type: "get_players" }));
};

socket.onerror = (err) => {
    console.error("WebSocket error:", err);
};

let players = {};
let myId = null;

socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
        case "players":
        msg.data.forEach(drawPlayer);
        break;
        case "new_player":
        drawPlayer(msg.data);
        break;
        case "move":
            const c = players[msg.data.id];
            if (c) {
                c.style.left = msg.data.x + "px";
                c.style.top = msg.data.y + "px";
                if (msg.data.id === myId) {
                    scrollBackgroundTo(msg.data.x, msg.data.y);
                }
            }
            break;
        case "name_changed":
            const char = players[msg.data.id];
            if (char) {
                char.querySelector(".player-name").textContent = msg.data.name;
            }
            break;
        case "created":
            myId = msg.data.id;
            drawPlayer(msg.data);
            controlPlayer(myId);
            break;
    }
};

let cameraOffsetX = 0;
let cameraOffsetY = 0;

let targetCameraX = 0;
let targetCameraY = 0;

function scrollBackgroundTo(x, y) {
    const bg = document.getElementById('background');
    const game = document.getElementById('game');

    const maxOffsetX = 20000 - window.innerWidth;
    const maxOffsetY = 20000 - window.innerHeight;

    cameraOffsetX = Math.max(0, Math.min(x - window.innerWidth / 2, maxOffsetX));
    cameraOffsetY = Math.max(0, Math.min(y - window.innerHeight / 2, maxOffsetY));

    bg.style.backgroundPosition = `-${cameraOffsetX}px -${cameraOffsetY}px`;
    game.style.left = `-${cameraOffsetX}px`;
    game.style.top = `-${cameraOffsetY}px`;

    redrawCanvas();
}

function createPlayer() {
    updateUIBasedOnControl();
    const name = prompt("Choose a name:");
    if (name) {
        socket.send(JSON.stringify({ type: "create", data: { name } }));
    }
}

function drawPlayer(c) {
    if (players[c.id]) return;

    const div = document.createElement("div");
    div.className = "player";
    div.style.background = c.color;
    div.style.left = c.x + "px";
    div.style.top = c.y + "px";
    div.innerHTML = `
        <div class="player-name">${c.name}</div>
        <button class="player-btn" onclick="changeName(${c.id})">Change Name</button>
        <button class="player-btn" onclick="controlPlayer(${c.id})">Control</button>
    `;
    document.getElementById("game").appendChild(div);
    players[c.id] = div;
}

function changeName(id) {
    const name = prompt("New name?");
    if (name) {
        socket.send(JSON.stringify({ type: "change_name", data: { id, name } }));
    }
}

function controlPlayer(id) {
    myId = id;
    updateUIBasedOnControl();
    const div = players[id];
    const name = div?.querySelector('.player-name')?.textContent || 'Unknown';
    alert("You are now controlling: " + name);
}

window.addEventListener("keydown", (e) => {
    if (myId == null) return;
    const div = players[myId];
    if (!div) return;

    const x = parseInt(div.style.left);
    const y = parseInt(div.style.top);

    let newX = x, newY = y;
    if (e.key === "ArrowUp") newY -= 40;
    if (e.key === "ArrowDown") newY += 40;
    if (e.key === "ArrowLeft") newX -= 40;
    if (e.key === "ArrowRight") newX += 40;

    socket.send(JSON.stringify({ type: "move", data: { id: myId, x: newX, y: newY } }));
});

// Drawing setup
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let isDrawingActive = false;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

resizeCanvas();

window.addEventListener('resize', () => {
    resizeCanvas();
    redrawCanvas();
});

const startDrawBtn = document.getElementById('startDrawBtn');
const stopDrawBtn = document.getElementById('stopDrawBtn');

startDrawBtn.onclick = () => {
    isDrawingActive = true;
    drawing = false;
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'crosshair';
    startDrawBtn.style.display = 'none';
    stopDrawBtn.style.display = 'inline-block';
};


stopDrawBtn.onclick = () => {
    isDrawingActive = false;
    drawing = false;
    canvas.style.cursor = 'default';
    startDrawBtn.style.display = 'inline-block';
    stopDrawBtn.style.display = 'none';
};

canvas.addEventListener('mousedown', () => {
    if (!isDrawingActive) return;
    drawing = true;
});

canvas.addEventListener('mouseup', () => drawing = false);
canvas.addEventListener('mouseout', () => drawing = false);

const colorPicker = document.getElementById('colorPicker');
let currentColor = colorPicker.value;

colorPicker.addEventListener('input', () => {
    currentColor = colorPicker.value;
});

let drawingCache = [];

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawingActive || !drawing) return;
    console.log("Drawing at", e.clientX, e.clientY);

    const x = e.clientX + cameraOffsetX;
    const y = e.clientY + cameraOffsetY;

    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(e.clientX, e.clientY, 2, 0, Math.PI * 2);
    ctx.fill();

    drawingCache.push({ x, y, color: currentColor, size: 2 });

    redrawCanvas();


    fetch('/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, color: currentColor, size: 2, player_id: myId })
    });
});

async function loadDrawings() {
    const res = await fetch('/drawings');
    const data = await res.json();
    console.log("Drawings fetched:", data);
    drawingCache = Array.isArray(data) ? data : [];
    redrawCanvas();
}


function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingCache.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x - cameraOffsetX, p.y - cameraOffsetY, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
}

window.addEventListener('load', () => {
    resizeCanvas();
    loadDrawings();
    startDrawBtn.style.display = 'inline-block';
    stopDrawBtn.style.display = 'none';
    canvas.style.cursor = 'default';
    canvas.style.pointerEvents = 'auto';
});