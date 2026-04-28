import * as THREE from 'three';

let isUpgradesActive = false;
let returnCallback = null;
let hiddenSceneObjects = [];
let wasHudVisible = false;

// Base data
const UPGRADES_DB = [
    // Engine
    { id: 'eng1', category: 'engine', name: 'Placeholder', w: 1, h: 2, cost: 500, desc: 'placeholder' },
    { id: 'eng2', category: 'engine', name: 'Placeholder', w: 2, h: 2, cost: 1500, desc: 'placeholder' },
    { id: 'eng3', category: 'engine', name: 'Placeholder', w: 3, h: 1, cost: 800, desc: 'placeholder' },
    
    // Economy
    { id: 'eco1', category: 'economy', name: 'Placeholder', w: 1, h: 1, cost: 200, desc: 'placeholder' },
    { id: 'eco2', category: 'economy', name: 'Placeholder', w: 2, h: 1, cost: 600, desc: 'placeholder' },
    { id: 'eco3', category: 'economy', name: 'Placeholder', w: 2, h: 3, cost: 2000, desc: 'placeholder' },
    
    // Defense
    { id: 'def1', category: 'defense', name: 'Placeholder', w: 1, h: 1, cost: 300, desc: 'placeholder' },
    { id: 'def2', category: 'defense', name: 'Placeholder', w: 1, h: 3, cost: 1200, desc: 'placeholder' },
    { id: 'def3', category: 'defense', name: 'Placeholder', w: 3, h: 2, cost: 2500, desc: 'placeholder' },
];

let selectedUpgrade = null;
let bankedCredits = 0;
let ownedUpgrades = [];
let equippedUpgrades = []; // { id, x, y }
let activeCategory = 'engine';
let currentlyDraggingId = null;
let dragOffset = { x: 0, y: 0 };

export function getBankedCredits() {
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
    } catch (e) {
        ownedUpgrades = [];
        equippedUpgrades = [];
    }
}

function saveProgress() {
    localStorage.setItem('ownedUpgrades', JSON.stringify(ownedUpgrades));
    localStorage.setItem('equippedUpgrades', JSON.stringify(equippedUpgrades));
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
    // Set up category buttons
    const catBtns = document.querySelectorAll('.cat-btn');
    catBtns.forEach(btn => {
        btn.onclick = () => {
            catBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCategory = btn.dataset.cat;
            renderUpgradesLists();
        };
    });

    renderUpgradesLists();
}

