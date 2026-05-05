import * as THREE from 'three';
import { DEVELOPMENT_MODE } from './config.js';

let isUpgradesActive = false;
export function isUpgradesOpen() { return isUpgradesActive; }
let returnCallback = null;
let hiddenSceneObjects = [];
let wasHudVisible = false;

// Base data
const UPGRADES_DB = [
    // Engine
    { id: 'eng1', category: 'engine', name: '+15% Fuel', emoji: '⛽', w: 1, h: 1, cost: 5000, desc: 'Increases fuel tank capacity by 15%.' },
    { id: 'eng2', category: 'engine', name: '+10% Accel', emoji: '⚡', w: 1, h: 1, cost: 5000, desc: 'Increases base handling by 10%. ' },
    { id: 'eng3', category: 'engine', name: '+30% Fuel', emoji: '⛽', w: 1, h: 3, cost: 15000, desc: 'Increases fuel tank capacity by 30%.' },
    { id: 'eng4', category: 'engine', name: 'Eff. Boost', emoji: '🍃', w: 3, h: 1, cost: 15000, desc: 'Boosting uses half the extra fuel.' },
    { id: 'eng5', category: 'engine', name: '+25% Spd/Acc', emoji: '🚀', w: 2, h: 2, cost: 25000, desc: 'Increases base handling and top speed by 25%.' },
    { id: 'eng6', category: 'engine', name: 'Boost Power', emoji: '🔥', w: 1, h: 3, cost: 18000, desc: 'Increases boost acceleration and speed by 50%.' },
    
    // Economy
    { id: 'eco1', category: 'economy', name: '+20% Passive Credits', emoji: '📈', w: 1, h: 1, cost: 3000, desc: '+20% credits auto earned per second.' },
    { id: 'eco2', category: 'economy', name: 'Magnet', emoji: '🧲', w: 3, h: 1, cost: 12000, desc: 'Magnet (10 strength) attracts nearby pickups.' },
    { id: 'eco3', category: 'economy', name: 'Formation Bonus', emoji: '💎', w: 1, h: 3, cost: 15000, desc: '+50 credits for collecting every pickup in a formation.' },
    { id: 'eco4', category: 'economy', name: 'Mega Magnet', emoji: '🧲', w: 2, h: 2, cost: 20000, desc: 'Mega Magnet (15 strength) attracts nearby pickups.' },
    
    // Defense
    { id: 'def1', category: 'defense', name: '+5s Shield', emoji: '🛡️', w: 1, h: 1, cost: 6000, desc: 'Increases shield duration by 5 seconds.' },
    { id: 'def2', category: 'defense', name: '+5s Shield', emoji: '🛡️', w: 1, h: 1, cost: 6000, desc: 'Increases shield duration by 5 seconds.' },
    { id: 'def4', category: 'defense', name: 'Nav System', emoji: '📡', w: 3, h: 1, cost: 12000, desc: 'Projects a red light onto surfaces directly in front of the plane.' },
    { id: 'def5', category: 'defense', name: 'Perm. Shield', emoji: '💠', w: 2, h: 2, cost: 30000, desc: 'Infinite shield duration (still breaks on impact).' },
];

let selectedUpgrade = null;
let selectedLockIndex = -1;
let bankedCredits = 0;
let ownedUpgrades = [];
let equippedUpgrades = []; // { id, x, y }
let unlockedCellIndices = [];
let currentlyDraggingId = null;
let dragOffset = { x: 0, y: 0 };
const layoutCache = {};

