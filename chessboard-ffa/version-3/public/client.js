import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const socket = window.io({ transports: ['websocket', 'polling'] });
const ORDERED_GUNS = ['rifle', 'shotgun', 'sniper'];
const GUN_META = {
  rifle: { short: 'AR', title: 'ASSAULT RIFLE', stat: '30 ROUND MAG · FULL AUTO', color: 0xc9ff62 },
  shotgun: { short: 'SG', title: 'SHOTGUN', stat: '6 ROUND MAG · 8 PELLETS', color: 0xffc36c },
  sniper: { short: 'SR', title: 'SNIPER RIFLE', stat: '7 ROUND MAG · HIGH PRECISION', color: 0x81e5ff }
};
const state = {
  joined: false, myId: null, myName: '', selectedWeapon: 'rifle', equipped: 'primary',
  guns: {}, pieces: [], arenaHalf: 15.5, scoreLimit: 20,
  players: [], playerById: new Map(), keys: {}, mouse: { left: false, right: false },
  yaw: 0, pitch: 0, aiming: false, loadoutOpen: false, pointerLocked: false,
  showFullBoard: false, knifeSwingUntil: 0, lastFireAt: 0, lastInputAt: 0,
  lastToastAt: 0, killCountSeen: 0, deathAt: 0, currentAmmo: 30,
  remoteAvatars: new Map(), pieceMeshes: [], shotLines: [], playerMeshes: new Map(),
  health: 100, connected: false, initialArenaReady: false, hitTimeout: null, noticeTimeout: null
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b111c);
scene.fog = new THREE.Fog(0x0b111c, 26, 64);
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 140);
camera.rotation.order = 'YXZ';
scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
$('game-canvas').appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xc5d8ff, 0x222734, 2.1);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xfff3d8, 3.1);
keyLight.position.set(-9, 18, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -22; keyLight.shadow.camera.right = 22;
keyLight.shadow.camera.top = 22; keyLight.shadow.camera.bottom = -22;
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x7bcbff, 34, 44, 2);
rimLight.position.set(12, 7, -8); scene.add(rimLight);
const accentLight = new THREE.PointLight(0xc8ff54, 16, 35, 2);
accentLight.position.set(-12, 4, 10); scene.add(accentLight);

const boardGroup = new THREE.Group(); scene.add(boardGroup);
const worldGroup = new THREE.Group(); scene.add(worldGroup);
const avatarGroup = new THREE.Group(); scene.add(avatarGroup);
const effectsGroup = new THREE.Group(); scene.add(effectsGroup);
const baseMat = new THREE.MeshStandardMaterial({ color: 0x252d3c, roughness: 0.84, metalness: 0.12 });
const tileDark = new THREE.MeshStandardMaterial({ color: 0x303c50, roughness: 0.87, metalness: 0.08 });
const tileLight = new THREE.MeshStandardMaterial({ color: 0xc7c9c0, roughness: 0.81, metalness: 0.06 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x151d2a, roughness: 0.6, metalness: 0.24 });

function addBox(parent, sx, sy, sz, mat, x, y, z, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = receive;
  parent.add(mesh); return mesh;
}
function addCylinder(parent, rTop, rBottom, h, mat, x, y, z, sides = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, sides), mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function addSphere(parent, r, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; parent.add(mesh); return mesh;
}
function makeBoard() {
  const base = new THREE.Mesh(new THREE.BoxGeometry(34.2, 0.6, 34.2), baseMat);
  base.position.y = -0.42; base.receiveShadow = true; base.castShadow = true; boardGroup.add(base);
  const underside = new THREE.Mesh(new THREE.BoxGeometry(35.2, 0.22, 35.2), edgeMat);
  underside.position.y = -0.79; boardGroup.add(underside);
  const tileGeo = new THREE.BoxGeometry(4, 0.18, 4);
  const letters = 'ABCDEFGH';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const tile = new THREE.Mesh(tileGeo, (row + col) % 2 ? tileDark : tileLight);
      tile.position.set(-14 + col * 4, -0.06, -14 + row * 4);
      tile.receiveShadow = true; tile.castShadow = false; boardGroup.add(tile);
      // Faint coordinate labels are deliberately low contrast, like markings on a tactical board.
      if (row === 7 || col === 0) {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = 'rgba(15,24,38,.52)'; ctx.font = 'bold 27px Inter, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(row === 7 && col === 0 ? `${letters[col]}${8-row}` : (row === 7 ? letters[col] : `${8-row}`), 32, 32);
        const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.44 }));
        label.rotation.x = -Math.PI / 2; label.position.set(-14 + col * 4 + 1.64, 0.04, -14 + row * 4 + 1.62); boardGroup.add(label);
      }
    }
  }
  // Metal corner braces and thin luminous perimeter.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(33.1, 0.14, 0.12), new THREE.MeshStandardMaterial({ color: 0x667991, metalness: 0.8, roughness: 0.35 }));
  for (const z of [-16.05, 16.05]) { const side = frame.clone(); side.position.set(0, 0.01, z); boardGroup.add(side); }
  const frameSide = frame.clone(); frameSide.geometry = new THREE.BoxGeometry(0.12, 0.14, 33.1);
  for (const x of [-16.05, 16.05]) { const side = frameSide.clone(); side.position.set(x, 0.01, 0); boardGroup.add(side); }
  // Small perimeter light nodes provide orientation without adding visual clutter.
  for (const x of [-14, -6, 2, 10, 14]) for (const z of [-16.08, 16.08]) {
    const node = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0xc8ff54 }));
    node.position.set(x, 0.12, z); boardGroup.add(node);
  }
  // Low arena pylons outside the playable boundary.
  for (const [x,z] of [[-16.7,-16.7],[16.7,-16.7],[-16.7,16.7],[16.7,16.7]]) {
    addCylinder(boardGroup, 0.28, 0.36, 0.75, edgeMat, x, 0.03, z, 8);
    addSphere(boardGroup, 0.13, new THREE.MeshStandardMaterial({color:0xc8ff54,emissive:0x6b8c27,emissiveIntensity:1.3}), x, 0.48, z, 1, .5, 1);
  }
}
makeBoard();

