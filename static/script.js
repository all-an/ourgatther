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

// Debug function to check current state
window.debugPlayerState = function() {
    console.log(`🔍 Current state:`);
    console.log(`  myId: ${myId} (${typeof myId})`);
    console.log(`  players:`, Object.keys(players).map(id => `${id} (${typeof id})`));
    console.log(`  gunMode: ${gunMode}, gunModePlayerId: ${gunModePlayerId}`);
    console.log(`  medMode: ${medMode}, medModePlayerId: ${medModePlayerId}`);
};

socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
        case "players":
        console.log(`📥 Received ${msg.data.length} players:`, msg.data);
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
                    // Only apply server position updates to other players or as corrections
                    if (msg.data.id !== myId) {
                        // For other players, always update from server
                        playerPositions[msg.data.id].targetX = msg.data.x;
                        playerPositions[msg.data.id].targetY = msg.data.y;
                    } else {
                        // For own player, ignore server updates to prevent rubber-banding
                        // Client-side prediction takes priority for controlled player
                        console.log(`Ignoring server position update for controlled player ${myId}`);
                    }
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
            console.log(`🎮 Player created: Setting myId to ${myId}`);
            drawPlayer(msg.data);
            controlPlayer(myId);
            break;
        case "player_deleted":
            removePlayer(msg.data.id);
            break;
        case "health_change":
            const playerId = msg.data.playerId;
            const newHealth = msg.data.health;
            const changeType = msg.data.type;
            
            console.log(`📥 WebSocket health_change: Player ${playerId} -> ${newHealth}% (${changeType}), current: ${playerHealth[playerId]}`);
            
            // Update health locally for all clients
            if (playerHealth[playerId] !== undefined) {
                const oldHealth = playerHealth[playerId];
                playerHealth[playerId] = newHealth;
                updateHealthBar(playerId);
                console.log(`🔄 Health updated: Player ${playerId}: ${oldHealth} -> ${newHealth}% (${changeType})`);
                
                // Handle death for all clients
                if (newHealth <= 0) {
                    // Remove player from local arrays and DOM
                    const playerDiv = players[playerId];
                    if (playerDiv) {
                        playerDiv.remove();
                    }
                    delete players[playerId];
                    delete playerHealth[playerId];
                    delete playerPositions[playerId];
                    console.log(`🫥 Player ${playerId} removed from game (WebSocket death)`);
                    
                    // If this was the controlled player, clear control and alert
                    if (playerId === myId) {
                        myId = null;
                        updateUIBasedOnControl();
                        alert("Your player has died! You need to create a new player to continue playing.");
                        console.log(`🎮 Control cleared for dead player ${playerId} (WebSocket)`);
                    }
                }
            } else {
                console.warn(`❌ Cannot update health for unknown player ${playerId}`);
            }
            break;
        case "spawn_bullet":
            const bulletFromId = msg.data.fromId;
            const bulletTargetX = msg.data.targetX;
            const bulletTargetY = msg.data.targetY;
            
            // Spawn bullet for all clients
            console.log(`🔄 Received bullet spawn from player ${bulletFromId}`);
            spawnDirectionalBullet(bulletFromId, bulletTargetX, bulletTargetY, true);
            break;
        case "spawn_medkit":
            const medkitFromId = msg.data.fromId;
            const medkitTargetX = msg.data.targetX;
            const medkitTargetY = msg.data.targetY;
            
            // Spawn med kit for all clients
            console.log(`🔄 Received med kit spawn from player ${medkitFromId}`);
            spawnDirectionalMedKit(medkitFromId, medkitTargetX, medkitTargetY, true);
            break;

    }
};

let cameraOffsetX = 0;
let cameraOffsetY = 0;

let targetCameraX = 0;
let targetCameraY = 0;

// Make camera variables globally accessible
window.cameraOffsetX = cameraOffsetX;
window.cameraOffsetY = cameraOffsetY;
window.targetCameraX = targetCameraX;
window.targetCameraY = targetCameraY;

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

    // Update global references
    window.cameraOffsetX = cameraOffsetX;
    window.cameraOffsetY = cameraOffsetY;

    bg.style.backgroundPosition = `-${Math.round(cameraOffsetX)}px -${Math.round(cameraOffsetY)}px`;
    game.style.left = `-${Math.round(cameraOffsetX)}px`;
    game.style.top = `-${Math.round(cameraOffsetY)}px`;

    redrawCanvas();
}

