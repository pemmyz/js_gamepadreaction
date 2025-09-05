document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const themeToggleButton = document.getElementById('themeToggle');
    const playersStatsContainer = document.getElementById('players-stats-container');
    const globalMessageEl = document.getElementById('global-message');
    const gamepadStatusEl = document.getElementById('gamepad-status');
    const visualLedDOMElements = {
        "North": document.getElementById('led-North'),
        "West": document.getElementById('led-West'),
        "East": document.getElementById('led-East'),
        "South": document.getElementById('led-South')
    };

    // --- Game Configuration ---
    const MAX_PLAYERS = 4;
    const ledNames = ["North", "West", "East", "South"];
    const playerColors = ['p1', 'p2', 'p3', 'p4'];
    const keyboardControls = {
        P1: { "ArrowUp": "North", "ArrowLeft": "West", "ArrowRight": "East", "ArrowDown": "South" },
        P2: { "w": "North", "a": "West", "d": "East", "s": "South" }
    };
    const gamepadButtonMapping = { 3: "North", 2: "West", 1: "East", 0: "South" }; // Y/△, X/□, B/O, A/X
    const gamepadPauseButtonIndex = 9; // Start/Options

    // --- Game State ---
    let players = [];
    let gamepads = {};
    let lastGamepadButtonStates = {};
    let assignedInputs = new Set(); // Stores assigned inputs like "keyboard_ArrowUp" or "gamepad0_button3"
    let paused = false;

    // --- Theme Logic ---
    const setTheme = (theme) => {
        document.body.classList.toggle('dark-mode', theme === 'dark');
        themeToggleButton.textContent = theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode';
        localStorage.setItem('theme', theme);
    };
    setTheme(localStorage.getItem('theme') || 'dark');
    themeToggleButton.addEventListener('click', () => setTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark'));

    // --- Player Factory & UI Creation ---
    function createPlayer(id, controlSource) {
        const player = {
            id: id,
            controlSource: controlSource, // e.g., "Keyboard P1" or "Gamepad 0"
            score: 0,
            reactionTimes: [],
            streak: 0,
            longestStreak: 0,
            missedPrompts: 0,
            ledTime: 1200, // Start a bit easier
            currentLedTarget: null,
            ledStartTime: null,
            ledTimerId: null,
            ui: {}
        };

        // Create player UI
        const statsDiv = document.createElement('div');
        statsDiv.className = 'player-stats';
        statsDiv.id = `player-${id}`;
        
        statsDiv.innerHTML = `
            <h3 class="player-header">Player ${id} (${controlSource})</h3>
            <p>Score: <span class="stat-score stat-highlight">0</span></p>
            <p>Streak: <span class="stat-streak">0</span> (Max: <span class="stat-max-streak">0</span>)</p>
            <p>Avg Time: <span class="stat-avg-time">N/A</span></p>
            <p>Window: <span class="stat-led-time">1200</span>ms</p>
        `;
        playersStatsContainer.appendChild(statsDiv);

        // Cache UI elements
        player.ui = {
            score: statsDiv.querySelector('.stat-score'),
            streak: statsDiv.querySelector('.stat-streak'),
            maxStreak: statsDiv.querySelector('.stat-max-streak'),
            avgTime: statsDiv.querySelector('.stat-avg-time'),
            ledTime: statsDiv.querySelector('.stat-led-time'),
        };

        return player;
    }

    // --- Game Logic (per player) ---
    function pickAndDisplayNewLed(player) {
        if (paused) return;
        player.currentLedTarget = ledNames[Math.floor(Math.random() * ledNames.length)];
        visualLedDOMElements[player.currentLedTarget].classList.add('active', playerColors[player.id - 1]);
        player.ledStartTime = Date.now();
        
        if (player.ledTimerId) clearTimeout(player.ledTimerId);
        player.ledTimerId = setTimeout(() => handleTimeout(player), player.ledTime);
        updateUI();
    }

    function handleTimeout(player) {
        if (!player.currentLedTarget) return; // Already answered
        visualLedDOMElements[player.currentLedTarget].classList.remove('active', playerColors[player.id - 1]);
        player.missedPrompts++;
        player.streak = 0;
        player.ledTime = Math.min(2000, player.ledTime + 50); // Make it slightly easier on a miss
        player.currentLedTarget = null;
        pickAndDisplayNewLed(player);
    }
    
    function processPlayerInput(player, direction) {
        if (paused || !player.currentLedTarget) return;

        if (player.currentLedTarget === direction) {
            const reaction = Date.now() - player.ledStartTime;
            player.reactionTimes.push(reaction);
            player.score++;
            player.streak++;
            if (player.streak > player.longestStreak) player.longestStreak = player.streak;
            // Decrease time based on performance
            player.ledTime = Math.max(200, player.ledTime - (25 + Math.floor(player.streak / 5)));
        } else {
            player.streak = 0;
            player.ledTime = Math.min(2000, player.ledTime + 100); // Penalty for wrong press
        }
        
        visualLedDOMElements[player.currentLedTarget].classList.remove('active', playerColors[player.id - 1]);
        player.currentLedTarget = null;
        if (player.ledTimerId) clearTimeout(player.ledTimerId);
        
        setTimeout(() => pickAndDisplayNewLed(player), 100); // Brief pause
    }
    
    // --- UI Update ---
    function updateUI() {
        if (players.length === 0) {
            globalMessageEl.textContent = "Press an Arrow Key, WASD, or a Gamepad Face Button to Join!";
        } else if (paused) {
            globalMessageEl.textContent = "GAME PAUSED";
        } else {
            globalMessageEl.textContent = "";
        }

        players.forEach(p => {
            p.ui.score.textContent = p.score;
            p.ui.streak.textContent = p.streak;
            p.ui.maxStreak.textContent = p.longestStreak;
            p.ui.ledTime.textContent = `${p.ledTime}ms`;
            if (p.reactionTimes.length > 0) {
                const avg = p.reactionTimes.reduce((a, b) => a + b, 0) / p.reactionTimes.length;
                p.ui.avgTime.textContent = `${avg.toFixed(0)}ms`;
            }
        });
    }

    // --- Player Joining Logic ---
    function handleJoinAttempt(inputType, inputKey, details) {
        if (players.length >= MAX_PLAYERS || assignedInputs.has(inputKey)) return;

        const newPlayerId = players.length + 1;
        let controlSource = '';
        let controlsToAssign = {};

        if (inputType === 'keyboard') {
            const controlSet = keyboardControls[details.set];
            Object.keys(controlSet).forEach(key => {
                assignedInputs.add(`keyboard_${key}`);
            });
            controlSource = `Keyboard ${details.set}`;
        } else if (inputType === 'gamepad') {
            Object.values(gamepadButtonMapping).forEach((dir, index) => {
                 const buttonIndex = Object.keys(gamepadButtonMapping).find(key => gamepadButtonMapping[key] === dir);
                 assignedInputs.add(`gamepad${details.index}_button${buttonIndex}`);
            });
            controlSource = `Gamepad ${details.index}`;
        }

        const newPlayer = createPlayer(newPlayerId, controlSource);
        players.push(newPlayer);
        console.log(`Player ${newPlayerId} joined with ${controlSource}`);
        
        if (!paused) {
            pickAndDisplayNewLed(newPlayer);
        }
        updateUI();
    }

    // --- Event Handlers ---
    function handleKeyDown(event) {
        const key = event.key.toLowerCase();
        if (event.repeat) return;
        if (key === 'r') return resetGame();
        if (key === ' ') return togglePause();

        const inputId = `keyboard_${key}`;
        if (assignedInputs.has(inputId)) {
            // Find player and process input
            players.forEach(p => {
                if (p.controlSource.startsWith("Keyboard")) {
                   const set = p.controlSource.split(' ')[1];
                   if(keyboardControls[set]?.[key]) {
                       processPlayerInput(p, keyboardControls[set][key]);
                   }
                }
            });
        } else {
            // Attempt to join
            Object.entries(keyboardControls).forEach(([set, controls]) => {
                if (Object.keys(controls).includes(key)) {
                    // Check if this whole control set is available
                    const isSetTaken = Object.keys(controls).some(k => assignedInputs.has(`keyboard_${k}`));
                    if (!isSetTaken) {
                        handleJoinAttempt('keyboard', inputId, { set });
                    }
                }
            });
        }
    }

    function handleGamepadInput() {
        const polledPads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < polledPads.length; i++) {
            const pad = polledPads[i];
            if (!pad) continue;

            // Handle Pause
            if (pad.buttons[gamepadPauseButtonIndex].pressed && !lastGamepadButtonStates[i]?.[gamepadPauseButtonIndex]) {
                togglePause();
            }

            // Handle actions/joining
            for (const buttonIndex in gamepadButtonMapping) {
                const direction = gamepadButtonMapping[buttonIndex];
                if (pad.buttons[buttonIndex].pressed && !lastGamepadButtonStates[i]?.[buttonIndex]) {
                    const inputId = `gamepad${i}_button${buttonIndex}`;
                    if (assignedInputs.has(inputId)) {
                        const player = players.find(p => p.controlSource === `Gamepad ${i}`);
                        if (player) processPlayerInput(player, direction);
                    } else {
                        // Check if this gamepad is already taken by another player
                        const isPadTaken = players.some(p => p.controlSource === `Gamepad ${i}`);
                        if(!isPadTaken) {
                           handleJoinAttempt('gamepad', inputId, { index: i });
                        }
                    }
                }
            }
            lastGamepadButtonStates[i] = pad.buttons.map(b => b.pressed);
        }
    }

    // --- Global Game Controls ---
    function togglePause() {
        paused = !paused;
        if (paused) {
            players.forEach(p => {
                clearTimeout(p.ledTimerId);
                if (p.currentLedTarget) {
                    visualLedDOMElements[p.currentLedTarget].classList.remove('active', playerColors[p.id - 1]);
                }
            });
        } else {
            players.forEach(p => {
                if (!p.currentLedTarget) pickAndDisplayNewLed(p);
            });
        }
        updateUI();
    }

    function resetGame() {
        paused = false;
        players.forEach(p => clearTimeout(p.ledTimerId));
        Object.values(visualLedDOMElements).forEach(el => el.className = 'led-visual');
        players = [];
        assignedInputs.clear();
        playersStatsContainer.innerHTML = '';
        updateUI();
    }

    // --- Gamepad Connection Listeners ---
    function updateGamepadStatus() {
        const anyConnected = Object.values(navigator.getGamepads()).some(p => p);
        gamepadStatusEl.textContent = anyConnected ? 'Gamepad: Connected' : 'Gamepad: Not Detected';
        gamepadStatusEl.className = anyConnected ? 'connected' : 'disconnected';
    }
    window.addEventListener("gamepadconnected", e => { gamepads[e.gamepad.index] = e.gamepad; updateGamepadStatus(); });
    window.addEventListener("gamepaddisconnected", e => { delete gamepads[e.gamepad.index]; updateGamepadStatus(); });

    // --- Main Loop ---
    function gameLoop() {
        if (!paused) {
            handleGamepadInput();
        }
        requestAnimationFrame(gameLoop);
    }

    // --- Initialization ---
    document.addEventListener('keydown', handleKeyDown);
    updateGamepadStatus();
    updateUI();
    gameLoop();
});