function makePieceMesh(piece) {
  const g = new THREE.Group(); g.position.set(piece.x, 0.04, piece.z); g.userData.pieceId = piece.id;
  const ivory = piece.side === 'ivory';
  const main = new THREE.MeshStandardMaterial({ color: ivory ? 0xe0e2d9 : 0x171e2b, roughness: ivory ? 0.4 : 0.32, metalness: ivory ? 0.18 : 0.52 });
  const trim = new THREE.MeshStandardMaterial({ color: ivory ? 0x939d9e : 0x73859b, roughness: 0.32, metalness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: ivory ? 0x5b7b82 : 0xc8ff54, emissive: ivory ? 0x122a30 : 0x3d5814, emissiveIntensity: 0.24, metalness: 0.55, roughness: 0.3 });
  addCylinder(g, 0.43, 0.51, 0.14, main, 0, 0.07, 0, 20);
  addCylinder(g, 0.34, 0.43, 0.12, trim, 0, 0.19, 0, 20);
  addCylinder(g, 0.24, 0.3, 0.12, main, 0, 0.29, 0, 16);
  if (piece.type === 'pawn') {
    addCylinder(g, 0.14, 0.2, 0.33, main, 0, 0.49, 0, 14);
    addCylinder(g, 0.2, 0.2, 0.08, trim, 0, 0.67, 0, 16);
    addSphere(g, 0.19, main, 0, 0.87, 0, 1, 1.08, 1);
    addSphere(g, 0.06, accent, 0, 0.91, -0.15, 1, 1, 1);
  } else if (piece.type === 'rook') {
    addCylinder(g, 0.17, 0.24, 0.48, main, 0, 0.57, 0, 12);
    addCylinder(g, 0.32, 0.27, 0.17, trim, 0, 0.86, 0, 12);
    addCylinder(g, 0.29, 0.3, 0.15, main, 0, 1.0, 0, 12);
    for (let i=0;i<6;i++) { const a=(i/6)*Math.PI*2; addBox(g,0.105,0.12,0.105,trim,Math.cos(a)*0.225,1.11,Math.sin(a)*0.225); }
  } else if (piece.type === 'bishop') {
    addCylinder(g, 0.15, 0.25, 0.4, main, 0, 0.53, 0, 14);
    addSphere(g, 0.24, trim, 0, 0.78, 0, 1, 1.08, 1);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.52, 12), main); cone.position.y=1.08; cone.castShadow=true; g.add(cone);
    addSphere(g,0.08,accent,0,1.38,0,1,1.5,1);
    const slit = addBox(g,0.045,0.32,0.24,trim,0,0.95,0.17); slit.rotation.z=-0.52;
  } else if (piece.type === 'knight') {
    addCylinder(g, 0.15, 0.25, 0.4, main, 0, 0.53, 0, 14);
    addSphere(g,0.23,trim,0,0.77,0,1.1,1,1.15);
    const neck = addBox(g,0.27,0.44,0.2,main,0.02,1.0,-0.04); neck.rotation.x=-0.35; neck.rotation.z=-0.25;
    addSphere(g,0.17,main,0.1,1.25,-0.11,1.1,1.05,1.35);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.075,0.2,7),trim); ear.position.set(0.04,1.42,-0.14); ear.rotation.z=-0.22; g.add(ear);
    addSphere(g,0.035,accent,0.24,1.27,-0.2);
  } else if (piece.type === 'queen') {
    addCylinder(g,0.15,0.23,0.43,main,0,0.54,0,16);
    addCylinder(g,0.24,0.17,0.16,trim,0,0.83,0,16);
    addSphere(g,0.22,main,0,1.0,0,1,0.65,1);
    for(let i=0;i<7;i++){const a=i/7*Math.PI*2;addSphere(g,0.066,trim,Math.cos(a)*0.2,1.22+Math.sin(a*2)*0.025,Math.sin(a)*0.2);}
    addSphere(g,0.095,accent,0,1.3,0,1,1.1,1);
  } else if (piece.type === 'king') {
    addCylinder(g,0.16,0.25,0.45,main,0,0.54,0,16);
    addCylinder(g,0.25,0.18,0.16,trim,0,0.84,0,16);
    addSphere(g,0.19,main,0,1.02,0,1,0.75,1);
    addBox(g,0.085,0.42,0.085,trim,0,1.34,0);
    addBox(g,0.32,0.08,0.085,accent,0,1.36,0);
  }
  // Pieces are cover-sized landmarks: roughly 4.7 world units tall (about 3× a player).
  // Keep their footprint narrower than their height so routes between pieces remain playable.
  g.updateMatrixWorld(true);
  const rawBounds = new THREE.Box3().setFromObject(g);
  const rawHeight = Math.max(0.1, rawBounds.getSize(new THREE.Vector3()).y);
  g.scale.set(2.2, 4.7 / rawHeight, 2.2);
  return g;
}
function buildPieces(pieces) {
  for (const old of state.pieceMeshes) worldGroup.remove(old);
  state.pieceMeshes = [];
  state.pieces = pieces || [];
  for (const p of state.pieces) { const mesh = makePieceMesh(p); worldGroup.add(mesh); state.pieceMeshes.push(mesh); }
  state.initialArenaReady = true;
}

