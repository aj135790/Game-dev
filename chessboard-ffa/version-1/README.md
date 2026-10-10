# CHECKMATE // Free-for-All

A stylized, first-person browser arena shooter built around an 8×8 chessboard with 32 scattered chess pieces. It is a playable multiplayer prototype with a Node.js/Socket.IO server and simple server-controlled bots that fill the arena to eight combatants while you test it. The server supports up to 10 human players.

## Run locally

Requirements: Node.js 18 or newer and an internet connection for the Three.js browser module (loaded from jsDelivr).

```bash
npm install
npm start
```

Open **http://localhost:3000**. To test with multiple humans on one computer, open another browser or an incognito window and join the same local server. On another device on the same network, use the host computer's LAN IP and port 3000. The host firewall may need to allow Node.js.

For an internet-accessible match, deploy this folder to a Node hosting service that supports persistent WebSocket connections. Set the service's start command to `npm start`; the server reads the assigned `PORT` environment variable.

## Controls

| Input | Action |
|---|---|
| W / A / S / D | Move |
| Shift | Sprint |
| Ctrl | Crouch |
| Space | Jump |
| Left mouse button (hold) | Aim / zoom |
| Right mouse button (hold) | Fire primary; click to swing knife |
| R | Reload primary |
| 1 | Equip selected gun |
| 2 | Equip knife |
| G | Open weapon-selection popup |
| Tab (hold) | Expand leaderboard |
| Esc | Release mouse pointer |

Click the arena to capture the mouse after deploying. This prototype intentionally preserves the requested left-mouse-to-aim / right-mouse-to-fire layout.

## Weapon tuning

These are starting balance values, meant to be play-tested and adjusted:

| Weapon | Magazine | Reserve | Damage model | Role |
|---|---:|---:|---|---|
| Assault Rifle | 30 | 120 | 23 body / 34 head at close range; gradual falloff across distance | Reliable close/medium-range weapon, fast fire rate |
| Shotgun | 6 | 24 | 8 pellets; about 8 body / 10 head damage per pellet at point-blank range with strong falloff | High-risk close-range burst; spread makes it unreliable at distance |
| Sniper | 7 | 21 | 78 body damage nearby (70 farther out); 100 head damage | Slow, precise long-range weapon; headshots are lethal |
| Knife | Always available | — | 60 front-facing damage; 82 from behind | Short 2.35-unit reach, 520 ms swing cooldown |

Every gun has its own rate of fire, reload time, range and spread. Aiming tightens the shot spread and reduces movement speed. All players have 100 health and respawn after elimination. A round ends at 20 eliminations or after 10 minutes.

## What's implemented

- Real-time Socket.IO multiplayer, up to 10 humans, with bots filling the lobby to 8 total combatants during testing.
- Server-controlled movement, jump, crouch/sprint speeds, weapon ammo, reloads, shot cooldowns, damage and respawns.
- Procedurally built Three.js chessboard, 32 scattered 3D chess pieces, stylized player avatars, first-person weapon models and muzzle/tracer effects.
- Weapon picker at deployment and in-match via G, health/ammo HUD, kill feed, leaderboard, minimap, hit markers, synthesized arcade audio, XP and streak feedback.

## Prototype limits

This is an MVP, not a production-ready competitive shooter. It does not yet have accounts, matchmaking across separate rooms, ranked persistence, advanced animation, anti-cheat, server reconciliation/prediction, accessibility remapping, or dedicated hosting configuration. Physics and hitboxes are deliberately lightweight; the bots are simple target-seeking opponents. Before a public launch, add rate limits, stronger validation, secure deployment, automated tests, and more play-testing for weapon balance and mobile/performance support.