function setCameraImmediately(x, y) {
    const maxOffsetX = 10000 - window.innerWidth;
    const maxOffsetY = 10000 - window.innerHeight;
    const immediateX = Math.max(0, Math.min(x - window.innerWidth / 2, maxOffsetX));
    const immediateY = Math.max(0, Math.min(y - window.innerHeight / 2, maxOffsetY));
    
    // Set both current and target positions to eliminate interpolation delay
    cameraOffsetX = immediateX;
    cameraOffsetY = immediateY;
    targetCameraX = immediateX;
    targetCameraY = immediateY;
    
    // Update global references
    window.cameraOffsetX = cameraOffsetX;
    window.cameraOffsetY = cameraOffsetY;
    window.targetCameraX = targetCameraX;
    window.targetCameraY = targetCameraY;
    
    // Apply camera position immediately
    const bg = document.getElementById('background');
    const game = document.getElementById('game');
    if (bg && game) {
        bg.style.backgroundPosition = `-${immediateX}px -${immediateY}px`;
        game.style.left = `-${immediateX}px`;
        game.style.top = `-${immediateY}px`;
    }
}

function createPlayer() {
    updateUIBasedOnControl();
    const name = prompt("Choose a name:");
    const accountId = localStorage.getItem('accountId');
    
    if (!accountId) {
        alert('You must be logged in to create a player. Redirecting to login...');
        window.location.href = '/';
        return;
    }
    
    if (name) {
        socket.send(JSON.stringify({ 
            type: "create", 
            data: { name, accountId: parseInt(accountId) } 
        }));
    }
}