function getCategoryLayout(cat) {
    if (layoutCache[cat]) return layoutCache[cat];
    const items = UPGRADES_DB.filter(u => u.category === cat);
    items.sort((a, b) => (a.w * a.h) - (b.w * b.h));
    
    const COLS = 4;
    const grid = [];
    const positions = {}; 
    
    const canPlace = (w, h, x, y) => {
        if (x + w > COLS) return false;
        for (let cy = y; cy < y + h; cy++) {
            if (!grid[cy]) grid[cy] = Array(COLS).fill(false);
            for (let cx = x; cx < x + w; cx++) {
                if (grid[cy][cx]) return false;
            }
        }
        return true;
    };
    
    const place = (w, h, x, y) => {
        for (let cy = y; cy < y + h; cy++) {
            if (!grid[cy]) grid[cy] = Array(COLS).fill(false);
            for (let cx = x; cx < x + w; cx++) {
                grid[cy][cx] = true;
            }
        }
    };
    
    items.forEach(u => {
        let placed = false;
        for (let y = 0; !placed; y++) {
            for (let x = 0; x <= COLS - u.w; x++) {
                if (canPlace(u.w, u.h, x, y)) {
                    place(u.w, u.h, x, y);
                    positions[u.id] = { x, y };
                    placed = true;
                    break;
                }
            }
        }
    });
    
    layoutCache[cat] = positions;
    return positions;
}

export function getBankedCredits() {
    if (DEVELOPMENT_MODE) return 999999;
    return parseInt(localStorage.getItem('bankedCredits') || '0', 10);
}

export function spendCredits(amount) {
    bankedCredits -= amount;
    localStorage.setItem('bankedCredits', bankedCredits.toString());
    updateBankDisplay();
}

function updateBankDisplay() {
    const el = document.getElementById('banked-credits-display');
    if (el) el.textContent = bankedCredits;
}

function loadProgress() {
    bankedCredits = getBankedCredits();
    try {
        ownedUpgrades = JSON.parse(localStorage.getItem('ownedUpgrades') || '[]');
        equippedUpgrades = JSON.parse(localStorage.getItem('equippedUpgrades') || '[]');
        unlockedCellIndices = JSON.parse(localStorage.getItem('unlockedCellIndices') || '[]');
    } catch (e) {
        ownedUpgrades = [];
        equippedUpgrades = [];
        unlockedCellIndices = [];
    }
    validateEquippedUpgrades();
}

function saveProgress() {
    localStorage.setItem('ownedUpgrades', JSON.stringify(ownedUpgrades));
    localStorage.setItem('equippedUpgrades', JSON.stringify(equippedUpgrades));
    localStorage.setItem('unlockedCellIndices', JSON.stringify(unlockedCellIndices));
}

function validateEquippedUpgrades() {
    let validEquipped = [];
    for (const eq of equippedUpgrades) {
        const u = UPGRADES_DB.find(upg => upg.id === eq.id);
        if (!u) continue; 
        
        if (eq.x < 0 || eq.y < 0 || eq.x + u.w > 6 || eq.y + u.h > 3) continue;

        const cells = getOccupiedCells(eq.id, eq.x, eq.y, u.w, u.h);
        
        let valid = true;
        for (let c of cells) {
            const cx = c % 6;
            if (cx >= 3 && !unlockedCellIndices.includes(c)) valid = false;
        }
        
        if (valid) {
            validEquipped.push(eq);
        }
    }
    if (validEquipped.length !== equippedUpgrades.length) {
        equippedUpgrades = validEquipped;
        saveProgress();
    }
}

export function getEquippedUpgrades() {
    loadProgress();
    return equippedUpgrades.map(eq => UPGRADES_DB.find(u => u.id === eq.id)).filter(Boolean);
}