const palette = [0x70dbff,0xffb96a,0xff6f91,0xb4a0ff,0x8fffbd,0xffe66f,0xff8f56,0xc3f5ff,0xf69cff,0xb8d4ff];
function makeAvatar(player) {
  const root = new THREE.Group(); root.userData.playerId = player.id;
  const color = palette[Math.abs(hashCode(player.id)) % palette.length];
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.06 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a2432, roughness: 0.75, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({ color: 0xcaf8ff, emissive: 0x2b7b96, emissiveIntensity: 0.7, metalness: 0.7, roughness: 0.22 });
  addCylinder(root,0.25,0.31,0.78,suit,0,0.78,0,12);
  addBox(root,0.54,0.2,0.3,dark,0,0.97,0);
  addSphere(root,0.225,dark,0,1.38,0,1,1.05,0.95);
  addBox(root,0.27,0.085,0.045,visor,0,1.4,-0.197);
  // arms and compact forearm guards make the silhouette read clearly from distance.
  for (const side of [-1,1]) {
    const arm = addCylinder(root,0.085,0.105,0.5,suit,side*0.32,0.77,-0.02,10); arm.rotation.z=side*-0.13;
    addBox(root,0.17,0.2,0.18,dark,side*0.33,0.48,-0.06);
    addCylinder(root,0.105,0.11,0.34,dark,side*0.14,0.24,0.015,8);
  }
  const pack = addBox(root,0.35,0.42,0.2,dark,0,0.84,0.22);
  const led = addBox(root,0.14,0.055,0.035,visor,0,0.9,0.33);
  const weaponRoot = new THREE.Group(); weaponRoot.position.set(0.28,0.78,-0.19); root.add(weaponRoot);
  const gunBody = addBox(weaponRoot,0.12,0.105,0.35,dark,0,0,0);
  const barrel = addCylinder(weaponRoot,0.022,0.028,0.35,visor,0,0,-0.27,8); barrel.rotation.x=Math.PI/2;
  const shoulder = addBox(weaponRoot,0.1,0.12,0.16,suit,0,-0.02,0.2);
  const nameSprite = makeNameSprite(player.name, player.health);
  nameSprite.position.set(0,2.05,0); root.add(nameSprite);
  root.userData = { playerId: player.id, color, name: player.name, nameSprite, weaponRoot, gunBody, barrel, shoulder, suit, dark, visor };
  return root;
}
function hashCode(s) { let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return h; }
function makeNameSprite(name, health) {
  const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=128;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgba(5,10,18,.7)'; ctx.fillRect(4,8,504,110);
  ctx.fillStyle='#c8ff54'; ctx.fillRect(4,8,5,110);
  ctx.fillStyle='#eef4ff'; ctx.font='bold 34px Inter, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(name.toUpperCase().slice(0,18),256,43);
  ctx.fillStyle='rgba(255,255,255,.15)'; ctx.fillRect(58,79,396,10);
  ctx.fillStyle=health>45?'#c8ff54':'#ff657b'; ctx.fillRect(58,79,396*Math.max(0,health)/100,10);
  const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));
  sprite.scale.set(1.75,.44,1); return sprite;
}
function refreshNameSprite(mesh, player) {
  const old=mesh.userData.nameSprite;
  const next=makeNameSprite(player.name,player.health);
  next.position.copy(old.position); mesh.remove(old); mesh.add(next); mesh.userData.nameSprite=next;
  old.material.map?.dispose(); old.material.dispose();
}
function syncAvatars(list) {
  const liveIds = new Set(list.filter(p => p.id !== state.myId).map(p => p.id));
  for (const [id, mesh] of state.remoteAvatars.entries()) {
    if (!liveIds.has(id)) { avatarGroup.remove(mesh); disposeObject(mesh); state.remoteAvatars.delete(id); }
  }
  for (const p of list) {
    if (p.id === state.myId) continue;
    let mesh = state.remoteAvatars.get(p.id);
    if (!mesh) { mesh=makeAvatar(p); mesh.position.set(p.x,p.jumpY,p.z); avatarGroup.add(mesh); state.remoteAvatars.set(p.id,mesh); }
    mesh.userData.target = p;
    if (mesh.userData.name !== p.name || mesh.userData.lastHealth !== p.health) {
      refreshNameSprite(mesh,p); mesh.userData.name=p.name; mesh.userData.lastHealth=p.health;
    }
    mesh.visible = p.alive;
    mesh.userData.weaponRoot.visible = p.equipped !== 'knife';
  }
}
function disposeObject(obj) {
  obj.traverse?.(child=>{ if(child.geometry) child.geometry.dispose(); if(child.material){ if(Array.isArray(child.material))child.material.forEach(m=>m.dispose());else child.material.dispose(); }});
}

