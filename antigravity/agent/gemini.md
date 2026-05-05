# Agent Coding Guidelines

The codebase has specific architectural requirements that all future development must strictly adhere to.

## 1. Entity-Component-System (ECS) Architecture
- All game architecture must strictly follow the Entity-Component-System (ECS) pattern. 
- Game Objects are merely IDs. 
- Data must live exclusively in isolated 'Components'.
- Logic must live exclusively in 'Systems'. 
- **CRITICAL:** Never attach update logic or custom data directly to Three.js `Mesh` or `Group` objects.

## 2. Input Management
- Implement and use a globally accessible `InputManager`. 
- This manager is the **ONLY** file allowed to listen to DOM events (`keydown`, `pointerdown`, gamepad API). 
- It must map raw hardware inputs to semantic actions (e.g., 'MoveForward', 'MenuSelect'). 
- Game logic systems must query these semantic actions, never the raw hardware events.

## 3. 2D User Interfaces
- **CRITICAL:** Never use Three.js for 2D User Interfaces. 
- All UI, HUDs, and menus must be built using an HTML/CSS overlay strictly synced to sit on top of the WebGL canvas. 
- Use CSS Flexbox/Grid and relative units (`vh`, `vw`, `%`) for layout and sizing. 
- The UI layer must respond cleanly to `window.onresize` events.

## 4. Performance & Memory Management
- Always use `BufferGeometry`. 
- Implement Object Pooling for any entities that are frequently created and destroyed (like projectiles or enemies) to prevent garbage collection stutters.
