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
let playerPositions = {};

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
                if (!playerPositions[msg.data.id]) {
                    playerPositions[msg.data.id] = {
                        currentX: parseInt(c.style.left) || msg.data.x,
                        currentY: parseInt(c.style.top) || msg.data.y,
                        targetX: msg.data.x,
                        targetY: msg.data.y
                    };
                } else {
                    playerPositions[msg.data.id].targetX = msg.data.x;
                    playerPositions[msg.data.id].targetY = msg.data.y;
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
        case "player_deleted":
            removePlayer(msg.data.id);
            break;

    }
};

let cameraOffsetX = 0;
let cameraOffsetY = 0;

let targetCameraX = 0;
let targetCameraY = 0;

function scrollBackgroundTo(x, y) {
    const maxOffsetX = 10000 - window.innerWidth;
    const maxOffsetY = 10000 - window.innerHeight;

    targetCameraX = Math.max(0, Math.min(x - window.innerWidth / 2, maxOffsetX));
    targetCameraY = Math.max(0, Math.min(y - window.innerHeight / 2, maxOffsetY));
}

function updateCamera() {
    const bg = document.getElementById('background');
    const game = document.getElementById('game');
    
    const lerpFactor = 0.15;
    
    cameraOffsetX += (targetCameraX - cameraOffsetX) * lerpFactor;
    cameraOffsetY += (targetCameraY - cameraOffsetY) * lerpFactor;

    bg.style.backgroundPosition = `-${Math.round(cameraOffsetX)}px -${Math.round(cameraOffsetY)}px`;
    game.style.left = `-${Math.round(cameraOffsetX)}px`;
    game.style.top = `-${Math.round(cameraOffsetY)}px`;

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
        <div class="health-bar" id="health-${c.id}">
            <div class="health-fill"></div>
        </div>
        <button class="player-btn" onclick="changeName(${c.id})">Change Name</button>
        <button class="player-btn" onclick="controlPlayer(${c.id})">Control</button>
        <button class="player-btn" id="action-${c.id}" onclick="targetPlayer(${c.id})">Target</button>
    `;
    document.getElementById("game").appendChild(div);
    players[c.id] = div;

    playerPositions[c.id] = {
        currentX: c.x,
        currentY: c.y,
        targetX: c.x,
        targetY: c.y
    };

    if (!playerHealth[c.id]) playerHealth[c.id] = 100;
    updateHealthBar(c.id);
}

let targetId = null;
let playerHealth = {};

function targetPlayer(id) {
    if (myId === id) return; // can't target self

    debugger;
    if (targetId === id) {
        shootPlayer(id);
        return;
    }

    targetId = id;
    document.getElementById(`action-${id}`).textContent = "Shoot";
}

function shootPlayer(id) {
    if (!playerHealth[id]) return;
    spawnBullet(myId, id);
    targetId = null;
    document.getElementById(`action-${id}`).textContent = "Target";

    playerHealth[id] -= 10;
    if (playerHealth[id] <= 0) {
        playerHealth[id] = 0;
        //updateHealthBar(id);
        removePlayer(id);
        socket.send(JSON.stringify({ type: "delete_player", data: { id } }));
    } 

    
}

function removePlayer(id) {
    const el = players[id];
    if (el) el.remove();
    delete players[id];
    delete playerHealth[id];
    delete playerPositions[id];
}

function updateHealthBar(id) {
    const bar = document.getElementById(`health-${id}`)?.querySelector(".health-fill");
    if (bar) bar.style.width = `${playerHealth[id]}%`;
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

let keysPressed = {};
let moveSpeed = 8;
let lastMoveTime = 0;
let moveThrottleMs = 16; // ~60fps for smoother movement

window.addEventListener("keydown", (e) => {
    if (myId == null) return;
    keysPressed[e.key] = true;
});

window.addEventListener("keyup", (e) => {
    keysPressed[e.key] = false;
});

function handleMovement() {
    if (myId == null || !players[myId] || !playerPositions[myId]) return;

    const now = Date.now();
    if (now - lastMoveTime < moveThrottleMs) return;

    const pos = playerPositions[myId];
    let moved = false;
    const mapWidth = 10000;
    const mapHeight = 10000;
    const playerSize = 60;

    if (keysPressed["ArrowUp"] && pos.targetY > 0) {
        pos.targetY = Math.max(0, pos.targetY - moveSpeed);
        moved = true;
    }
    if (keysPressed["ArrowDown"] && pos.targetY < mapHeight - playerSize) {
        pos.targetY = Math.min(mapHeight - playerSize, pos.targetY + moveSpeed);
        moved = true;
    }
    if (keysPressed["ArrowLeft"] && pos.targetX > 0) {
        pos.targetX = Math.max(0, pos.targetX - moveSpeed);
        moved = true;
    }
    if (keysPressed["ArrowRight"] && pos.targetX < mapWidth - playerSize) {
        pos.targetX = Math.min(mapWidth - playerSize, pos.targetX + moveSpeed);
        moved = true;
    }

    if (moved) {
        lastMoveTime = now;
        socket.send(JSON.stringify({ 
            type: "move", 
            data: { id: myId, x: pos.targetX, y: pos.targetY } 
        }));
    }
}

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
    }).then(() => {
        // Immediately reflect drawing locally
        drawingCache.push({ x, y, color: currentColor, size: 2 });
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

function spawnBullet(fromId, toId) {
    const from = players[fromId];
    const to = players[toId];
    if (!from || !to) return;

    const bullet = document.createElement("div");
    bullet.className = "bullet";
    bullet.style.position = "absolute";
    bullet.style.left = parseInt(from.style.left) + 30 + "px";
    bullet.style.top = parseInt(from.style.top) + 30 + "px";

    document.getElementById("game").appendChild(bullet);

    let x = parseInt(bullet.style.left);
    let y = parseInt(bullet.style.top);

    const dx = parseInt(to.style.left) - x;
    const dy = parseInt(to.style.top) - y;
    const steps = 20;
    const stepX = dx / steps;
    const stepY = dy / steps;
    const interval = setInterval(() => {
        x += stepX;
        y += stepY;
        bullet.style.left = x + "px";
        bullet.style.top = y + "px";

        const target = players[toId];
        if (target) {
            const targetX = parseInt(target.style.left);
            const targetY = parseInt(target.style.top);
            const distToTarget = Math.hypot(targetX - x, targetY - y);
            if (distToTarget < 5) {
                applyDamage(toId); // <-- Moved damage here
                bullet.remove();
                clearInterval(interval);
                return;
            }
        }

    }, 20);
}
function applyDamage(id) {
    if (!playerHealth[id]) return;

    playerHealth[id] -= 10;
    if (playerHealth[id] <= 0) {
        playerHealth[id] = 0;
        updateHealthBar(id);
        removePlayer(id);
        socket.send(JSON.stringify({ type: "delete_player", data: { id } }));
    } else {
        updateHealthBar(id);
    }
}

function checkCollisionWithPlayer(player, x, y) {
    const px = parseInt(player.style.left);
    const py = parseInt(player.style.top);
    return Math.abs(px - x) < 20 && Math.abs(py - y) < 20;
}



function animatePlayer(id) {
    const div = players[id];
    const pos = playerPositions[id];
    if (!div || !pos) return;

    const lerpFactor = 0.15;
    
    pos.currentX += (pos.targetX - pos.currentX) * lerpFactor;
    pos.currentY += (pos.targetY - pos.currentY) * lerpFactor;

    div.style.left = Math.round(pos.currentX) + "px";
    div.style.top = Math.round(pos.currentY) + "px";
}

function gameLoop() {
    Object.keys(playerPositions).forEach(animatePlayer);
    handleMovement();
    
    // Update camera to follow controlled player
    if (myId && playerPositions[myId]) {
        const pos = playerPositions[myId];
        scrollBackgroundTo(pos.currentX, pos.currentY);
    }
    
    updateCamera();
    requestAnimationFrame(gameLoop);
}

window.addEventListener('load', () => {
    resizeCanvas();
    loadDrawings();
    startDrawBtn.style.display = 'inline-block';
    stopDrawBtn.style.display = 'none';
    canvas.style.cursor = 'default';
    canvas.style.pointerEvents = 'auto';
    gameLoop();
});