function drawPlayer(c) {
    if (players[c.id]) {
        console.log(`Player ${c.id} (${c.name}) already exists, skipping draw`);
        return;
    }
    
    console.log(`🎨 Drawing player ${c.id} (${typeof c.id}) (${c.name}) at (${c.x}, ${c.y}), myId=${myId} (${typeof myId})`);

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
        <button class="player-btn" id="gun-${c.id}" onclick="toggleGunMode(${c.id})">Gun Mode</button>
        <button class="player-btn" id="med-${c.id}" onclick="toggleMedMode(${c.id})">Med Mode</button>
    `;
    document.getElementById("game").appendChild(div);
    players[c.id] = div;

    playerPositions[c.id] = {
        currentX: c.x,
        currentY: c.y,
        targetX: c.x,
        targetY: c.y
    };

    // Initialize health if not already set
    if (playerHealth[c.id] === undefined) {
        playerHealth[c.id] = 100;
    }
    updateHealthBar(c.id);
    
    // Update visual indicators for all players
    updatePlayerControlVisuals();
    
    // Check if this is the player we're waiting to auto-control
    if (window.pendingAutoControl) {
        console.log(`🔍 Checking auto-control: pendingId=${window.pendingAutoControl.id}, currentId=${c.id}, match=${c.id === window.pendingAutoControl.id}`);
        
        if (c.id === window.pendingAutoControl.id) {
            console.log(`🎯 Found pending auto-control player: ${c.name} (${c.id})`);
            
            // Position camera immediately to this player
            if (typeof setCameraImmediately === 'function') {
                setCameraImmediately(c.x, c.y);
                console.log(`📹 Camera positioned to controlled player: ${c.name} at (${c.x}, ${c.y})`);
            }
            
            // Update the auto-control info
            const autoControlInfo = document.getElementById('auto-control-info');
            if (autoControlInfo) {
                autoControlInfo.innerHTML = `<i style="color: #000980ff;">✓ Controlling: ${c.name}</i>`;
            }
            
            // Clear pending state
            window.pendingAutoControl = null;
            console.log(`🎯 Auto-control completed for player ${c.name}`);
        }
    } else {
        console.log(`🔍 No pending auto-control for player ${c.id} (${c.name})`);
    }
}

let targetId = null;
let playerHealth = {};
let gunMode = false;
let gunModePlayerId = null;
let medMode = false;
let medModePlayerId = null;

function toggleGunMode(id) {
    console.log(`🔫 toggleGunMode called: id=${id} (${typeof id}), myId=${myId} (${typeof myId}), equal=${myId === id}, loose equal=${myId == id}`);
    
    // Only allow gun mode on controlled player - use loose equality to handle string/number mismatch
    if (myId != id) {
        alert(`You can only enable gun mode for the player you are controlling! (myId: ${myId}, clicked: ${id})`);
        return;
    }
    
    // Check if player is alive
    if (!players[id] || playerHealth[id] <= 0) {
        alert('Cannot enable gun mode on a dead player!');
        return;
    }
    
    // Disable med mode if active
    if (medMode) {
        medMode = false;
        medModePlayerId = null;
        const medBtn = document.getElementById(`med-${id}`);
        if (medBtn) {
            medBtn.textContent = "Med Mode";
            medBtn.style.backgroundColor = "";
        }
    }

    gunMode = !gunMode;
    const gunBtn = document.getElementById(`gun-${id}`);
    
    if (gunMode) {
        gunModePlayerId = id;
        gunBtn.textContent = "Exit Gun Mode";
        gunBtn.style.backgroundColor = "#ff6666";
        document.body.style.cursor = "crosshair";
        console.log(`Gun mode enabled for player ${id}, gunModePlayerId set to: ${gunModePlayerId} (${typeof gunModePlayerId})`);
    } else {
        gunModePlayerId = null;
        gunBtn.textContent = "Gun Mode";
        gunBtn.style.backgroundColor = "";
        document.body.style.cursor = "default";
        console.log(`Gun mode disabled for player ${id}, gunModePlayerId set to: ${gunModePlayerId}`);
    }
}

function toggleMedMode(id) {
    console.log(`💊 toggleMedMode called: id=${id} (${typeof id}), myId=${myId} (${typeof myId}), equal=${myId === id}, loose equal=${myId == id}`);
    
    // Only allow med mode on controlled player - use loose equality to handle string/number mismatch
    if (myId != id) {
        alert(`You can only enable med mode for the player you are controlling! (myId: ${myId}, clicked: ${id})`);
        return;
    }
    
    // Check if player is alive
    if (!players[id] || playerHealth[id] <= 0) {
        alert('Cannot enable med mode on a dead player!');
        return;
    }
    
    // Disable gun mode if active
    if (gunMode) {
        gunMode = false;
        gunModePlayerId = null;
        const gunBtn = document.getElementById(`gun-${id}`);
        if (gunBtn) {
            gunBtn.textContent = "Gun Mode";
            gunBtn.style.backgroundColor = "";
        }
    }

    medMode = !medMode;
    const medBtn = document.getElementById(`med-${id}`);
    
    if (medMode) {
        medModePlayerId = id;
        medBtn.textContent = "Exit Med Mode";
        medBtn.style.backgroundColor = "#66ff66";
        document.body.style.cursor = "help";
        console.log(`Med mode enabled for player ${id}`);
    } else {
        medModePlayerId = null;
        medBtn.textContent = "Med Mode";
        medBtn.style.backgroundColor = "";
        document.body.style.cursor = "default";
        console.log(`Med mode disabled for player ${id}`);
    }
}

// Make functions globally accessible for onclick handlers
window.toggleGunMode = toggleGunMode;
window.toggleMedMode = toggleMedMode;
window.controlPlayer = controlPlayer;
window.changeName = changeName;
window.scrollBackgroundTo = scrollBackgroundTo;
window.updateUIBasedOnControl = updateUIBasedOnControl;
window.setCameraImmediately = setCameraImmediately;

function updatePlayerControlVisuals() {
    // Update visual indicators for all players
    Object.keys(players).forEach(playerId => {
        const player = players[playerId];
        const playerName = player.querySelector('.player-name');
        const isControlled = (parseInt(playerId) === myId);
        
        if (playerName) {
            if (isControlled) {
                playerName.style.border = '2px solid #0066cc';
                playerName.style.backgroundColor = 'rgba(0, 102, 204, 0.1)';
            } else {
                playerName.style.border = '';
                playerName.style.backgroundColor = '';
            }
        }
    });
}

window.updatePlayerControlVisuals = updatePlayerControlVisuals;

// Mouse click event handler for gun mode and med mode
document.addEventListener('click', function(e) {
    console.log(`🖱️ Click detected: gunMode=${gunMode}, medMode=${medMode}, gunModePlayerId=${gunModePlayerId}, medModePlayerId=${medModePlayerId}`);
    
    if (!gunMode && !medMode) {
        console.log(`🖱️ Click ignored: no active mode`);
        return;
    }
    if (gunModePlayerId === null && medModePlayerId === null) {
        console.log(`🖱️ Click ignored: no active player ID`);
        return;
    }
    
    // Allow clicking the respective mode buttons to disable modes
    if (gunMode) {
        const gunButton = document.getElementById(`gun-${gunModePlayerId}`);
        console.log(`🎯 Gun mode active - checking if clicked gun button. Target: ${e.target.tagName}#${e.target.id}, Gun button: ${gunButton ? gunButton.id : 'null'}, Match: ${e.target === gunButton}`);
        if (e.target === gunButton) {
            console.log(`🎯 Clicked gun button - letting toggle function handle this`);
            return; // Let the gun mode toggle function handle this
        }
    }
    
    if (medMode) {
        const medButton = document.getElementById(`med-${medModePlayerId}`);
        console.log(`💊 Med mode active - checking if clicked med button. Target: ${e.target.tagName}#${e.target.id}, Med button: ${medButton ? medButton.id : 'null'}, Match: ${e.target === medButton}`);
        if (e.target === medButton) {
            console.log(`💊 Clicked med button - letting toggle function handle this`);
            return; // Let the med mode toggle function handle this
        }
    }
    
    // In either mode, ALL other clicks perform the respective action
    // Prevent default behavior and stop event propagation
    console.log(`✅ Processing click for shooting/healing`);
    e.preventDefault();
    e.stopPropagation();
    
    // Calculate world coordinates accounting for camera offset
    const worldX = e.clientX + cameraOffsetX;
    const worldY = e.clientY + cameraOffsetY;
    console.log(`🎯 World coordinates: (${worldX}, ${worldY}), camera offset: (${cameraOffsetX}, ${cameraOffsetY})`);
    
    if (gunMode && gunModePlayerId !== null) {
        console.log(`🔫 Gun mode: Shooting from player ${gunModePlayerId} to world coordinates (${worldX}, ${worldY})`);
        console.log(`📤 Sending bullet spawn WebSocket message`);
        // Send bullet spawn to server for synchronization
        socket.send(JSON.stringify({ 
            type: "spawn_bullet", 
            data: { 
                fromId: gunModePlayerId, 
                targetX: worldX, 
                targetY: worldY 
            } 
        }));
    } else if (medMode && medModePlayerId !== null) {
        console.log(`💊 Med mode: Launching med kit from player ${medModePlayerId} to world coordinates (${worldX}, ${worldY})`);
        console.log(`📤 Sending med kit spawn WebSocket message`);
        // Send med kit spawn to server for synchronization
        socket.send(JSON.stringify({ 
            type: "spawn_medkit", 
            data: { 
                fromId: medModePlayerId, 
                targetX: worldX, 
                targetY: worldY 
            } 
        }));
    } else {
        console.log(`🖱️ Click ignored: gunMode=${gunMode}, gunModePlayerId=${gunModePlayerId}, medMode=${medMode}, medModePlayerId=${medModePlayerId}`);
    }
}, true); // Use capture phase to intercept all clicks