const viewModel = new THREE.Group(); camera.add(viewModel);
const vmDark = new THREE.MeshStandardMaterial({ color: 0x1a2431, metalness: 0.56, roughness: 0.34 });
const vmMetal = new THREE.MeshStandardMaterial({ color: 0x8795a7, metalness: 0.8, roughness: 0.22 });
const vmAccent = new THREE.MeshStandardMaterial({ color: 0xc8ff54, emissive: 0x567d1b, emissiveIntensity: 0.3, metalness: 0.45, roughness: 0.35 });
const vmGrip = new THREE.MeshStandardMaterial({ color: 0x28251e, roughness: 0.94 });
let muzzleFlash = null;
let knifeMesh = null;
let vmGun = null;
let vmMagazine = null;
let reloadBaseMagazine = null;
const reloadBaseGunPosition = new THREE.Vector3(0.34, -0.28, -0.55);
const reloadBaseGunRotation = new THREE.Euler(0.02, -0.06, 0.02);
function rebuildViewModel() {
  while(viewModel.children.length) { const c=viewModel.children[0]; viewModel.remove(c); disposeObject(c); }
  viewModel.position.set(0,0,0); viewModel.rotation.set(0,0,0);
  vmMagazine = null; reloadBaseMagazine = null;
  if (state.equipped === 'knife') {
    const knife = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045,0.045,0.35),vmMetal); blade.position.set(0,0,-0.22); knife.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035,0.12,4),vmMetal); tip.rotation.x=-Math.PI/2; tip.position.set(0,0,-0.43); knife.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.06,0.06),vmAccent); guard.position.set(0,0,-0.02); knife.add(guard);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.075,0.2),vmGrip); handle.position.set(0,0,0.1); knife.add(handle);
    knife.position.set(0.36,-0.28,-0.52); knife.rotation.set(-0.12,0.02,0.08); viewModel.add(knife); knifeMesh=knife; vmGun=null; muzzleFlash=null;
    return;
  }
  const g = new THREE.Group();
  const style = state.selectedWeapon;
  if (style === 'rifle') {
    addBox(g,0.15,0.13,0.42,vmDark,0,0,0);
    addBox(g,0.1,0.11,0.2,vmAccent,0,0.1,-0.02);
    const barrel=addCylinder(g,0.025,0.035,0.48,vmMetal,0,0,-0.42,10); barrel.rotation.x=Math.PI/2;
    addBox(g,0.12,0.09,0.24,vmGrip,0,-0.1,0.13);
    addBox(g,0.13,0.15,0.14,vmDark,0,-0.09,-0.09);
    addBox(g,0.06,0.06,0.12,vmAccent,0,0.13,-0.03);
  } else if (style === 'shotgun') {
    addBox(g,0.18,0.13,0.35,vmDark,0,0,0.02);
    const barrel1=addCylinder(g,0.035,0.04,0.58,vmMetal,-0.035,0,-0.39,10); barrel1.rotation.x=Math.PI/2;
    const barrel2=addCylinder(g,0.035,0.04,0.58,vmMetal,0.035,0,-0.39,10); barrel2.rotation.x=Math.PI/2;
    addBox(g,0.14,0.11,0.28,vmGrip,0,-0.12,0.18);
    addBox(g,0.13,0.16,0.12,vmAccent,0,0.07,-0.07);
  } else {
    addBox(g,0.13,0.12,0.44,vmDark,0,0,0.04);
    addBox(g,0.085,0.085,0.25,vmGrip,0,-0.105,0.2);
    const barrel=addCylinder(g,0.022,0.03,0.72,vmMetal,0,0,-0.48,10); barrel.rotation.x=Math.PI/2;
    const scope=addCylinder(g,0.07,0.07,0.22,vmAccent,0,0.11,0.02,12); scope.rotation.x=Math.PI/2;
    addCylinder(g,0.085,0.085,0.035,vmDark,0,0.11,-0.1,12).rotation.x=Math.PI/2;
    addBox(g,0.15,0.14,0.16,vmDark,0,-0.04,-0.06);
  }
  // Minimal forearm beneath the weapon gives the first-person view some weight.
  const sleeveMat = new THREE.MeshStandardMaterial({color:0x293444,roughness:.8});
  const sleeve = addCylinder(g,0.095,0.12,0.36,sleeveMat,-0.07,-0.17,0.13,10); sleeve.rotation.x=0.24; sleeve.rotation.z=-0.2;
  // Separate magazine/shell carrier gives the reload motion a visible moving part.
  const magazine = new THREE.Group();
  if (style === 'shotgun') {
    addCylinder(magazine,0.045,0.045,0.22,vmGrip,0,0,0,10).rotation.x=Math.PI/2;
    addBox(magazine,0.09,0.07,0.12,vmDark,0,-0.035,0.045);
  } else if (style === 'sniper') {
    addBox(magazine,0.085,0.17,0.11,vmGrip,0,0,0);
    addBox(magazine,0.065,0.04,0.09,vmAccent,0,-0.07,0);
  } else {
    addBox(magazine,0.09,0.19,0.12,vmGrip,0,0,0);
    addBox(magazine,0.065,0.035,0.095,vmAccent,0,-0.075,0);
  }
  magazine.position.set(0,-0.205,0.105); g.add(magazine);
  reloadBaseMagazine = { x: magazine.position.x, y: magazine.position.y, z: magazine.position.z };
  g.position.copy(reloadBaseGunPosition); g.rotation.copy(reloadBaseGunRotation); viewModel.add(g);
  vmGun=g; vmMagazine=magazine; knifeMesh=null;
  muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6),new THREE.MeshBasicMaterial({color:0xffdca1,transparent:true,opacity:.9}));
  muzzleFlash.position.set(0,0,-0.78); muzzleFlash.visible=false; g.add(muzzleFlash);
}

function renderWeaponOptions(container, mode='start') {
  container.innerHTML='';
  for (const id of ORDERED_GUNS) {
    const gun=state.guns[id] || {magazine: ({rifle:30,shotgun:6,sniper:7})[id],description:''};
    const meta=GUN_META[id];
    const button=document.createElement('button'); button.type='button';
    button.className='weapon-option'+(state.selectedWeapon===id?' selected':''); button.dataset.weapon=id;
    button.innerHTML=`<span class="weapon-letter">${meta.short}</span><span class="selected-dot">✓</span><div class="option-title">${meta.title}</div><div class="option-meta">${gun.magazine} IN MAG · ${id==='rifle'?'AUTO':id==='shotgun'?'8 PELLETS':'PRECISION'}</div><div class="option-desc">${gun.description || ({rifle:'A stable all-rounder.',shotgun:'Strong at close range.',sniper:'Slow shots with high damage.'})[id]}</div>`;
    button.addEventListener('click',()=>{
      state.selectedWeapon=id; renderWeaponOptions(container,mode);
      if(mode==='loadout' && state.joined){ socket.emit('chooseWeapon',id); notify(`${meta.title} EQUIPPED`); closeLoadout(); }
    });
    container.appendChild(button);
  }
}

function openLoadout() {
  if (!state.joined || state.loadoutOpen) return;
  state.loadoutOpen=true; $('loadout-overlay').classList.remove('hidden');
  state.mouse.left=false; state.mouse.right=false; state.aiming=false;
  if (document.pointerLockElement) document.exitPointerLock();
  renderWeaponOptions($('loadout-options'),'loadout');
}
function closeLoadout() {
  state.loadoutOpen=false; $('loadout-overlay').classList.add('hidden');
  if(state.joined && !state.pointerLocked) $('intro-hint').classList.remove('hidden');
}
$('loadout-button').addEventListener('click',openLoadout);
$('close-loadout').addEventListener('click',closeLoadout);