export function enterUpgradesMenu(scene, camera, aircraft, onReturn) {
    if (isUpgradesActive) return;
    isUpgradesActive = true;
    returnCallback = onReturn;
    loadProgress();
    updateBankDisplay();

    // Create fade overlay
    const fade = document.createElement('div');
    fade.style.position = 'absolute';
    fade.style.inset = '0';
    fade.style.background = '#000';
    fade.style.opacity = '0';
    fade.style.transition = 'opacity 0.4s';
    fade.style.zIndex = '9999';
    fade.style.pointerEvents = 'none';
    document.body.appendChild(fade);

    // Fade to black
    requestAnimationFrame(() => {
        fade.style.opacity = '1';
        setTimeout(() => {
            // Hide UI
            document.getElementById('main-menu').style.display = 'none';
            document.getElementById('game-over').classList.remove('show');
            wasHudVisible = document.getElementById('hud').style.display !== 'none';
            document.getElementById('hud').style.display = 'none';

            // Hide scene objects (except stars and lights)
            hiddenSceneObjects = [];
            scene.children.forEach(c => {
                if (c.visible && c.type !== 'Points' && c.type !== 'DirectionalLight' && c.type !== 'AmbientLight') {
                    c.visible = false;
                    hiddenSceneObjects.push(c);
                }
            });

            initUpgradesUI();
            document.getElementById('upgrades-menu').style.display = 'block';

            // Fade back in
            fade.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(fade);
            }, 400);

        }, 400);
    });
}

export function exitUpgradesMenu(scene, camera) {
    if (!isUpgradesActive) return;

    const fade = document.createElement('div');
    fade.style.position = 'absolute';
    fade.style.inset = '0';
    fade.style.background = '#000';
    fade.style.opacity = '0';
    fade.style.transition = 'opacity 0.4s';
    fade.style.zIndex = '9999';
    fade.style.pointerEvents = 'none';
    document.body.appendChild(fade);

    requestAnimationFrame(() => {
        fade.style.opacity = '1';
        setTimeout(() => {
            document.getElementById('upgrades-menu').style.display = 'none';
            if (wasHudVisible) document.getElementById('hud').style.display = '';

            // Restore hidden objects
            hiddenSceneObjects.forEach(c => c.visible = true);
            hiddenSceneObjects = [];

            fade.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(fade);
                isUpgradesActive = false;
                if (returnCallback) returnCallback();
            }, 400);
        }, 400);
    });
}

function initUpgradesUI() {
    renderUpgradesLists();
}