function spawnDirectionalBullet(fromId, targetX, targetY, fromWebSocket = false) {
    const from = players[fromId];
    if (!from) {
        console.warn(`Cannot spawn bullet: player ${fromId} not found`);
        return;
    }

    const bullet = document.createElement("div");
    bullet.className = "bullet";
    bullet.style.position = "absolute";
    
    // Start from center of shooter
    const startX = parseInt(from.style.left) + 30;
    const startY = parseInt(from.style.top) + 30;
    
    bullet.style.left = startX + "px";
    bullet.style.top = startY + "px";

    document.getElementById("game").appendChild(bullet);
    console.log(`Bullet spawned: (${startX},${startY}) → (${targetX},${targetY}) ${fromWebSocket ? '[WebSocket]' : '[Local]'}`);

    let x = startX;
    let y = startY;

    // Calculate direction vector and normalize for consistent speed
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);
    const speed = 15; // pixels per step - same as player-to-player bullets
    const stepX = (dx / distance) * speed;
    const stepY = (dy / distance) * speed;
    
    let stepCount = 0;
    const maxSteps = Math.ceil(distance / speed) + 20; // Allow bullets to travel further
    
    const interval = setInterval(() => {
        x += stepX;
        y += stepY;
        bullet.style.left = x + "px";
        bullet.style.top = y + "px";
        stepCount++;

        // Check collision with all players (only apply damage if not from WebSocket or if we're the shooter)
        let hit = false;
        const allPlayerIds = Object.keys(players);
        const eligiblePlayers = allPlayerIds.filter(id => parseInt(id) !== fromId);
        const debugPlayers = allPlayerIds.map(id => `${id}@(${parseInt(players[id].style.left)},${parseInt(players[id].style.top)})`).join(', ');
        
        if (stepCount % 10 === 0) { // Log every 10th step to reduce spam
            console.log(`🔍 Bullet from ${fromId} at (${x.toFixed(0)}, ${y.toFixed(0)}) - Total players: ${allPlayerIds.length}, Eligible targets: ${eligiblePlayers.length} (${eligiblePlayers.join(',')})`);
            console.log(`🔍 Player positions: ${debugPlayers}`);
        }
        
        // Special logging when bullet is near player 19's X coordinate
        if (Math.abs(x - 414) < 30 && eligiblePlayers.includes('19')) {
            console.log(`🎯 TRAJECTORY CHECK: Bullet at (${x.toFixed(0)}, ${y.toFixed(0)}) is near Player19's X position (414)`);
            console.log(`🎯 Player19 is at (414, 416) - Y difference: ${Math.abs(y - 416).toFixed(1)} pixels`);
        }
        
        Object.keys(players).forEach(playerId => {
            if (parseInt(playerId) === fromId) return; // Don't hit self
            
            const player = players[playerId];
            if (player) {
                // Player dimensions (60px wide, full element height including buttons)
                const playerLeft = parseInt(player.style.left);
                const playerTop = parseInt(player.style.top);
                const playerWidth = 60;
                const playerHeight = player.offsetHeight; // Full element height including buttons
                
                // Check if bullet position is within player rectangle
                const bulletHitsPlayer = (
                    x >= playerLeft && 
                    x <= playerLeft + playerWidth &&
                    y >= playerTop && 
                    y <= playerTop + playerHeight
                );
                
                // Debug logging for close misses with detailed collision info
                const distance = Math.hypot((playerLeft + playerWidth/2) - x, (playerTop + playerHeight/2) - y);
                if (distance < 150 && stepCount % 3 === 0) { // Increased range and frequency for debugging
                    const playerRight = playerLeft + playerWidth;
                    const playerBottom = playerTop + playerHeight;
                    console.log(`🔍 Close check: Bullet(${x.toFixed(0)}, ${y.toFixed(0)}) vs Player${playerId}(${playerLeft}, ${playerTop})`);
                    console.log(`🔍   Player bounds: Left=${playerLeft}, Right=${playerRight}, Top=${playerTop}, Bottom=${playerBottom}`);
                    console.log(`🔍   X check: ${x} >= ${playerLeft} = ${x >= playerLeft}, ${x} <= ${playerRight} = ${x <= playerRight}`);
                    console.log(`🔍   Y check: ${y} >= ${playerTop} = ${y >= playerTop}, ${y} <= ${playerBottom} = ${y <= playerBottom}`);
                    console.log(`🔍   Final hit: ${bulletHitsPlayer}, distance: ${distance.toFixed(1)}`);
                }
                
                if (bulletHitsPlayer && !hit) {
                    console.log(`🎯 Directional bullet hit player ${playerId}! Bullet at (${x.toFixed(0)}, ${y.toFixed(0)}) hit player at (${playerLeft}, ${playerTop})`);
                    console.log(`🎯 Collision check: fromWebSocket=${fromWebSocket}, fromId=${fromId}, myId=${myId}, shouldApplyDamage=${!fromWebSocket || fromId === myId}`);
                    // Only the original shooter applies damage to prevent duplicates
                    if (!fromWebSocket || fromId === myId) {
                        console.log(`🎯 Applying damage from ${fromWebSocket ? 'WebSocket' : 'local'} bullet`);
                        applyDamage(parseInt(playerId));
                    } else {
                        console.log(`🎯 Skipping damage - not the original shooter`);
                    }
                    hit = true;
                }
            }
        });
        
        if (hit) {
            bullet.remove();
            clearInterval(interval);
            return;
        }

        // Clean up bullet after max steps or if it goes off screen
        if (stepCount >= maxSteps || x < -100 || x > 10100 || y < -100 || y > 10100) {
            bullet.remove();
            clearInterval(interval);
        }

    }, 16); // Same update rate as other bullets
}