$('join-button').addEventListener('click',()=>{
  if(!state.connected){$('join-error').textContent='Connecting to the arena server…';return;}
  const name=$('player-name-input').value.trim().slice(0,16) || 'RookRunner';
  state.myName=name; $('join-button').disabled=true; $('join-error').textContent='DEPLOYING…';
  socket.emit('join',{name,weapon:state.selectedWeapon});
});
$('player-name-input').addEventListener('keydown',e=>{if(e.key==='Enter')$('join-button').click();});

socket.on('connect',()=>{state.connected=true;$('join-error').textContent='';$('join-button').disabled=false;});
socket.on('disconnect',()=>{state.connected=false;notify('CONNECTION LOST · RECONNECTING');});
socket.on('arena',data=>{if(data.pieces)buildPieces(data.pieces);state.guns=data.guns||{};state.arenaHalf=data.arenaHalf||15.5;state.scoreLimit=data.scoreLimit||20;renderWeaponOptions($('weapon-options'),'start');});
socket.on('joinError',message=>{$('join-error').textContent=message;$('join-button').disabled=false;});
socket.on('joined',data=>{
  state.joined=true;state.myId=data.id;state.myName=data.player.name;state.selectedWeapon=data.player.weapon;state.equipped='primary';
  $('start-overlay').classList.add('hidden');$('hud').classList.remove('hidden');$('intro-hint').classList.remove('hidden');
  $('player-name').textContent=state.myName.toUpperCase();$('avatar-chip').textContent=state.myName.slice(0,2).toUpperCase();
  rebuildViewModel();notify('DEPLOYED · ELIMINATE TO EARN XP');
});
socket.on('weaponChanged',data=>{state.selectedWeapon=data.weapon;state.equipped='primary';rebuildViewModel();});
socket.on('reloadStarted',data=>{
  state.reloadStartedAt=performance.now();state.reloadDuration=Math.max(1,Number(data.duration)||1650);
  $('weapon-card').classList.add('reloading');$('reload-fill').style.width='0%';
  notify(`RELOADING · ${(state.reloadDuration/1000).toFixed(1)}s`);
});
socket.on('empty',()=>notify('MAGAZINE EMPTY · PRESS R TO RELOAD'));
socket.on('youDied',data=>{
  state.deathAt=Date.now(); $('respawn-overlay').classList.remove('hidden'); $('death-title').textContent=(data.killer||'OPPONENT').toUpperCase(); $('respawn-countdown').textContent='REDEPLOYING…';
  $('damage-flash').style.opacity='.5';setTimeout(()=>$('damage-flash').style.opacity='0',250);
});
socket.on('damageTaken',data=>{
  $('damage-flash').style.opacity='.72';setTimeout(()=>$('damage-flash').style.opacity='0',160);
  if(data.from) $('status-label').textContent=`HIT BY ${String(data.from).toUpperCase().slice(0,11)}`;
});
socket.on('hitConfirm',data=>{
  const marker=$('hitmarker');marker.classList.remove('show','head');void marker.offsetWidth;marker.classList.add('show');if(data.headshot)marker.classList.add('head');
  $('center-toast').textContent=data.killed?(data.headshot?'PRECISION ELIMINATION':'ELIMINATION'):`${data.damage} DAMAGE`;
  $('center-toast').style.color=data.killed?'#c8ff54':'#f2f6ff';state.lastToastAt=Date.now();
  if(data.killed) notify(data.headshot?'PRECISION ELIMINATION · +175 XP':data.melee?'KNIFE ELIMINATION · +100 XP':'ELIMINATION · +100 XP');
});
socket.on('reward',data=>{notify(`${data.headshot?'PRECISION HIT · ':''}+${data.xp} XP${data.streak>=3?` · ${data.streak} STREAK`:''}`);});
socket.on('shotFx',data=>renderShotFx(data));
socket.on('meleeFx',data=>{
  if(data.attackerId===state.myId) { state.knifeSwingUntil=performance.now()+260; if(knifeMesh)knifeMesh.rotation.z=-.1; if(data.hit)playHit(); }
});

