/**
 * Utility to manage keyboard navigation for menus.
 */

let currentFocusedIndex = -1;
let currentButtons = [];

/**
 * Scan a container for buttons and enable keyboard navigation.
 * @param {string} containerId The ID of the HTML container holding the buttons.
 * @param {number} initialIndex Which button to focus first (default 0).
 */
export function setupMenuNavigation(containerId, initialIndex = 0) {
    const container = document.getElementById(containerId);
    if (!container) {
        currentButtons = [];
        currentFocusedIndex = -1;
        return;
    }

    // Get all buttons that are actually part of the menu actions
    // We filter for buttons that are visible and not disabled
    currentButtons = Array.from(container.querySelectorAll('button'))
        .filter(btn => {
            const style = window.getComputedStyle(btn);
            return style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled;
        });
    
    clearMenuFocus();

    if (currentButtons.length > 0) {
        currentFocusedIndex = initialIndex;
        updateFocus();
    }
}

/**
 * Remove focus from all tracked buttons.
 */
export function clearMenuFocus() {
    currentButtons.forEach(btn => btn.classList.remove('focused'));
    currentFocusedIndex = -1;
}

/**
 * Updates the visual focused state of buttons.
 */
function updateFocus() {
    currentButtons.forEach((btn, idx) => {
        if (idx === currentFocusedIndex) {
            btn.classList.add('focused');
        } else {
            btn.classList.remove('focused');
        }
    });
}

/**
 * Handle keyboard input for menu navigation.
 * @param {string} key The keyboard key pressed.
 * @returns {boolean} True if the input was handled.
 */
export function handleMenuInput(key) {
    if (currentButtons.length === 0) return false;

    const k = key.toLowerCase();

    // If nothing is focused, any navigation key starts it at the first button
    if (currentFocusedIndex === -1) {
        if (k === 'w' || key === 'ArrowUp' || k === 's' || key === 'ArrowDown') {
            currentFocusedIndex = 0;
            updateFocus();
            return true;
        }
        return false;
    }

    if (k === 'w' || key === 'ArrowUp') {
        currentFocusedIndex = (currentFocusedIndex - 1 + currentButtons.length) % currentButtons.length;
        updateFocus();
        return true;
    }
    if (k === 's' || key === 'ArrowDown') {
        currentFocusedIndex = (currentFocusedIndex + 1) % currentButtons.length;
        updateFocus();
        return true;
    }
    if (key === 'Enter' || (key === ' ' && !isGamePlaying())) {
        // We only allow Space to click if the game isn't running (since Space is Boost)
        if (currentFocusedIndex >= 0 && currentFocusedIndex < currentButtons.length) {
            currentButtons[currentFocusedIndex].click();
            return true;
        }
    }
    return false;
}

// Helper to check if we are in gameplay (to avoid Spacebar conflicts)
function isGamePlaying() {
    const hud = document.getElementById('hud');
    if (!hud || hud.classList.contains('hidden')) return false;

    // If any major menu overlay is visible, we are NOT in active gameplay
    const pauseMenu = document.getElementById('pause-menu');
    const gameOver = document.getElementById('game-over');
    const mainMenu = document.getElementById('main-menu');

    if (pauseMenu && pauseMenu.classList.contains('show')) return false;
    if (gameOver && gameOver.classList.contains('show')) return false;
    // Main menu might use display flex/none instead of .show class
    if (mainMenu && window.getComputedStyle(mainMenu).display !== 'none') return false;

    return true;
}