function spawnDirectionalMedKit(fromId, targetX, targetY, fromWebSocket = false) {
    const from = players[fromId];
    if (!from) {
        console.warn(`Cannot spawn med kit: player ${fromId} not found`);
        return;
    }

    const medkit = document.createElement("div");
    medkit.className = "medkit";
    medkit.style.position = "absolute";
    
    // Start from center of medic
    const startX = parseInt(from.style.left) + 30;
    const startY = parseInt(from.style.top) + 30;
    
    medkit.style.left = startX + "px";
    medkit.style.top = startY + "px";

    document.getElementById("game").appendChild(medkit);
    console.log(`Med kit spawned: (${startX},${startY}) → (${targetX},${targetY}) ${fromWebSocket ? '[WebSocket]' : '[Local]'}`);

    let x = startX;
    let y = startY;

    // Calculate direction vector and normalize for consistent speed
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);
    const speed = 12; // Slightly slower than bullets for balance
    const stepX = (dx / distance) * speed;
    const stepY = (dy / distance) * speed;
    
    let stepCount = 0;
    const maxSteps = Math.ceil(distance / speed) + 20; // Allow med kits to travel further
    
    const interval = setInterval(() => {
        x += stepX;
        y += stepY;
        medkit.style.left = x + "px";
        medkit.style.top = y + "px";
        stepCount++;

        // Check collision with all players (only apply healing if not from WebSocket or if we're the medic)
        let hit = false;
        Object.keys(players).forEach(playerId => {
            if (parseInt(playerId) === fromId) return; // Don't heal self
            
            const player = players[playerId];
            if (player) {
                // Player dimensions (60px wide, full element height including buttons)
                const playerLeft = parseInt(player.style.left);
                const playerTop = parseInt(player.style.top);
                const playerWidth = 60;
                const playerHeight = player.offsetHeight; // Full element height including buttons
                
                // Check if med kit position is within player rectangle
                const medkitHitsPlayer = (
                    x >= playerLeft && 
                    x <= playerLeft + playerWidth &&
                    y >= playerTop && 
                    y <= playerTop + playerHeight
                );
                
                if (medkitHitsPlayer && !hit) {
                    console.log(`💊 Med kit hit player ${playerId}! Med kit at (${x.toFixed(0)}, ${y.toFixed(0)}) hit player at (${playerLeft}, ${playerTop})`);
                    console.log(`💊 Collision check: fromWebSocket=${fromWebSocket}, fromId=${fromId}, myId=${myId}, shouldApplyHealing=${!fromWebSocket || fromId === myId}`);
                    // Only the original medic applies healing to prevent duplicates
                    if (!fromWebSocket || fromId === myId) {
                        console.log(`💊 Applying healing from ${fromWebSocket ? 'WebSocket' : 'local'} med kit`);
                        applyHealing(parseInt(playerId));
                    } else {
                        console.log(`💊 Skipping healing - not the original medic`);
                    }
                    hit = true;
                }
            }
        });
        
        if (hit) {
            medkit.remove();
            clearInterval(interval);
            return;
        }

        // Clean up med kit after max steps or if it goes off screen
        if (stepCount >= maxSteps || x < -100 || x > 10100 || y < -100 || y > 10100) {
            medkit.remove();
            clearInterval(interval);
        }

    }, 16); // Same update rate as bullets
}