function notify(message) {
  const el=$('notification');el.textContent=message;el.classList.remove('hidden');
  if(state.noticeTimeout)clearTimeout(state.noticeTimeout);
  state.noticeTimeout=setTimeout(()=>el.classList.add('hidden'),1700);
}
function playShot(type='rifle') {
  // Layered procedural weapon audio: sharp report, low-frequency body, filtered crack, and a short reflected tail.
  // These are synthesized effects (not recorded firearm samples), tuned to feel weightier and more distinct.
  try {
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    if(!window.gameAudio)window.gameAudio=new Ctx();
    const ctx=window.gameAudio;
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;

    const makeNoise=(duration,filterType,frequency,q,volume,delay=0)=>{
      const length=Math.max(1,Math.floor(ctx.sampleRate*duration));
      const buffer=ctx.createBuffer(1,length,ctx.sampleRate);
      const samples=buffer.getChannelData(0);
      for(let i=0;i<length;i++){
        const t=i/length;
        const envelope=Math.pow(1-t,type==='shotgun'?1.55:2.4);
        samples[i]=(Math.random()*2-1)*envelope;
      }
      const source=ctx.createBufferSource();source.buffer=buffer;
      const filter=ctx.createBiquadFilter();filter.type=filterType;filter.frequency.setValueAtTime(frequency,now+delay);filter.Q.value=q;
      const gain=ctx.createGain();gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(volume,now+delay+.004);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+duration);
      source.connect(filter);filter.connect(gain);gain.connect(ctx.destination);source.start(now+delay);source.stop(now+delay+duration);
    };
    const tone=(wave,from,to,duration,volume,delay=0)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type=wave;osc.frequency.setValueAtTime(from,now+delay);osc.frequency.exponentialRampToValueAtTime(Math.max(1,to),now+delay+duration);
      gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(volume,now+delay+.004);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+duration);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(now+delay);osc.stop(now+delay+duration);
    };

    if(type==='shotgun'){
      // Broad muzzle blast, deep pressure wave, and a short, rattly mechanical tail.
      makeNoise(.29,'lowpass',980,.72,.38);
      makeNoise(.095,'highpass',2350,.65,.19,.004);
      makeNoise(.12,'bandpass',620,1.8,.12,.025);
      tone('sine',82,28,.28,.32);
      tone('triangle',178,49,.17,.13,.012);
      tone('square',680,145,.045,.025,.028);
      makeNoise(.22,'lowpass',510,.65,.075,.075);
    } else if(type==='sniper'){
      // A crisp high-frequency crack over a heavy low report, followed by a longer tail.
      makeNoise(.045,'highpass',3600,.8,.25);
      makeNoise(.13,'bandpass',1550,1.05,.20,.003);
      makeNoise(.21,'lowpass',560,.8,.21,.008);
      tone('sine',96,29,.24,.27,.006);
      tone('triangle',2200,460,.11,.07,.002);
      tone('sine',940,560,.25,.028,.055);
      makeNoise(.28,'bandpass',820,.75,.045,.11);
    } else {
      // Compact, punchy rifle report with a bright crack and subtle cycling/mechanical click.
      makeNoise(.052,'highpass',3100,.8,.23);
      makeNoise(.072,'bandpass',1280,1.25,.15,.002);
      makeNoise(.105,'lowpass',680,.8,.105,.003);
      tone('triangle',168,58,.105,.16);
      tone('square',720,235,.032,.026,.012);
      makeNoise(.055,'highpass',2450,.7,.055,.038);
    }
    // Tiny delayed reflections make shots feel less like a dry UI beep without masking rapid fire.
    if(type==='sniper') makeNoise(.18,'bandpass',1050,.65,.035,.16);
    else if(type==='shotgun') makeNoise(.14,'lowpass',760,.65,.04,.13);
    else makeNoise(.075,'bandpass',1150,.7,.025,.055);
  }catch(_e){}
}
function playHit() {
  try { const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;if(!window.gameAudio)window.gameAudio=new Ctx();const c=window.gameAudio;if(c.state==='suspended')c.resume();const o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.setValueAtTime(850,c.currentTime);o.frequency.exponentialRampToValueAtTime(1280,c.currentTime+.035);g.gain.setValueAtTime(.08,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.07);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.075);}catch(_e){}
}

function renderShotFx(data) {
  const local=data.shooterId===state.myId;
  if(local){playShot(data.weapon);if(muzzleFlash){muzzleFlash.visible=true;setTimeout(()=>{if(muzzleFlash)muzzleFlash.visible=false;},50);}if(data.weapon!=='knife') { viewModel.position.z=.045; setTimeout(()=>viewModel.position.z=0,55); }}
  for(const trace of (data.traces||[])) {
    const d=trace.dir,dist=Math.max(.2,trace.distance||2.0),origin=data.origin;
    const start=new THREE.Vector3(origin.x,origin.y,origin.z);
    const end=new THREE.Vector3(origin.x+d.x*dist,origin.y+d.y*dist,origin.z+d.z*dist);
    const points=[start,end];const geometry=new THREE.BufferGeometry().setFromPoints(points);
    const colors={rifle:0xd7f5a2,shotgun:0xffc26c,sniper:0x8be9ff};
    const material=new THREE.LineBasicMaterial({color:colors[data.weapon]||0xffffff,transparent:true,opacity:local?.62:.36});
    const line=new THREE.Line(geometry,material);effectsGroup.add(line);
    const record={line,expires:performance.now()+(local?90:75)};state.shotLines.push(record);
  }
}