function renderUpgradesLists() {
    const gridEl = document.getElementById('active-grid');
    gridEl.innerHTML = '';
    
    function clearAllDragOver() {
        Array.from(gridEl.children).forEach(c => c.classList.remove('drag-over', 'drag-invalid'));
    }

    // Create 18 grid cells (6x3)
    for (let i = 0; i < 18; i++) {
        const gridX = i % 6;
        const gridY = Math.floor(i / 6);
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;
        cell.style.gridColumn = `${gridX + 1}`;
        cell.style.gridRow = `${gridY + 1}`;
        
        const isLocked = gridX >= 3 && !unlockedCellIndices.includes(i);
        
        if (isLocked) {
            cell.innerHTML = '<span class="monochrome-emoji">🔒</span>';
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.style.fontSize = '1.59vw';
            cell.style.background = 'rgba(255, 0, 0, 0.05)';
            cell.style.borderColor = 'rgba(255, 0, 0, 0.2)';
            cell.style.cursor = 'pointer';
            
            if (i === selectedLockIndex) {
                cell.classList.add('selected');
            }

            cell.onclick = () => selectLockSpace(i);
        } else {
            cell.onclick = () => {
                const eq = equippedUpgrades.find(e => {
                    const def = UPGRADES_DB.find(upg => upg.id === e.id);
                    const cells = getOccupiedCells(e.id, e.x, e.y, def.w, def.h);
                    return cells.includes(i);
                });
                if (eq) {
                    const u = UPGRADES_DB.find(upg => upg.id === eq.id);
                    if (u) selectUpgrade(u);
                }
            };

            cell.draggable = true;
            cell.ondragstart = (e) => {
                const eq = equippedUpgrades.find(e => {
                    const def = UPGRADES_DB.find(upg => upg.id === e.id);
                    if (!def) return false;
                    const cells = getOccupiedCells(e.id, e.x, e.y, def.w, def.h);
                    return cells.includes(i);
                });
                if (eq) {
                    const u = UPGRADES_DB.find(upg => upg.id === eq.id);
                    if (u) {
                        selectUpgrade(u);
                        currentlyDraggingId = u.id;
                        const clickX = i % 6;
                        const clickY = Math.floor(i / 6);
                        dragOffset.x = clickX - eq.x;
                        dragOffset.y = clickY - eq.y;
                        
                        const visualItem = Array.from(gridEl.children).find(c => c.dataset.id === u.id);
                        if (visualItem) {
                            const CELL_FULL = window.innerWidth * 0.0397 + window.innerWidth * 0.0026; 
                            e.dataTransfer.setDragImage(visualItem, dragOffset.x * CELL_FULL + CELL_FULL * 0.47, dragOffset.y * CELL_FULL + CELL_FULL * 0.47);
                        }
                        
                        e.dataTransfer.setData('text/plain', u.id);
                    } else {
                        e.preventDefault();
                    }
                } else {
                    if (!currentlyDraggingId) e.preventDefault();
                }
            };
            
            cell.ondragover = (e) => {
                e.preventDefault();
                if (currentlyDraggingId) {
                    const u = UPGRADES_DB.find(upg => upg.id === currentlyDraggingId);
                    if (u) {
                        const targetX = gridX - dragOffset.x;
                        const targetY = gridY - dragOffset.y;
                        const isBoundsValid = (targetX >= 0 && targetY >= 0 && targetX + u.w <= 6 && targetY + u.h <= 3);
                        
                        let hasLocked = false;
                        if (isBoundsValid) {
                            for(let cy=targetY; cy<targetY+u.h; cy++){
                                for(let cx=targetX; cx<targetX+u.w; cx++){
                                    const tIdx = cy * 6 + cx;
                                    if (cx >= 3 && !unlockedCellIndices.includes(tIdx)) {
                                        hasLocked = true;
                                    }
                                }
                            }
                        }

                        const stateKey = `${currentlyDraggingId}_${targetX}_${targetY}`;
                        if (cell.dataset.lastHoverState === stateKey) return;
                        cell.dataset.lastHoverState = stateKey;
                        
                        clearAllDragOver();
                        
                        if (isBoundsValid && !hasLocked) {
                            for(let cy=targetY; cy<targetY+u.h; cy++){
                                for(let cx=targetX; cx<targetX+u.w; cx++){
                                    const targetIdx = cy * 6 + cx;
                                    const targetCell = gridEl.children[targetIdx];
                                    if (targetCell && targetCell.classList.contains('grid-cell')) {
                                        targetCell.classList.add('drag-over');
                                    }
                                }
                            }
                        } else if (isBoundsValid && hasLocked) {
                            for(let cy=targetY; cy<targetY+u.h; cy++){
                                for(let cx=targetX; cx<targetX+u.w; cx++){
                                    const targetIdx = cy * 6 + cx;
                                    const targetCell = gridEl.children[targetIdx];
                                    if (targetCell && targetCell.classList.contains('grid-cell')) {
                                        targetCell.classList.add('drag-invalid');
                                    }
                                }
                            }
                        }
                    }
                }
            };
            cell.ondragleave = () => { 
                delete cell.dataset.lastHoverState;
                clearAllDragOver(); 
            };
            cell.ondrop = (e) => { 
                delete cell.dataset.lastHoverState;
                clearAllDragOver(); 
                handleDrop(e, i); 
            };
        }
        
        gridEl.appendChild(cell);
    }

    // Place equipped items on top
    equippedUpgrades.forEach(eq => {
        const u = UPGRADES_DB.find(upg => upg.id === eq.id);
        if (u) {
            const item = document.createElement('div');
            item.className = `upgrade-item owned ${u.category}`;
            item.style.flexDirection = 'column';
            item.dataset.id = u.id;
            
            const nameEl = document.createElement('div');
            nameEl.className = 'upgrade-name';
            
            // Emoji Scaling logic
            let fs = 24;
            if (u.w === 1 && u.h === 1) fs = 20; // 0.8x
            else if ((u.w === 3 && u.h === 1) || (u.w === 1 && u.h === 3)) fs = 29; // 1.2x
            else if (u.w === 2 && u.h === 2) fs = 48; // 2.0x
            
            nameEl.style.fontSize = (fs / 1512 * 100).toFixed(2) + 'vw';
            nameEl.textContent = u.emoji;
            item.appendChild(nameEl);
            
            if (selectedUpgrade && u.id === selectedUpgrade.id) {
                item.classList.add('selected');
            }

            item.style.position = 'relative';
            item.style.gridColumn = `${eq.x + 1} / span ${u.w}`;
            item.style.gridRow = `${eq.y + 1} / span ${u.h}`;
            item.style.width = '100%';
            item.style.height = '100%';
            item.style.left = '0';
            item.style.top = '0';
            item.style.zIndex = '5'; // Below grid cells for event passthrough
            item.style.pointerEvents = 'none'; // Passthrough to grid cells
            
            gridEl.appendChild(item);
        }
    });

    // Populate available lists
    ['engine', 'economy', 'defense'].forEach(cat => {
        const colEl = document.getElementById(`available-list-${cat}`);
        if (!colEl) return;
        colEl.innerHTML = '';
        
        const catLayout = getCategoryLayout(cat);

        UPGRADES_DB.forEach(u => {
            if (u.category !== cat) return;
            const isOwned = ownedUpgrades.includes(u.id);
            const eqInfo = equippedUpgrades.find(eq => eq.id === u.id);
            const pos = catLayout[u.id];
            
            const container = document.createElement('div');
            container.className = 'upgrade-container';
            container.style.gridColumn = `${pos.x + 1} / span ${u.w}`;
            container.style.gridRow = `${pos.y + 1} / span ${u.h}`;
            
            if (eqInfo) {
                // Placeholder for equipped item to keep positions locked
                const placeholder = document.createElement('div');
                placeholder.className = 'upgrade-placeholder';
                placeholder.style.width = '100%';
                placeholder.style.height = '100%';
                container.appendChild(placeholder);
            } else {
                const item = document.createElement('div');
                item.className = `upgrade-item ${u.category}`;
                if (isOwned) item.classList.add('owned');
                if (selectedUpgrade && u.id === selectedUpgrade.id) item.classList.add('selected');
                item.style.flexDirection = 'column';
                item.dataset.id = u.id;
                
                const nameEl = document.createElement('div');
                nameEl.className = 'upgrade-name';
                
                // Emoji Scaling logic
                let fs = 24;
                if (u.w === 1 && u.h === 1) fs = 20; // 0.8x
                else if ((u.w === 3 && u.h === 1) || (u.w === 1 && u.h === 3)) fs = 29; // 1.2x
                else if (u.w === 2 && u.h === 2) fs = 48; // 2.0x
                
                nameEl.style.fontSize = (fs / 1512 * 100).toFixed(2) + 'vw';
                nameEl.textContent = u.emoji;
                item.appendChild(nameEl);

                item.draggable = isOwned;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectUpgrade(u);
                });
                item.addEventListener('dragstart', (e) => {
                    selectUpgrade(u);
                    currentlyDraggingId = u.id;
                    const rect = item.getBoundingClientRect();
                    const CELL_FULL = window.innerWidth * 0.0397 + window.innerWidth * 0.0026;
                    dragOffset.x = Math.floor((e.clientX - rect.left) / CELL_FULL);
                    dragOffset.y = Math.floor((e.clientY - rect.top) / CELL_FULL);
                    e.dataTransfer.setData('text/plain', u.id);
                });
                item.addEventListener('dragend', () => {
                    currentlyDraggingId = null;
                    const gridEl = document.getElementById('active-grid');
                    Array.from(gridEl.children).forEach(c => c.classList.remove('drag-over', 'drag-invalid'));
                });

                item.style.position = 'relative';
                item.style.width = '100%';
                item.style.height = '100%';
                item.style.flexShrink = '0';
                
                container.appendChild(item);
                
                if (!isOwned) {
                    const costTag = document.createElement('div');
                    costTag.className = 'upgrade-item-cost';
                    costTag.textContent = `${u.cost}`;
                    item.appendChild(costTag);
                }
            }
            
            colEl.appendChild(container);
        });
    });

    if (selectedUpgrade) {
        const u = selectedUpgrade;
        document.getElementById('info-title').textContent = u.name;
        const isOwned = ownedUpgrades.includes(u.id);
        document.getElementById('info-desc').textContent = u.desc;
        const buyBtn = document.getElementById('buy-btn');
        if (isOwned) {
            buyBtn.disabled = true;
            buyBtn.textContent = 'PURCHASED';
        } else {
            if (bankedCredits >= u.cost) {
                buyBtn.disabled = false;
                buyBtn.textContent = `BUY (${u.cost})`;
            } else {
                buyBtn.disabled = true;
                buyBtn.textContent = `INSUFFICIENT (${u.cost})`;
            }
        }
    }
}