function removePlayer(id) {
    const el = players[id];
    if (el) el.remove();
    delete players[id];
    delete playerHealth[id];
    delete playerPositions[id];
}

function updateHealthBar(id) {
    console.log(`🩸 updateHealthBar called: Player ${id}, health: ${playerHealth[id]}%`);
    const healthBar = document.getElementById(`health-${id}`);
    const bar = healthBar?.querySelector(".health-fill");
    
    if (bar && playerHealth[id] !== undefined) {
        const oldWidth = bar.style.width;
        // Use setProperty with important to override CSS !important
        bar.style.setProperty('width', `${playerHealth[id]}%`, 'important');
        const newWidth = bar.style.width;
        console.log(`🩸 Health bar updated: Player ${id}: ${oldWidth} -> ${newWidth} (health: ${playerHealth[id]}%)`);
        
        // Also log the computed style to verify
        const computedStyle = window.getComputedStyle(bar);
        console.log(`🩸 Computed width: ${computedStyle.width}`);
    } else {
        console.warn(`❌ Health bar update failed for player ${id}:`, {
            healthBar: !!healthBar,
            bar: !!bar,
            health: playerHealth[id]
        });
    }
}

function changeName(id) {
    console.log(`✏️ changeName called: id=${id} (${typeof id}), myId=${myId} (${typeof myId}), equal=${myId === id}, loose equal=${myId == id}`);
    
    // Check if gun mode is active
    if (gunMode) {
        alert('Cannot change names while in gun mode. Exit gun mode first.');
        return;
    }
    
    // Only allow changing name of controlled player - use loose equality to handle string/number mismatch
    if (myId != id) {
        alert(`You can only change the name of the player you are controlling! (myId: ${myId}, clicked: ${id})`);
        return;
    }
    
    const name = prompt("New name?");
    if (name) {
        socket.send(JSON.stringify({ type: "change_name", data: { id, name } }));
    }
}