function drawMinimap(players) {
  const canvas=$('minimap'); if(!canvas||!canvas.getContext)return;
  const ctx=canvas.getContext('2d'); const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  ctx.fillStyle='rgba(7,13,22,.85)';ctx.fillRect(0,0,w,h);
  const ox=8,oy=8,sz=w-16,step=sz/8;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){ctx.fillStyle=(r+c)%2?'#364458':'#c1c9c2';ctx.globalAlpha=(r+c)%2?.7:.48;ctx.fillRect(ox+c*step,oy+r*step,step-1,step-1);}
  ctx.globalAlpha=.55;ctx.fillStyle='#101927';for(const p of state.pieces){const x=ox+(p.x+16)/32*sz,z=oy+(p.z+16)/32*sz;ctx.beginPath();ctx.arc(x,z,2.2,0,Math.PI*2);ctx.fill();}
  for(const p of players){if(!p.alive)continue;const x=ox+(p.x+16)/32*sz,z=oy+(p.z+16)/32*sz;ctx.globalAlpha=1;ctx.fillStyle=p.id===state.myId?'#c8ff54':p.isBot?'#ffb86b':'#70dcff';ctx.beginPath();ctx.arc(x,z,p.id===state.myId?4:2.8,0,Math.PI*2);ctx.fill();if(p.id===state.myId){ctx.strokeStyle='#c8ff54';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,z,6,0,Math.PI*2);ctx.stroke();}}
  ctx.globalAlpha=1;
}
function updateLeaderboard(players) {
  const sorted=[...players].sort((a,b)=>b.kills-a.kills||b.xp-a.xp).slice(0,state.showFullBoard?10:5);
  $('leaderboard-rows').innerHTML=sorted.map((p,i)=>`<div class="leader-row ${p.id===state.myId?'me':''}"><span class="place">${String(i+1).padStart(2,'0')}</span><span class="leader-name">${p.name}${p.isBot?' · BOT':''}</span><span class="leader-score">${p.kills}</span></div>`).join('');
  $('leaderboard').classList.toggle('expanded',state.showFullBoard);
}
function updateFeed(feed) {
  const items=(feed||[]).slice(0,4);$('killfeed').innerHTML=items.map(f=>`<div class="feed-item ${f.kind==='join'?'join':f.kind==='round'?'round':''}">${escapeHtml(f.text)}</div>`).join('');
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function updateHud(my, players, match) {
  if(!my)return;
  state.health=my.health;state.currentAmmo=my.ammo;state.equipped=my.equipped||'primary';
  $('health-number').textContent=Math.round(my.health);$('health-fill').style.width=`${clamp(my.health,0,100)}%`;
  $('health-fill').style.background=my.health<35?'linear-gradient(90deg,#ff536d,#ff9a9f)':'linear-gradient(90deg,#a7e93c,#d7ff80)';
  $('health-card').classList.toggle('low-health',my.health<35);
  $('weapon-card').classList.toggle('reloading',!!my.reloading);
  $('kills-label').textContent=my.kills;$('deaths-label').textContent=my.deaths;$('streak-label').textContent=`${my.streak}×`;$('xp-label').textContent=`${my.xp} XP`;
  $('rank-chip').textContent=my.xp>=2000?'ACE':my.xp>=1000?'VETERAN':my.xp>=400?'VANGUARD':'ROOKIE';
  $('player-name').textContent=my.name.toUpperCase();$('avatar-chip').textContent=my.name.slice(0,2).toUpperCase();
  const knife=my.equipped==='knife';$('knife-banner').classList.toggle('hidden',!knife);
  $('weapon-symbol').textContent=knife?'KN':(GUN_META[my.weapon]?.short||'AR');
  $('weapon-name').textContent=knife?'COMBAT KNIFE':(GUN_META[my.weapon]?.title||'ASSAULT RIFLE');
  $('weapon-state').textContent=knife?'MELEE · 2.35M RANGE':(my.reloading?'RELOADING…':(GUN_META[my.weapon]?.stat||'PRIMARY WEAPON'));
  $('ammo-current').textContent=knife?'∞':my.ammo;$('ammo-reserve').textContent=knife?'':my.reserve;
  $('crosshair').classList.toggle('aimed',!!my.aiming&&!knife);
  $('status-label').textContent=my.reloading?'RELOADING':my.health<35?'LOW VITALS':my.alive?'COMBAT READY':'RESPAWNING';
  $('player-count').textContent=`${match.total} / 10 PLAYERS`; $('round-label').textContent=`ROUND ${String(match.round).padStart(2,'0')}`;
  const m=Math.floor(match.remaining/60),s=match.remaining%60;$('timer-label').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  if(my.alive){$('respawn-overlay').classList.add('hidden');} else {$('respawn-overlay').classList.remove('hidden');const left=Math.max(1,Math.ceil((2600-(Date.now()-state.deathAt))/1000));$('respawn-countdown').textContent=`REDEPLOYING IN ${left}`;}
}

socket.on('state',data=>{
  if(!data||!Array.isArray(data.players))return;
  state.players=data.players;state.playerById=new Map(data.players.map(p=>[p.id,p]));
  syncAvatars(data.players);updateFeed(data.feed);updateLeaderboard(data.players);drawMinimap(data.players);
  const my=state.playerById.get(state.myId);if(my)updateHud(my,data.players,data.match||{round:1,remaining:600,total:data.players.length});
});

function switchSlot(slot) {
  if(!state.joined)return;
  state.equipped=slot;state.mouse.left=false;state.mouse.right=false;state.aiming=false;
  socket.emit('switchSlot',slot);rebuildViewModel();
}
function keyToAction(e,pressed) {
  const k=e.key.toLowerCase();
  if(['w','a','s','d','shift','control',' ','tab'].includes(k))e.preventDefault();
  if(k==='w'||k==='a'||k==='s'||k==='d')state.keys[k]=pressed;
  if(k==='shift')state.keys.shift=pressed;
  if(k==='control')state.keys.ctrl=pressed;
  if(k===' '){state.keys.jump=pressed;}
  if(k==='tab'){state.showFullBoard=pressed;updateLeaderboard(state.players);}
  if(!pressed||e.repeat)return;
  if(k==='g'){openLoadout();return;}
  if(k==='1'){switchSlot('primary');}
  if(k==='2'){switchSlot('knife');}
  if(k==='r'&&state.joined&&state.equipped==='primary')socket.emit('reload');
  if(k==='escape'){state.mouse.left=false;state.mouse.right=false;state.aiming=false;}
}
document.addEventListener('keydown',e=>{keyToAction(e,true);});
document.addEventListener('keyup',e=>{keyToAction(e,false);});
window.addEventListener('blur',()=>{state.keys={};state.mouse.left=false;state.mouse.right=false;state.aiming=false;});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('mousedown',e=>{
  if(!state.joined||state.loadoutOpen)return;
  e.preventDefault();
  if(!state.pointerLocked){renderer.domElement.requestPointerLock?.();}
  // Updated controls: left button fires/attacks; right button aims with a gun.
  if(e.button===0){
    state.mouse.left=true;
    if(state.equipped==='knife'){socket.emit('melee');state.knifeSwingUntil=performance.now()+260;}
    else {socket.emit('shoot');state.lastFireAt=performance.now();}
  }
  if(e.button===2){state.mouse.right=true;state.aiming=state.equipped==='primary';}
});
window.addEventListener('mouseup',e=>{
  if(e.button===0)state.mouse.left=false;
  if(e.button===2){state.mouse.right=false;state.aiming=false;}
});
document.addEventListener('pointerlockchange',()=>{
  state.pointerLocked=document.pointerLockElement===renderer.domElement;
  if(state.pointerLocked){$('intro-hint').classList.add('hidden');}
  else if(state.joined&&!state.loadoutOpen){$('intro-hint').classList.remove('hidden');state.mouse.left=false;state.mouse.right=false;state.aiming=false;}
});
document.addEventListener('mousemove',e=>{
  if(!state.pointerLocked||!state.joined||state.loadoutOpen)return;
  const sensitivity=0.00215;
  state.yaw+=e.movementX*sensitivity;
  state.pitch=clamp(state.pitch-e.movementY*sensitivity,-1.18,1.18);
});

function updateRemoteMeshes(dt) {
  for(const [id,mesh] of state.remoteAvatars.entries()){
    const p=mesh.userData.target;if(!p)continue;
    const factor=1-Math.exp(-dt*13);
    mesh.position.x=THREE.MathUtils.lerp(mesh.position.x,p.x,factor);
    mesh.position.y=THREE.MathUtils.lerp(mesh.position.y,p.jumpY,factor);
    mesh.position.z=THREE.MathUtils.lerp(mesh.position.z,p.z,factor);
    mesh.rotation.y=-p.yaw;
    mesh.userData.nameSprite.material.opacity=p.health>0?1:.3;
    mesh.userData.weaponRoot.visible=p.equipped!=='knife';
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-(frame.last||now))/1000);frame.last=now;
  const my=state.playerById.get(state.myId);
  if(my&&state.joined){
    state.equipped=my.equipped||state.equipped;
    // The server owns movement; camera follows its authoritative position.
    camera.position.set(my.x,1.63+my.jumpY,my.z);
    camera.rotation.y=-state.yaw;camera.rotation.x=state.pitch;camera.rotation.z=0;
    const aiming=state.aiming&&state.equipped==='primary';
    const aimedFov=state.selectedWeapon==='sniper'?32:state.selectedWeapon==='shotgun'?56:59;
    const desiredFov=aiming?aimedFov:76;camera.fov=THREE.MathUtils.lerp(camera.fov,desiredFov,1-Math.exp(-dt*10));camera.updateProjectionMatrix();
    viewModel.visible=!!my.alive;
    if(state.equipped==='knife'&&knifeMesh){
      const swing=state.knifeSwingUntil>now;
      const progress=swing?1-(state.knifeSwingUntil-now)/260:0;
      knifeMesh.rotation.z=swing?Math.sin(progress*Math.PI)*-.9:.08;
      knifeMesh.rotation.x=swing?-.3:THREE.MathUtils.lerp(knifeMesh.rotation.x,-.12,1-Math.exp(-dt*7));
      knifeMesh.position.x=THREE.MathUtils.lerp(knifeMesh.position.x,swing?.27:.36,1-Math.exp(-dt*14));
    }
    if(state.mouse.left&&state.equipped==='primary'&&!state.loadoutOpen){
      const interval=state.selectedWeapon==='rifle'?105:state.selectedWeapon==='shotgun'?820:1120;
      if(now-state.lastFireAt>=interval){socket.emit('shoot');state.lastFireAt=now;}
    }
    if(now-state.lastInputAt>28){
      socket.emit('input',{keys:{...state.keys,jump:!!state.keys.jump},yaw:state.yaw,pitch:state.pitch,aiming});state.lastInputAt=now;
    }
  }
  // Animate the weapon lowering, magazine coming free, then seating back into place.
  if(vmGun && state.equipped==='primary'){
    const reloadElapsed=state.reloadDuration?now-state.reloadStartedAt:Infinity;
    const reloadProgress=state.reloadDuration?clamp(reloadElapsed/state.reloadDuration,0,1):0;
    if(state.reloadDuration && reloadProgress<1){
      const dip=Math.sin(reloadProgress*Math.PI);
      const weaponStyle=state.selectedWeapon;
      // Lower and cant the weapon to make room for the reload, then bring it back into the sightline.
      vmGun.position.set(reloadBaseGunPosition.x+dip*.075,reloadBaseGunPosition.y-dip*.24,reloadBaseGunPosition.z+dip*.12);
      vmGun.rotation.set(reloadBaseGunRotation.x+dip*.43,reloadBaseGunRotation.y+dip*.13,reloadBaseGunRotation.z+dip*.31);
      if(vmMagazine && reloadBaseMagazine){
        // Mag comes free early, stays out briefly, then seats firmly near the end.
        const eject=reloadProgress<.18 ? reloadProgress/.18 : reloadProgress<.70 ? 1 : 1-(reloadProgress-.70)/.30;
        const shellPulse=weaponStyle==='shotgun' ? Math.max(0,Math.sin(reloadProgress*Math.PI*5))*.045 : 0;
        vmMagazine.position.set(reloadBaseMagazine.x+eject*.23,reloadBaseMagazine.y-eject*.34+shellPulse,reloadBaseMagazine.z+eject*.07);
        vmMagazine.rotation.x=eject*.58;vmMagazine.rotation.z=eject*.19;
      }
      $('reload-fill').style.width=`${reloadProgress*100}%`;
      $('weapon-card').classList.add('reloading');
    } else {
      if(state.reloadDuration){state.reloadDuration=0;$('weapon-card').classList.remove('reloading');$('reload-fill').style.width='100%';}
      vmGun.position.copy(reloadBaseGunPosition);vmGun.rotation.copy(reloadBaseGunRotation);
      if(vmMagazine && reloadBaseMagazine){vmMagazine.position.set(reloadBaseMagazine.x,reloadBaseMagazine.y,reloadBaseMagazine.z);vmMagazine.rotation.set(0,0,0);}
    }
  }
  updateRemoteMeshes(dt);
  for(let i=state.shotLines.length-1;i>=0;i--){const e=state.shotLines[i];if(now>=e.expires){effectsGroup.remove(e.line);e.line.geometry.dispose();e.line.material.dispose();state.shotLines.splice(i,1);}else {e.line.material.opacity*=.965;}}
  if(now-state.lastToastAt>850)$('center-toast').textContent='';
  renderer.render(scene,camera);
}
window.addEventListener('resize',()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
renderWeaponOptions($('weapon-options'),'start');
rebuildViewModel();
requestAnimationFrame(frame);