function handleDrop(e, cellIndex) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    
    const u = UPGRADES_DB.find(upg => upg.id === id);
    if (!u) return;

    if (!ownedUpgrades.includes(u.id)) {
        return; 
    }

    const gridX = cellIndex % 6;
    const gridY = Math.floor(cellIndex / 6);
    const targetX = gridX - dragOffset.x;
    const targetY = gridY - dragOffset.y;

    // Check bounds
    if (targetX < 0 || targetY < 0 || targetX + u.w > 6 || targetY + u.h > 3) return;

    // Check if any target cell is locked
    const newCells = getOccupiedCells(u.id, targetX, targetY, u.w, u.h);
    const hasLocked = newCells.some(c => {
        const cx = c % 6;
        return cx >= 3 && !unlockedCellIndices.includes(c);
    });
    if (hasLocked) return;

    const fromEq = equippedUpgrades.find(eq => eq.id === u.id);

    // Temporarily remove dragged item to analyze new layout
    equippedUpgrades = equippedUpgrades.filter(eq => eq.id !== u.id);

    // Find all items overlapping the drop zone
    const overlapping = equippedUpgrades.filter(eq => {
        const eqDef = UPGRADES_DB.find(upg => upg.id === eq.id);
        if (!eqDef) return false;
        const eqCells = getOccupiedCells(eq.id, eq.x, eq.y, eqDef.w, eqDef.h);
        return newCells.some(c => eqCells.includes(c));
    });

    // Remove overlapping items from grid
    equippedUpgrades = equippedUpgrades.filter(eq => !overlapping.includes(eq));

    // Place the dragged item
    equippedUpgrades.push({ id: u.id, x: targetX, y: targetY });

    // Helper to check if a spot is free for a displaced item
    const canPlaceAt = (testId, w, h, x, y) => {
        if (x < 0 || y < 0 || x + w > 6 || y + h > 3) return false;
        const cells = getOccupiedCells(testId, x, y, w, h);
        
        const hasLockedCell = cells.some(c => {
            const cx = c % 6;
            return cx >= 3 && !unlockedCellIndices.includes(c);
        });
        if (hasLockedCell) return false;

        return !equippedUpgrades.some(eq => {
            const def = UPGRADES_DB.find(upg => upg.id === eq.id);
            if (!def) return false;
            const eqCells = getOccupiedCells(eq.id, eq.x, eq.y, def.w, def.h);
            return cells.some(c => eqCells.includes(c));
        });
    };

    // Smart Auto-Place for displaced items
    for (const other of overlapping) {
        const otherDef = UPGRADES_DB.find(upg => upg.id === other.id);
        if (!otherDef) continue;
        
        let placed = false;

        // Priority 1: The dragged item's exact OLD location
        if (fromEq && canPlaceAt(other.id, otherDef.w, otherDef.h, fromEq.x, fromEq.y)) {
            other.x = fromEq.x;
            other.y = fromEq.y;
            equippedUpgrades.push(other);
            placed = true;
            continue;
        }
        
        // Priority 2: Scan the grid for the first available spot
        for (let y = 0; y <= 3 - otherDef.h && !placed; y++) {
            for (let x = 0; x <= 6 - otherDef.w && !placed; x++) {
                if (canPlaceAt(other.id, otherDef.w, otherDef.h, x, y)) {
                    other.x = x;
                    other.y = y;
                    equippedUpgrades.push(other);
                    placed = true;
                }
            }
        }
    }

    saveProgress();
    renderUpgradesLists();
}