function renderUpgradesLists() {
    const gridEl = document.getElementById('active-grid');
    gridEl.innerHTML = '';
    
    function clearAllDragOver() {
        Array.from(gridEl.children).forEach(c => c.classList.remove('drag-over', 'drag-invalid'));
    }

    // Create 15 grid cells (5x3)
    for (let i = 0; i < 15; i++) {
        const gridX = i % 5;
        const gridY = Math.floor(i / 5);
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;
        cell.style.gridColumn = `${gridX + 1}`;
        cell.style.gridRow = `${gridY + 1}`;
        
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
                    const clickX = i % 5;
                    const clickY = Math.floor(i / 5);
                    dragOffset.x = clickX - eq.x;
                    dragOffset.y = clickY - eq.y;
                    
                    // Find the visual element to use as drag image
                    const visualItem = Array.from(gridEl.children).find(c => c.dataset.id === u.id);
                    if (visualItem) {
                        const CELL_FULL = 64; // 60px cell + 4px gap
                        e.dataTransfer.setDragImage(visualItem, dragOffset.x * CELL_FULL + 30, dragOffset.y * CELL_FULL + 30);
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
                    const isBoundsValid = (targetX >= 0 && targetY >= 0 && targetX + u.w <= 5 && targetY + u.h <= 3);
                    
                    // Performance optimization: only redraw if the target cell changed
                    const stateKey = `${currentlyDraggingId}_${targetX}_${targetY}`;
                    if (cell.dataset.lastHoverState === stateKey) return;
                    cell.dataset.lastHoverState = stateKey;
                    
                    clearAllDragOver();
                    
                    // Forgiving UI: any drop in bounds is "valid" and will trigger smart displacement
                    if (isBoundsValid) {
                        for(let cy=targetY; cy<targetY+u.h; cy++){
                            for(let cx=targetX; cx<targetX+u.w; cx++){
                                const targetIdx = cy * 5 + cx;
                                const targetCell = gridEl.children[targetIdx];
                                if (targetCell && targetCell.classList.contains('grid-cell')) {
                                    targetCell.classList.add('drag-over');
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
        
        gridEl.appendChild(cell);
    }

    // Place equipped items on top
    equippedUpgrades.forEach(eq => {
        const u = UPGRADES_DB.find(upg => upg.id === eq.id);
        if (u) {
            const item = document.createElement('div');
            item.className = 'upgrade-item owned';
            item.style.flexDirection = 'column';
            item.dataset.id = u.id;
            
            const nameEl = document.createElement('div');
            nameEl.textContent = u.name;
            item.appendChild(nameEl);

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

    // Populate available list
    const availableEl = document.getElementById('available-list');
    availableEl.innerHTML = '';
    
    const CELL_SIZE = 60; 
    const GAP = 4;

    UPGRADES_DB.forEach(u => {
        const isOwned = ownedUpgrades.includes(u.id);
        const eqInfo = equippedUpgrades.find(eq => eq.id === u.id);
        
        if (!eqInfo && u.category === activeCategory) {
            const container = document.createElement('div');
            container.className = 'upgrade-container';
            
            const item = document.createElement('div');
            item.className = 'upgrade-item';
            if (isOwned) item.classList.add('owned');
            item.style.flexDirection = 'column';
            item.dataset.id = u.id;
            
            const nameEl = document.createElement('div');
            nameEl.textContent = u.name;
            item.appendChild(nameEl);

            item.draggable = isOwned;
            item.addEventListener('click', () => selectUpgrade(u));
            item.addEventListener('dragstart', (e) => {
                selectUpgrade(u);
                currentlyDraggingId = u.id;
                const rect = item.getBoundingClientRect();
                const CELL_FULL = 64;
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
            item.style.width = `${u.w * CELL_SIZE + (u.w - 1) * GAP}px`;
            item.style.height = `${u.h * CELL_SIZE + (u.h - 1) * GAP}px`;
            item.style.flexShrink = '0';
            
            container.appendChild(item);
            
            if (!isOwned) {
                const costTag = document.createElement('div');
                costTag.className = 'upgrade-cost-tag';
                costTag.textContent = `${u.cost} Credits`;
                container.appendChild(costTag);
            }
            
            availableEl.appendChild(container);
        }
    });

    if (selectedUpgrade) selectUpgrade(selectedUpgrade);
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

    const gridX = cellIndex % 5;
    const gridY = Math.floor(cellIndex / 5);
    const targetX = gridX - dragOffset.x;
    const targetY = gridY - dragOffset.y;

    // Check bounds
    if (targetX < 0 || targetY < 0 || targetX + u.w > 5 || targetY + u.h > 3) return;

    const fromEq = equippedUpgrades.find(eq => eq.id === u.id);

    // Temporarily remove dragged item to analyze new layout
    equippedUpgrades = equippedUpgrades.filter(eq => eq.id !== u.id);

    // Find all items overlapping the drop zone
    const newCells = getOccupiedCells(u.id, targetX, targetY, u.w, u.h);
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
        if (x < 0 || y < 0 || x + w > 5 || y + h > 3) return false;
        const cells = getOccupiedCells(testId, x, y, w, h);
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
            for (let x = 0; x <= 5 - otherDef.w && !placed; x++) {
                if (canPlaceAt(other.id, otherDef.w, otherDef.h, x, y)) {
                    other.x = x;
                    other.y = y;
                    equippedUpgrades.push(other);
                    placed = true;
                }
            }
        }
        
        // If not placed, it remains out of equippedUpgrades (sent to inventory)
    }

    saveProgress();
    renderUpgradesLists();
}

function getOccupiedCells(id, x, y, w, h) {
    const cells = [];
    for(let cy=y; cy<y+h; cy++){
        for(let cx=x; cx<x+w; cx++){
            cells.push(cy * 5 + cx);
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
            activeCategory = u.category;
            // Update sidebar buttons visual state
            const catBtns = document.querySelectorAll('.cat-btn');
            catBtns.forEach(btn => {
                if (btn.dataset.cat === activeCategory) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        }
        equippedUpgrades = equippedUpgrades.filter(eq => eq.id !== id);
        saveProgress();
        renderUpgradesLists();
    }
};

function selectUpgrade(u) {
    selectedUpgrade = u;
    document.getElementById('info-title').textContent = u.name;
    const isOwned = ownedUpgrades.includes(u.id);

    document.getElementById('info-cost').textContent = isOwned ? 'OWNED' : `Cost: ${u.cost} CREDITS`;
    document.getElementById('info-desc').textContent = u.desc;
    
    const buyBtn = document.getElementById('buy-btn');
    if (isOwned) {
        buyBtn.disabled = true;
        buyBtn.textContent = 'PURCHASED';
    } else {
        if (bankedCredits >= u.cost) {
            buyBtn.disabled = false;
            buyBtn.textContent = 'BUY';
        } else {
            buyBtn.disabled = true;
            buyBtn.textContent = 'INSUFFICIENT CREDITS';
        }
    }

    buyBtn.onclick = () => {
        if (!ownedUpgrades.includes(u.id) && bankedCredits >= u.cost) {
            spendCredits(u.cost);
            ownedUpgrades.push(u.id);
            saveProgress();
            renderUpgradesLists(); // refreshes UI to show 'PURCHASED' and green color
        }
    };
}
