const STORAGE_KEY = 'stellarRushSettings';

const defaultSettings = {
    preset: 'High',
    fpsEnabled: false, // Will be updated to match DEVELOPMENT_MODE in main.js if not set
    fov: 60
};

let currentSettings = { ...defaultSettings };

try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        const parsed = JSON.parse(stored);
        currentSettings = { ...defaultSettings, ...parsed };
    }
} catch (e) {
    console.warn("Failed to load settings from localStorage:", e);
}

export const settings = currentSettings;

export function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn("Failed to save settings to localStorage:", e);
    }
}
