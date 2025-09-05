document.addEventListener('DOMContentLoaded', () => {
    // --- Theme Toggle Logic ---
    const themeToggleButton = document.getElementById('themeToggle');
    const bodyElement = document.body;

    const setTheme = (theme) => {
        if (theme === 'dark') {
            bodyElement.classList.add('dark-mode');
            themeToggleButton.textContent = '🌙 Dark Mode';
            localStorage.setItem('theme', 'dark');
        } else {
            bodyElement.classList.remove('dark-mode');
            themeToggleButton.textContent = '☀️ Light Mode';
            localStorage.setItem('theme', 'light');
        }
    };

    const currentTheme = localStorage.getItem('theme');
    setTheme(currentTheme || 'dark'); // Default to dark mode

    themeToggleButton.addEventListener('click', () => {
        setTheme(bodyElement.classList.contains('dark-mode') ? 'light' : 'dark');
    });

    // --- LockKeyReaction Game Logic ---

    // --- DOM Element References ---
    const statLine1 = document.getElementById('stat-line1');
    const statLine2 = document.getElementById('stat-line2');
    const statLine3 = document.getElementById('stat-line3');
    const statLine4 = document.getElementById('stat-line4');
    const statLine5 = document.getElementById('stat-line5');
    const statLine6 = document.getElementById('stat-line6');
    const statLine7 = document.getElementById('stat-line7');
    const statLine8 = document.getElementById('stat-line8');
    const statLine9 = document.getElementById('stat-line9');
    const statLine10 = document.getElementById('stat-line10');
    const statCurrentLedTarget = document.getElementById('stat-current-led-target');
    const gamepadStatusEl = document.getElementById('gamepad-status');

    const ledVisualDOMElements = {
        "Num_Lock": document.getElementById('led-Num_Lock'),
        "Caps_Lock": document.getElementById('led-Caps_Lock'),
        "Scroll_Lock": document.getElementById('led-Scroll_Lock')
    };

    const pauseMessageEl = document.getElementById('pause-message');
    const currentPromptMessageEl = document.getElementById('current-prompt-message');

    // --- Game State Variables ---
    const ledMapping = { "Num_Lock": "ArrowLeft", "Caps_Lock": "ArrowDown", "Scroll_Lock": "ArrowRight" };
    const ledNames = Object.keys(ledMapping);
    const promptDetails = {
        "Num_Lock":    { key: "LEFT",   gamepad: "West Button (X / □)" },
        "Caps_Lock":   { key: "DOWN",   gamepad: "South Button (A / X)" },
        "Scroll_Lock": { key: "RIGHT",  gamepad: "East Button (B / O)" }
    };
    
    let currentLedName = null, ledTimerId = null, ledStartTime = null;
    let ledReactionTimes = [], ledCorrectPresses = 0, ledWrongPresses = 0, ledTotalPresses = 0;
    let ledTime = 1000, ledMissedPrompts = 0, currentStreak = 0, longestStreak = 0, ledTotalPrompts = 0;
    let paused = true, pauseStartTime = null;
    let appStartTime = Date.now(), totalPauseDuration = 0, activeGameTime = 0, lastFrameTime = Date.now();
    const keysDown = new Set();
    
    // --- NEW: Gamepad State ---
    let gamepads = {};
    let lastGamepadButtonState = [];
    const gamepadButtonMapping = {
        2: "ArrowLeft",   // West (X/Square)
        0: "ArrowDown",   // South (A/Cross)
        1: "ArrowRight",  // East (B/Circle)
    };
    const gamepadPauseButtonIndex = 9; // Start/Options button

    // --- Helper Functions (Statistics) ---
    function formatDecimal(value, places = 2) {
        return (typeof value === 'number' && !isNaN(value)) ? value.toFixed(places) : "N/A";
    }
    function getLedFastest() { return ledReactionTimes.length ? formatDecimal(Math.min(...ledReactionTimes)) : "N/A"; }
    function getLedSlowest() { return ledReactionTimes.length ? formatDecimal(Math.max(...ledReactionTimes)) : "N/A"; }
    function getLedAverage() {
        if (!ledReactionTimes.length) return "N/A";
        return formatDecimal(ledReactionTimes.reduce((a, b) => a + b, 0) / ledReactionTimes.length);
    }
    function getLedMedian() {
        if (!ledReactionTimes.length) return "N/A";
        const sorted = [...ledReactionTimes].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return formatDecimal(sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    function getLedStdev() {
        if (ledReactionTimes.length < 2) return "N/A";
        const n = ledReactionTimes.length;
        const mean = ledReactionTimes.reduce((a, b) => a + b, 0) / n;
        const variance = ledReactionTimes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
        return formatDecimal(Math.sqrt(variance));
    }
    function getLedPercentile(p) {
        if (!ledReactionTimes.length) return "N/A";
        const sorted = [...ledReactionTimes].sort((a, b) => a - b);
        const k = (sorted.length - 1) * (p / 100);
        const f = Math.floor(k), c = Math.min(f + 1, sorted.length - 1);
        if (f === c) return formatDecimal(sorted[Math.trunc(k)]);
        return formatDecimal(sorted[f] * (c - k) + sorted[c] * (k - f));
    }
    function getLedAccuracy() {
        return ledTotalPresses > 0 ? `${formatDecimal((ledCorrectPresses / ledTotalPresses) * 100)}%` : "N/A";
    }
    function getLedPromptRatio() {
        if (ledTotalPrompts <= 0) return "N/A";
        const ratio = (ledCorrectPresses / ledTotalPrompts) * 100;
        return `${ledCorrectPresses}/${ledTotalPrompts} (${formatDecimal(ratio)}%)`;
    }

    // --- Game Logic ---
    function turnOffAllVisualLeds() {
        Object.values(ledVisualDOMElements).forEach(el => el.classList.remove('active'));
    }
    function activateVisualLed(ledName) {
        if (ledVisualDOMElements[ledName]) ledVisualDOMElements[ledName].classList.add('active');
    }
    function decreaseLedTime(current) {
        if (current > 100) return Math.max(1, current - 5);
        if (current > 50) return Math.max(1, current - 2);
        return Math.max(1, current - 1);
    }
    function setNewLedTimer() {
        if (ledTimerId) clearTimeout(ledTimerId);
        ledTimerId = setTimeout(handleNewLedEventDueToTimeout, ledTime);
    }
    function handleNewLedEventDueToTimeout() {
        turnOffAllVisualLeds();
        if (currentLedName !== null) {
            ledMissedPrompts++;
            currentStreak = 0;
            ledTime = decreaseLedTime(ledTime);
        }
        pickAndDisplayNewLed();
    }
    function pickAndDisplayNewLed() {
        currentLedName = ledNames[Math.floor(Math.random() * ledNames.length)];
        activateVisualLed(currentLedName);
        ledStartTime = Date.now();
        ledTotalPrompts++;
        setNewLedTimer();
        updateUI();
    }
    function resetGame() {
        currentLedName = null;
        if (ledTimerId) clearTimeout(ledTimerId);
        ledTimerId = null;
        ledReactionTimes = [], ledCorrectPresses = 0, ledWrongPresses = 0, ledTotalPresses = 0;
        ledTime = 1000, ledMissedPrompts = 0, currentStreak = 0, longestStreak = 0, ledTotalPrompts = 0;
        paused = true;
        pauseStartTime = Date.now();
        totalPauseDuration = 0, activeGameTime = 0, lastFrameTime = Date.now();
        keysDown.clear();
        turnOffAllVisualLeds();
        updateUI();
    }

    // --- UI Update Function ---
    function updateUI() {
        statLine1.textContent = `Total Inputs: ${ledTotalPresses} (Wrong: ${ledWrongPresses})`;
        statLine2.textContent = `Successful Inputs: ${ledCorrectPresses} | Accuracy: ${getLedAccuracy()} | Prompts: ${ledTotalPrompts} (Prompt Ratio: ${getLedPromptRatio()})`;
        statLine3.textContent = `Fastest: ${getLedFastest()} ms | Slowest: ${getLedSlowest()} ms | Average: ${getLedAverage()} ms`;
        statLine4.textContent = `Median: ${getLedMedian()} ms | Stdev: ${getLedStdev()} ms`;
        statLine5.textContent = `25th Percentile: ${getLedPercentile(25)} ms | 75th Percentile: ${getLedPercentile(75)} ms`;
        statLine6.textContent = `Current Streak: ${currentStreak} | Longest Streak: ${longestStreak}`;
        statLine7.textContent = `Missed Prompts: ${ledMissedPrompts}`;
        statLine8.textContent = `Reaction Time Window: ${ledTime} ms`;
        statLine9.textContent = `Active Game Time: ${Math.floor(activeGameTime)} s`;
        statLine10.textContent = `Overall Session Time: ${Math.floor((Date.now() - appStartTime) / 1000)} s`;
        statCurrentLedTarget.textContent = `Target LED Name: ${currentLedName || "N/A"}`;

        if (paused) {
            pauseMessageEl.textContent = "GAME PAUSED. Press SPACE / Gamepad Start to resume.";
            currentPromptMessageEl.textContent = "";
            turnOffAllVisualLeds();
        } else {
            pauseMessageEl.textContent = "Press SPACE / Gamepad Start to Pause.";
            if (currentLedName) {
                const details = promptDetails[currentLedName];
                currentPromptMessageEl.textContent = `Target: ${details.key} ARROW / ${details.gamepad}`;
            } else {
                currentPromptMessageEl.textContent = "Waiting for next LED...";
            }
        }
    }

    // --- Central Input Processing & Pause Logic ---
    function processPlayerInput(activatedKeyOrLedName) {
        if (paused || !currentLedName) return;
        ledTotalPresses++;
        const reaction = Date.now() - ledStartTime;

        const inputMatchesTarget = (ledMapping[currentLedName] === activatedKeyOrLedName || currentLedName === activatedKeyOrLedName);

        if (inputMatchesTarget) {
            if (reaction <= ledTime) {
                ledReactionTimes.push(reaction);
                ledCorrectPresses++;
                currentStreak++;
                if (currentStreak > longestStreak) longestStreak = currentStreak;
                ledTime = decreaseLedTime(ledTime);
            } else {
                ledMissedPrompts++;
                currentStreak = 0;
            }
        } else {
            ledWrongPresses++;
            ledMissedPrompts++;
            currentStreak = 0;
        }
        turnOffAllVisualLeds();
        currentLedName = null;
        if (ledTimerId) clearTimeout(ledTimerId);
        ledTimerId = null;
        setTimeout(pickAndDisplayNewLed, 100);
        updateUI();
    }

    function togglePause() {
        paused = !paused;
        if (paused) {
            if (currentLedName) turnOffAllVisualLeds();
            currentLedName = null;
            if (ledTimerId) clearTimeout(ledTimerId);
            ledTimerId = null;
            pauseStartTime = Date.now();
        } else {
            if (pauseStartTime) totalPauseDuration += (Date.now() - pauseStartTime) / 1000;
            lastFrameTime = Date.now();
            turnOffAllVisualLeds();
            currentLedName = null;
            if (ledTimerId) clearTimeout(ledTimerId);
            ledTimerId = null;
            setTimeout(pickAndDisplayNewLed, 100);
        }
        updateUI();
    }
    
    // --- Event Handlers ---
    function handleKeyDown(event) {
        if (keysDown.has(event.key)) return;
        keysDown.add(event.key);

        if (event.key.toLowerCase() === 'r') resetGame();
        else if (event.key === ' ') { event.preventDefault(); togglePause(); }
        else if (Object.values(ledMapping).includes(event.key)) processPlayerInput(event.key);
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', (event) => keysDown.delete(event.key));
    Object.entries(ledVisualDOMElements).forEach(([ledDomName, element]) => {
        element.addEventListener('click', () => processPlayerInput(ledDomName));
    });

    // --- NEW: Gamepad Input Handler ---
    function handleGamepadInput() {
        const polledPads = navigator.getGamepads ? navigator.getGamepads() : [];
        if (!polledPads[0]) return; // Only process the first connected gamepad

        const pad = polledPads[0];

        // Process action buttons
        for (const index in gamepadButtonMapping) {
            if (pad.buttons[index].pressed && !lastGamepadButtonState[index]) {
                processPlayerInput(gamepadButtonMapping[index]);
            }
        }

        // Process pause button
        if (pad.buttons[gamepadPauseButtonIndex].pressed && !lastGamepadButtonState[gamepadPauseButtonIndex]) {
            togglePause();
        }

        // Update the state for the next frame
        lastGamepadButtonState = pad.buttons.map(b => b.pressed);
    }
    
    // --- Game Loop (for time and gamepad updates) ---
    function gameLoop() {
        const now = Date.now();
        const dt = (now - lastFrameTime) / 1000.0;
        lastFrameTime = now;

        if (!paused) {
            activeGameTime += dt;
            handleGamepadInput(); // Poll for gamepad input when not paused
        }

        updateUI();
        requestAnimationFrame(gameLoop);
    }

    // --- NEW: Gamepad Connection Listeners ---
    function updateGamepadStatus() {
        const anyConnected = Object.keys(gamepads).length > 0;
        if(anyConnected){
            gamepadStatusEl.textContent = `Gamepad: ${gamepads[Object.keys(gamepads)[0]].id}`;
            gamepadStatusEl.className = 'connected';
        } else {
            gamepadStatusEl.textContent = 'Gamepad: Not Detected';
            gamepadStatusEl.className = 'disconnected';
        }
    }

    window.addEventListener("gamepadconnected", e => {
        console.log(`Gamepad connected at index ${e.gamepad.index}: ${e.gamepad.id}.`);
        gamepads[e.gamepad.index] = e.gamepad;
        lastGamepadButtonState = e.gamepad.buttons.map(() => false); // Initialize button state
        updateGamepadStatus();
    });

    window.addEventListener("gamepaddisconnected", e => {
        console.log(`Gamepad disconnected from index ${e.gamepad.index}: ${e.gamepad.id}.`);
        delete gamepads[e.gamepad.index];
        lastGamepadButtonState = [];
        updateGamepadStatus();
    });
    
    // --- Initialization ---
    resetGame();
    updateGamepadStatus();
    requestAnimationFrame(gameLoop);
});