function getOccupiedCells(id, x, y, w, h) {
    const cells = [];
    for(let cy=y; cy<y+h; cy++){
        for(let cx=x; cx<x+w; cx++){
            cells.push(cy * 6 + cx);
        }
    }
    return cells;
}

// Global scope dragover to allow un-equipping by dragging to the bottom
document.getElementById('screen-available').ondragover = (e) => e.preventDefault();
document.getElementById('screen-available').ondrop = (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) {
        const u = UPGRADES_DB.find(upg => upg.id === id);
        if (u) {
            equippedUpgrades = equippedUpgrades.filter(eq => eq.id !== id);
            saveProgress();
            renderUpgradesLists();
        }
    }
};

function selectLockSpace(index) {
    selectedLockIndex = index;
    selectedUpgrade = null;
    
    document.querySelectorAll('.grid-cell').forEach(c => {
        if (parseInt(c.dataset.index) === index) c.classList.add('selected');
        else c.classList.remove('selected');
    });
    document.querySelectorAll('.upgrade-item').forEach(item => item.classList.remove('selected'));
    
    const cost = 5000 + unlockedCellIndices.length * 5000;
    document.getElementById('info-title').textContent = 'LOCKED SPACE';
    document.getElementById('info-desc').textContent = 'Unlock this grid space to equip more upgrades.';
    
    const buyBtn = document.getElementById('buy-btn');
    if (bankedCredits >= cost) {
        buyBtn.disabled = false;
        buyBtn.textContent = `UNLOCK (${cost})`;
    } else {
        buyBtn.disabled = true;
        buyBtn.textContent = `INSUFFICIENT (${cost})`;
    }

    buyBtn.onclick = () => {
        if (bankedCredits >= cost) {
            spendCredits(cost);
            unlockedCellIndices.push(index);
            selectedLockIndex = -1; // Deselect after purchase
            saveProgress();
            renderUpgradesLists();
            
            document.getElementById('info-title').textContent = 'SPACE UNLOCKED';
            document.getElementById('info-desc').textContent = 'You can now equip upgrades here.';
            buyBtn.disabled = true;
            buyBtn.textContent = 'UNLOCKED';
        }
    };
}

function selectUpgrade(u) {
    selectedUpgrade = u;
    selectedLockIndex = -1;
    
    document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.upgrade-item').forEach(item => {
        if (item.dataset.id === u.id) item.classList.add('selected');
        else item.classList.remove('selected');
    });
    
    document.getElementById('info-title').textContent = u.name;
    const isOwned = ownedUpgrades.includes(u.id);
    document.getElementById('info-desc').textContent = u.desc;
    
    const buyBtn = document.getElementById('buy-btn');
    if (isOwned) {
        buyBtn.disabled = true;
        buyBtn.textContent = 'PURCHASED';
    } else {
        if (bankedCredits >= u.cost) {
            buyBtn.disabled = false;
            buyBtn.textContent = `BUY (${u.cost})`;
        } else {
            buyBtn.disabled = true;
            buyBtn.textContent = `INSUFFICIENT (${u.cost})`;
        }
    }

    buyBtn.onclick = () => {
        if (!ownedUpgrades.includes(u.id) && bankedCredits >= u.cost) {
            spendCredits(u.cost);
            ownedUpgrades.push(u.id);
            saveProgress();
            renderUpgradesLists();
        }
    };
}