function controlPlayer(id) {
    const accountId = localStorage.getItem('accountId');
    
    if (!accountId) {
        alert('You must be logged in to control a player. Redirecting to login...');
        window.location.href = '/';
        return;
    }
    
    // Check if gun mode is active
    if (gunMode) {
        alert('Cannot switch control while in gun mode. Exit gun mode first.');
        return;
    }
    
    // Check if trying to control a different player while current player is alive
    if (myId && myId !== id && players[myId] && playerHealth[myId] > 0) {
        alert('You cannot control another player while your current player is still alive!');
        return;
    }
    
    // Disable gun mode when switching players
    if (gunMode && gunModePlayerId) {
        gunMode = false;
        gunModePlayerId = null;
        document.body.style.cursor = "default";
        // Update the gun button of the previous player
        const prevGunBtn = document.getElementById(`gun-${myId}`);
        if (prevGunBtn) {
            prevGunBtn.textContent = "Gun Mode";
            prevGunBtn.style.backgroundColor = "";
        }
    }
    
    myId = id;
    console.log(`🎮 controlPlayer: Setting myId to ${id}`);
    updateUIBasedOnControl();
    const div = players[id];
    const name = div?.querySelector('.player-name')?.textContent || 'Unknown';
    
    // Update the control info display
    const autoControlInfo = document.getElementById('auto-control-info');
    if (autoControlInfo) {
        autoControlInfo.innerHTML = `<i style="color: #00cc00;">✓ Controlling: ${name}</i>`;
    }
    
    // Update visual indication for all players
    updatePlayerControlVisuals();
    
    // Send control command to server to update account's last_player_id
    socket.send(JSON.stringify({ 
        type: "control_player", 
        data: { playerId: id, accountId: parseInt(accountId) } 
    }));
    
    alert("You are now controlling: " + name);
}

let keysPressed = {};
let moveSpeed = 8;
let lastMoveTime = 0;
let moveThrottleMs = 100; // Increased throttling to reduce network load on deployed version

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
    const pos = playerPositions[myId];
    let moved = false;
    const mapWidth = 10000;
    const mapHeight = 10000;
    const playerSize = 60;

    // Client-side prediction: Update position immediately for smooth movement
    let newX = pos.targetX;
    let newY = pos.targetY;

    if (keysPressed["ArrowUp"] && newY > 0) {
        newY = Math.max(0, newY - moveSpeed);
        moved = true;
    }
    if (keysPressed["ArrowDown"] && newY < mapHeight - playerSize) {
        newY = Math.min(mapHeight - playerSize, newY + moveSpeed);
        moved = true;
    }
    if (keysPressed["ArrowLeft"] && newX > 0) {
        newX = Math.max(0, newX - moveSpeed);
        moved = true;
    }
    if (keysPressed["ArrowRight"] && newX < mapWidth - playerSize) {
        newX = Math.min(mapWidth - playerSize, newX + moveSpeed);
        moved = true;
    }

    if (moved) {
        // Update client position immediately for smooth movement
        pos.targetX = newX;
        pos.targetY = newY;
        pos.currentX = newX; // Also update current position to prevent interpolation lag
        pos.currentY = newY;
        
        // Send to server with throttling to reduce network traffic
        if (now - lastMoveTime >= moveThrottleMs) {
            lastMoveTime = now;
            socket.send(JSON.stringify({ 
                type: "move", 
                data: { id: myId, x: newX, y: newY } 
            }));
        }
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
    if (!from || !to) {
        console.warn(`Cannot spawn bullet: fromId=${fromId}, toId=${toId}, from=${!!from}, to=${!!to}`);
        return;
    }

    const bullet = document.createElement("div");
    bullet.className = "bullet";
    bullet.style.position = "absolute";
    
    // Start from center of shooter
    const startX = parseInt(from.style.left) + 30;
    const startY = parseInt(from.style.top) + 30;
    
    // Target center of target player
    const targetX = parseInt(to.style.left) + 30;
    const targetY = parseInt(to.style.top) + 30;
    
    bullet.style.left = startX + "px";
    bullet.style.top = startY + "px";

    document.getElementById("game").appendChild(bullet);
    console.log(`Bullet spawned: (${startX},${startY}) → (${targetX},${targetY})`);

    let x = startX;
    let y = startY;

    // Calculate direction vector and normalize for consistent speed
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);
    const speed = 15; // pixels per step - increased for faster bullets
    const stepX = (dx / distance) * speed;
    const stepY = (dy / distance) * speed;
    
    let stepCount = 0;
    const maxSteps = Math.ceil(distance / speed) + 10; // Allow some extra steps
    
    const interval = setInterval(() => {
        x += stepX;
        y += stepY;
        bullet.style.left = x + "px";
        bullet.style.top = y + "px";
        stepCount++;

        const target = players[toId];
        if (target) {
            const currentTargetX = parseInt(target.style.left) + 30;
            const currentTargetY = parseInt(target.style.top) + 30;
            const distToTarget = Math.hypot(currentTargetX - x, currentTargetY - y);
            
            if (stepCount % 5 === 0) { // Log every 5th step to reduce spam
                console.log(`Bullet step ${stepCount}: bullet(${x.toFixed(0)},${y.toFixed(0)}) target(${currentTargetX},${currentTargetY}) dist=${distToTarget.toFixed(1)}px`);
            }
            
            // Hit detection with generous radius
            if (distToTarget < 30) {
                console.log(`🎯 Bullet hit player ${toId}! Distance: ${distToTarget.toFixed(1)}px`);
                applyDamage(toId);
                bullet.remove();
                clearInterval(interval);
                return;
            }
        }

        // Clean up bullet after max steps
        if (stepCount >= maxSteps) {
            console.log(`❌ Bullet missed target after ${stepCount} steps, cleaning up`);
            bullet.remove();
            clearInterval(interval);
        }

    }, 16); // Faster update rate for smoother bullets
}
function applyDamage(id) {
    console.log(`💥 applyDamage called: Player ${id}, current health: ${playerHealth[id]}`);
    if (playerHealth[id] === undefined) {
        console.warn(`❌ No health found for player ${id}`);
        return;
    }

    const oldHealth = playerHealth[id];
    playerHealth[id] -= 10;
    console.log(`💥 Damage applied: Player ${id}: ${oldHealth} -> ${playerHealth[id]}`);
    
    // Send health change to server for synchronization
    console.log(`📤 Sending damage WebSocket message for player ${id}`);
    socket.send(JSON.stringify({ 
        type: "health_change", 
        data: { 
            playerId: id, 
            health: playerHealth[id],
            type: "damage"
        } 
    }));
    
    if (playerHealth[id] <= 0) {
        playerHealth[id] = 0;
        updateHealthBar(id);
        
        console.log(`💀 Player ${id} has died and will be hidden`);
        
        // Disable gun mode if the dying player was in gun mode
        if (gunMode && gunModePlayerId === id) {
            gunMode = false;
            gunModePlayerId = null;
            document.body.style.cursor = "default";
            console.log(`Gun mode disabled due to player ${id} death`);
        }
        
        // Disable med mode if the dying player was in med mode
        if (medMode && medModePlayerId === id) {
            medMode = false;
            medModePlayerId = null;
            document.body.style.cursor = "default";
            console.log(`Med mode disabled due to player ${id} death`);
        }
        
        // Delete the player from database and remove from view
        console.log(`🗑️ Deleting dead player ${id} from database`);
        socket.send(JSON.stringify({ 
            type: "delete_player", 
            data: { id: id } 
        }));
        
        // Remove player from local arrays and DOM
        const playerDiv = players[id];
        if (playerDiv) {
            playerDiv.remove();
        }
        delete players[id];
        delete playerHealth[id];
        delete playerPositions[id];
        console.log(`🫥 Player ${id} removed from game`);
        
        // If this was the controlled player, clear control and alert
        if (id === myId) {
            myId = null;
            updateUIBasedOnControl();
            alert("Your player has died! You need to create a new player to continue playing.");
            console.log(`🎮 Control cleared for dead player ${id}`);
        }
    } else {
        updateHealthBar(id);
    }
}

