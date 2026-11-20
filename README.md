# অগ্নি — টিকে থাকো

A real-time twin-stick survival shooter that runs in the browser. No build step,
no dependencies, no framework — one canvas and vanilla JavaScript.

**Play:** https://onelpawarai-x.github.io/agni/

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD / arrow keys | drag anywhere on screen |
| Dash (brief invulnerability) | Space / Shift | ⚡ button, or tap bottom-right |
| Pause | Esc | — |

Shooting is automatic — the character targets the nearest enemy.

## How it plays

Survive waves of enemies. Kills drop experience orbs; collect them to level up
and pick one of three upgrades. Every fourth wave spawns a boss. The arena is
bounded, so there is nowhere to hide forever.

Enemy types: grunt (chases), swift (fast, fragile), tank (slow, heavy),
shooter (keeps distance, fires), splitter (splits into two on death),
boss (spread shot).

## Files

- `index.html` — markup and overlays
- `style.css` — HUD, menus, responsive layout
- `game.js` — engine: camera, spawning, combat, upgrades, rendering

Rendering is a single `<canvas>` with a world-space camera at 2.15× zoom,
device-pixel-ratio aware, with a fixed-timestep-free delta loop clamped to 50 ms.
