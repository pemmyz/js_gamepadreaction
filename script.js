document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const themeToggleButton = document.getElementById('themeToggle');
    const playersStatsContainer = document.getElementById('players-stats-container');
    const globalMessageEl = document.getElementById('global-message');
    const gamepadStatusEl = document.getElementById('gamepad-status');
    const globalStatsArea = document.getElementById('global-stats-area');
    const visualLedDOMElements = { "North": document.getElementById('led-North'), "West": document.getElementById('led-West'), "East": document.getElementById('led-East'), "South": document.getElementById('led-South') };
    const helpButton = document.getElementById('helpButton');
    const helpModal = document.getElementById('help-modal');
    const competitiveModeBtn = document.getElementById('competitive-mode-btn');
    const coopModeBtn = document.getElementById('coop-mode-btn');
    const closeHelpBtn = document.getElementById('close-help-btn');
    const modeDescriptionEl = document.getElementById('mode-description');


    // --- Game Configuration ---
    const MAX_PLAYERS = 4;
    const ledNames = ["North", "West", "East", "South"];
    const keyboardControls = { P1: { "ArrowUp": "North", "ArrowLeft": "West", "ArrowRight": "East", "ArrowDown": "South" }, P2: { "w": "North", "a": "West", "d": "East", "s": "South" } };
    const gamepadButtonMapping = { 3: "North", 2: "West", 1: "East", 0: "South" }; // Y/△, X/□, B/O, A/X
    const gamepadPauseButtonIndex = 9;
    const COOP_MISSES_TO_DROPOUT = 3;

    // --- Game State ---
    let players = [], gamepads = {}, lastGamepadButtonStates = {}, assignedInputs = new Set();
    let paused = false, appStartTime = Date.now(), activeGameTime = 0, lastFrameTime = Date.now();
    let gameMode = 'competitive'; // 'competitive' or 'cooperative'
    
    // Universal Prompt State
    let currentLedTarget = null, ledStartTime = null, ledTimerId = null;
    let globalLedTime = 1500, totalPrompts = 0;

    // --- Theme Logic ---
    const setTheme = (theme) => { document.body.classList.toggle('dark-mode', theme === 'dark'); themeToggleButton.textContent = theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'; localStorage.setItem('theme', theme); };
    setTheme(localStorage.getItem('theme') || 'dark');
    themeToggleButton.addEventListener('click', () => setTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark'));

    // --- Statistics Helper Functions ---
    function formatDecimal(value, places = 0) { return (typeof value === 'number' && !isNaN(value)) ? value.toFixed(places) : "N/A"; }
    function getFastest(times) { return times.length ? Math.min(...times) : NaN; }
    function getSlowest(times) { return times.length ? Math.max(...times) : NaN; }
    function getAverage(times) { return times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN; }
    function getAccuracy(correct, total) { return total > 0 ? (correct / total) * 100 : NaN; }
    function getPromptRatio(correct, prompts) { return prompts > 0 ? (correct / prompts) * 100 : NaN; }

    // --- Player Factory & UI Creation ---
    function createPlayer(id, controlSource) {
        const player = {
            id, controlSource, reactionTimes: [], correctPresses: 0, wrongPresses: 0, totalPresses: 0,
            streak: 0, longestStreak: 0, missedPrompts: 0, ui: {},
            // Co-op specific state
            isActive: true, consecutiveMisses: 0, coop_CorrectlyPressed: false,
        };
        const statsDiv = document.createElement('div');
        statsDiv.className = 'player-stats'; statsDiv.id = `player-${id}`;
        statsDiv.innerHTML = `
            <h3 class="player-header">Player ${id} (${controlSource})</h3>
            <div class="stats-grid">
                <p>Correct: <span class="stat-correct stat-highlight">0</span></p>
                <p>Accuracy: <span class="stat-accuracy">N/A</span></p>
                <p>Wrong: <span class="stat-wrong">0</span></p>
                <p>Missed: <span class="stat-missed">0</span></p>
                <p>Streak: <span class="stat-streak">0</span> (Max: <span class="stat-max-streak">0</span>)</p>
                <p>Prompt Ratio: <span class="stat-prompt-ratio">N/A</span></p>
                <p>Avg: <span class="stat-avg">N/A</span> ms</p>
                <p>Fastest: <span class="stat-fastest">N/A</span> ms</p>
                <p>Slowest: <span class="stat-slowest">N/A</span> ms</p>
            </div>`;
        playersStatsContainer.appendChild(statsDiv);
        
        player.ui = Object.fromEntries([...statsDiv.querySelectorAll('span[class^="stat-"]')].map(el => {
            const statClass = [...el.classList].find(c => c.startsWith('stat-'));
            const key = statClass.substring(5).replace('-streak', '').replace('-ratio','');
            return [key, el];
        }));
        return player;
    }

    // --- Game Logic ---
    function pickAndDisplayNewLed() {
        if (paused) return;

        // In co-op mode, check if there are any active players left
        if (gameMode === 'cooperative') {
            const activePlayers = players.filter(p => p.isActive);
            if (activePlayers.length === 0 && players.length > 0) {
                globalMessageEl.textContent = "All players dropped! Press a key to rejoin.";
                if (currentLedTarget) visualLedDOMElements[currentLedTarget].classList.remove('active');
                currentLedTarget = null;
                clearTimeout(ledTimerId);
                return; // Stop the game loop
            }
            players.forEach(p => p.coop_CorrectlyPressed = false);
        }
        
        if (players.length === 0) return;

        Object.values(visualLedDOMElements).forEach(el => el.classList.remove('active'));
        totalPrompts++;
        currentLedTarget = ledNames[Math.floor(Math.random() * ledNames.length)];
        visualLedDOMElements[currentLedTarget].classList.add('active');
        ledStartTime = Date.now();
        if (ledTimerId) clearTimeout(ledTimerId);
        ledTimerId = setTimeout(handleTimeout, globalLedTime);
    }

    function handleTimeout() {
        if (!currentLedTarget) return; // Already answered
        visualLedDOMElements[currentLedTarget].classList.remove('active');
        
        if (gameMode === 'competitive') {
            players.forEach(p => { p.missedPrompts++; p.streak = 0; });
            globalLedTime = Math.min(2500, globalLedTime + 75); // Make it easier after a group miss
        } else if (gameMode === 'cooperative') {
            players.forEach(p => {
                if (p.isActive && !p.coop_CorrectlyPressed) {
                    p.missedPrompts++;
                    p.consecutiveMisses++;
                    if (p.consecutiveMisses >= COOP_MISSES_TO_DROPOUT) {
                        p.isActive = false;
                    }
                } else if (!p.isActive) {
                    p.missedPrompts++; // Inactive players still accumulate misses
                }
            });
            // Don't adjust time drastically in co-op, keep it consistent
        }
        
        currentLedTarget = null;
        pickAndDisplayNewLed();
    }
    
    function processPlayerInput(player, direction) {
        // Handle rejoining if inactive (applies mainly to co-op)
        if (!player.isActive) {
            player.isActive = true;
            player.consecutiveMisses = 0;
            // If rejoining wakes up the game
            if (players.filter(p => p.isActive).length === 1 && !currentLedTarget) {
                 setTimeout(pickAndDisplayNewLed, 200);
            }
        }
        
        if (paused || !currentLedTarget) return;

        player.totalPresses++;

        if (gameMode === 'competitive') {
            // --- COMPETITIVE LOGIC ---
            if (currentLedTarget === direction) {
                const reaction = Date.now() - ledStartTime;
                player.reactionTimes.push(reaction);
                player.correctPresses++;
                player.streak++;
                if (player.streak > player.longestStreak) player.longestStreak = player.streak;
                globalLedTime = Math.max(250, globalLedTime - 30);
                visualLedDOMElements[currentLedTarget].classList.remove('active');
                currentLedTarget = null;
                clearTimeout(ledTimerId);
                setTimeout(pickAndDisplayNewLed, 200);
            } else {
                player.wrongPresses++;
                player.streak = 0;
                globalLedTime = Math.min(2500, globalLedTime + 50);
            }
        } else if (gameMode === 'cooperative') {
            // --- CO-OP LOGIC ---
            if (player.coop_CorrectlyPressed) return; // Already got it this round

            if (currentLedTarget === direction) {
                const reaction = Date.now() - ledStartTime;
                player.reactionTimes.push(reaction); // Still log individual times
                player.correctPresses++;
                player.consecutiveMisses = 0; // Reset consecutive misses on a correct press
                player.coop_CorrectlyPressed = true;
                
                // Check if all *active* players have now pressed the correct button
                const activePlayers = players.filter(p => p.isActive);
                const allActivePressed = activePlayers.every(p => p.coop_CorrectlyPressed);
                
                if (allActivePressed) {
                    visualLedDOMElements[currentLedTarget].classList.remove('active');
                    currentLedTarget = null;
                    clearTimeout(ledTimerId);
                    setTimeout(pickAndDisplayNewLed, 200);
                }
            } else {
                player.wrongPresses++; // Wrong presses are just logged, no other penalty
            }
        }
    }
    
    // --- UI Update ---
    function updateUI() {
        const modeText = gameMode.charAt(0).toUpperCase() + gameMode.slice(1);
        if (players.length === 0) globalMessageEl.textContent = `[${modeText}] Press a Button to Join!`;
        else if (paused && !helpModal.classList.contains('hidden')) globalMessageEl.textContent = "HELP MENU OPEN";
        else if (paused) globalMessageEl.textContent = "GAME PAUSED";
        else globalMessageEl.textContent = "";

        players.forEach(p => {
            p.ui.correct.textContent = p.correctPresses;
            p.ui.wrong.textContent = p.wrongPresses;
            p.ui.missed.textContent = p.missedPrompts;
            p.ui.streak.textContent = (gameMode === 'competitive') ? p.streak : 'N/A';
            p.ui.max.textContent = (gameMode === 'competitive') ? p.longestStreak : 'N/A';
            p.ui.accuracy.textContent = `${formatDecimal(getAccuracy(p.correctPresses, p.totalPresses), 2)}%`;
            const promptRatioText = `${p.correctPresses}/${totalPrompts} (${formatDecimal(getPromptRatio(p.correctPresses, totalPrompts), 1)}%)`;
            p.ui.prompt.textContent = promptRatioText;
            p.ui.avg.textContent = formatDecimal(getAverage(p.reactionTimes));
            p.ui.fastest.textContent = formatDecimal(getFastest(p.reactionTimes));
            p.ui.slowest.textContent = formatDecimal(getSlowest(p.reactionTimes));
            
            const playerDiv = document.getElementById(`player-${p.id}`);
            if (playerDiv) {
                playerDiv.classList.toggle('inactive-player', gameMode === 'cooperative' && !p.isActive);
            }
        });
        globalStatsArea.innerHTML = `<span>Mode: ${modeText}</span> | <span>Active Time: ${Math.floor(activeGameTime)}s</span> | <span>Window: ${globalLedTime}ms</span>`;
    }

    // --- Player Joining Logic ---
    function handleJoinAttempt(inputType, inputKey, details) {
        if (players.length >= MAX_PLAYERS || assignedInputs.has(inputKey)) return;
        const wasFirstPlayer = players.length === 0;
        const newPlayerId = players.length + 1;
        let controlSource = '';
        if (inputType === 'keyboard') {
            Object.keys(keyboardControls[details.set]).forEach(key => assignedInputs.add(`keyboard_${key}`));
            controlSource = `Keyboard ${details.set}`;
        } else if (inputType === 'gamepad') {
            Object.keys(gamepadButtonMapping).forEach(buttonIndex => assignedInputs.add(`gamepad${details.index}_button${buttonIndex}`));
            controlSource = `Gamepad ${details.index}`;
        }
        const newPlayer = createPlayer(newPlayerId, controlSource);
        players.push(newPlayer);
        if (wasFirstPlayer && !paused && !currentLedTarget) pickAndDisplayNewLed();
    }

    // --- Event Handlers & Game Controls ---
    function handleKeyDown(event) {
        const key = event.key; if (event.repeat) return;
        if (key === 'r') return resetGame();
        
        if (key === 'h' || (key === 'Escape' && !helpModal.classList.contains('hidden'))) {
            toggleHelpMenu();
            return;
        }

        if (helpModal.classList.contains('hidden')) { // Only process game inputs if help is closed
            if (key === ' ') return togglePause();
            const inputId = `keyboard_${key}`;
            if (assignedInputs.has(inputId)) {
                players.forEach(p => {
                    if (p.controlSource.startsWith("Keyboard")) {
                       const set = p.controlSource.split(' ')[1];
                       if (keyboardControls[set]?.[key]) processPlayerInput(p, keyboardControls[set][key]);
                    }
                });
            } else {
                Object.entries(keyboardControls).forEach(([set, controls]) => {
                    if (Object.keys(controls).includes(key)) {
                        const isSetTaken = Object.keys(controls).some(k => assignedInputs.has(`keyboard_${k}`));
                        if (!isSetTaken) handleJoinAttempt('keyboard', inputId, { set });
                    }
                });
            }
        }
    }

    function handleGamepadInput() {
        if (helpModal.classList.contains('hidden')) { // Only process game inputs if help is closed
            const polledPads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < polledPads.length; i++) {
                const pad = polledPads[i]; if (!pad) continue;
                if (pad.buttons[gamepadPauseButtonIndex].pressed && !lastGamepadButtonStates[i]?.[gamepadPauseButtonIndex]) togglePause();
                for (const buttonIndex in gamepadButtonMapping) {
                    const direction = gamepadButtonMapping[buttonIndex];
                    if (pad.buttons[buttonIndex].pressed && !lastGamepadButtonStates[i]?.[buttonIndex]) {
                        const inputId = `gamepad${i}_button${buttonIndex}`;
                        if (assignedInputs.has(inputId)) {
                            const player = players.find(p => p.controlSource === `Gamepad ${i}`);
                            if (player) processPlayerInput(player, direction);
                        } else {
                            const isPadTaken = players.some(p => p.controlSource === `Gamepad ${i}`);
                            if (!isPadTaken) handleJoinAttempt('gamepad', inputId, { index: i });
                        }
                    }
                }
                lastGamepadButtonStates[i] = pad.buttons.map(b => b.pressed);
            }
        }
    }

    function togglePause(forceState) {
        paused = (typeof forceState === 'boolean') ? forceState : !paused;
        if (paused) {
            clearTimeout(ledTimerId);
            if (currentLedTarget) visualLedDOMElements[currentLedTarget].classList.remove('active');
        } else {
            lastFrameTime = Date.now();
            if (!currentLedTarget && players.length > 0) pickAndDisplayNewLed();
        }
    }

    function resetGame() {
        togglePause(false); // Ensure game is not paused
        clearTimeout(ledTimerId);
        Object.values(visualLedDOMElements).forEach(el => el.classList.remove('active'));
        players = []; assignedInputs.clear(); playersStatsContainer.innerHTML = '';
        activeGameTime = 0; appStartTime = Date.now();
        currentLedTarget = null; ledStartTime = null; totalPrompts = 0; globalLedTime = 1500;
    }

    // --- Help Menu & Mode Switching ---
    function setGameMode(mode) {
        if (gameMode === mode) return;
        gameMode = mode;
        competitiveModeBtn.classList.toggle('active', mode === 'competitive');
        coopModeBtn.classList.toggle('active', mode === 'cooperative');
        const competitiveDesc = `<h3>Competitive Mode (Default)</h3><p>Be the first player to hit the correct button to score a point. The game speeds up on correct hits and slows down on misses. It's a race!</p>`;
        const coopDesc = `<h3>Co-op Mode</h3><p>All active players must press the correct button before the timer runs out. If successful, a new prompt appears. If the timer runs out, anyone who didn't press gets a "Miss".</p><p><strong>Dropout:</strong> Miss ${COOP_MISSES_TO_DROPOUT} prompts in a row (by timeout) and you will be dropped out. You can rejoin at any time by pressing one of your buttons.</p>`;
        modeDescriptionEl.innerHTML = (mode === 'competitive') ? competitiveDesc : coopDesc;
        resetGame();
    }

    function toggleHelpMenu() {
        const isHidden = helpModal.classList.contains('hidden');
        if (isHidden) { // Opening menu
            helpModal.classList.remove('hidden');
            if (!paused) togglePause(true); // Pause the game
        } else { // Closing menu
            helpModal.classList.add('hidden');
            togglePause(false); // Unpause the game
        }
    }

    // --- Gamepad Connection & Main Loop ---
    function updateGamepadStatus() { const any = Object.values(navigator.getGamepads()).some(p => p); gamepadStatusEl.textContent = any ? 'Gamepad: Connected' : 'Gamepad: Not Detected'; gamepadStatusEl.className = any ? 'connected' : 'disconnected'; }
    window.addEventListener("gamepadconnected", e => { gamepads[e.gamepad.index] = e.gamepad; updateGamepadStatus(); });
    window.addEventListener("gamepaddisconnected", e => { delete gamepads[e.gamepad.index]; updateGamepadStatus(); });

    function gameLoop() {
        const now = Date.now();
        if (!paused) {
            handleGamepadInput();
            activeGameTime += (now - lastFrameTime) / 1000;
        }
        lastFrameTime = now;
        updateUI();
        requestAnimationFrame(gameLoop);
    }
    
    // --- Initialization ---
    document.addEventListener('keydown', handleKeyDown);
    helpButton.addEventListener('click', toggleHelpMenu);
    closeHelpBtn.addEventListener('click', toggleHelpMenu);
    competitiveModeBtn.addEventListener('click', () => setGameMode('competitive'));
    coopModeBtn.addEventListener('click', () => setGameMode('cooperative'));

    updateGamepadStatus(); updateUI(); gameLoop();
});