function applyHealing(id) {
    console.log(`💚 applyHealing called: Player ${id}, current health: ${playerHealth[id]}`);
    if (playerHealth[id] === undefined) {
        console.warn(`❌ No health found for player ${id}`);
        return;
    }

    const oldHealth = playerHealth[id];
    playerHealth[id] += 15; // Heal for 15 points
    if (playerHealth[id] > 100) {
        playerHealth[id] = 100; // Cap at 100
    }
    
    console.log(`💚 Healing applied: Player ${id}: ${oldHealth} -> ${playerHealth[id]}`);
    
    // Send health change to server for synchronization
    console.log(`📤 Sending healing WebSocket message for player ${id}`);
    socket.send(JSON.stringify({ 
        type: "health_change", 
        data: { 
            playerId: id, 
            health: playerHealth[id],
            type: "heal"
        } 
    }));
    
    updateHealthBar(id);
    
    // Remove death visual effects if player was dead
    const playerDiv = players[id];
    if (playerDiv && playerDiv.style.opacity === "0.5") {
        playerDiv.style.opacity = "1";
        playerDiv.title = "";
        // Remove respawn button if it exists
        const respawnBtn = playerDiv.querySelector('button[style*="44ff44"]');
        if (respawnBtn) {
            respawnBtn.remove();
        }
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

    // For controlled player, use direct positioning to avoid lag
    if (parseInt(id) === myId) {
        div.style.left = Math.round(pos.targetX) + "px";
        div.style.top = Math.round(pos.targetY) + "px";
        pos.currentX = pos.targetX;
        pos.currentY = pos.targetY;
    } else {
        // For other players, use smooth interpolation
        const lerpFactor = 0.15;
        
        pos.currentX += (pos.targetX - pos.currentX) * lerpFactor;
        pos.currentY += (pos.targetY - pos.currentY) * lerpFactor;

        div.style.left = Math.round(pos.currentX) + "px";
        div.style.top = Math.round(pos.currentY) + "px";
    }
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

