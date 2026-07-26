// Hand-built levels. No procedural generation anywhere.
//
// Geometry conventions (used identically by the renderer and the collider):
//   box   -> p:[centreX, BOTTOM_Y, centreZ], s:[width, height, depth]
//   slope -> same, plus dir: the way the surface RISES ('+x','-x','+z','-z')
//   zone  -> p:[centreX, bottomY, centreZ], s:[w,h,d]  (an AABB trigger volume)
//   1 unit ~= 1 metre. A standing player is 1.85 tall and can step up 0.55.
//
// Exit zones are boxes, not radii, and always sit BEHIND their gate so that a
// player standing against a closed gate is never counted as having arrived.
//
// Every task below uses EXACTLY ONE of the five co-op mechanics:
//   hold | synced | fetch | defend | pattern

const C = {
  grass: 0x6f9c5a, dirt: 0x8a7250, stone: 0x9aa3ad, stoneDark: 0x5c646e,
  wood: 0x8b6b47, woodDark: 0x6b512f, roof: 0xb5533f, sand: 0xcbbb8a,
  tech: 0x3f7fd0, techDark: 0x24374f, rust: 0xa5543a, void: 0x2a2440,
  moss: 0x4f7a45, hot: 0xe2603a, cold: 0x51c9a0,
};

/** Four walls forming a hollow rectangle. Inner faces land on ±w/2, ±d/2. */
function ring(cx, cz, w, d, h, t, c, baseY = 0) {
  return [
    { p: [cx, baseY, cz - d / 2 - t / 2], s: [w + t * 2, h, t], c },
    { p: [cx, baseY, cz + d / 2 + t / 2], s: [w + t * 2, h, t], c },
    { p: [cx - w / 2 - t / 2, baseY, cz], s: [t, h, d], c },
    { p: [cx + w / 2 + t / 2, baseY, cz], s: [t, h, d], c },
  ];
}

/** Blocky cottage: four walls plus a flat roof slab you can stand on. */
function hut(cx, cz, w, d, h, wallC = C.wood, roofC = C.roof) {
  return [
    ...ring(cx, cz, w, d, h, 0.5, wallC),
    { p: [cx, h, cz], s: [w + 1.6, 0.5, d + 1.6], c: roofC },
  ];
}

// =====================================================================
// 0 — TRAINING GROUNDS
// =====================================================================
const training = {
  id: 'training',
  name: 'Training Grounds',
  objective: 'Follow the trainer’s drills.',
  hint: 'Every drill here is used in every level after it. Both of you must pass each one.',
  sky: 0x89c6f0, fogNear: 60, fogFar: 200,
  ground: { size: [56, 56], color: C.grass },
  spawns: [[-2.5, 0, 18], [2.5, 0, 18]],
  kill: -20,
  tutorial: true,
  boxes: [
    // 10 high: a 4-chain wall jump in a corner can clear a 7m wall
    ...ring(0, 0, 54, 54, 10, 1, C.stone),

    // sprint lane markers
    { p: [-9, 0, 8], s: [0.6, 0.35, 16], c: C.sand },
    { p: [9, 0, 8], s: [0.6, 0.35, 16], c: C.sand },

    // slide gate — 1.05 of clearance under the bar (crouch/slide only)
    { p: [-5.2, 0, 0], s: [1.2, 4.2, 1.2], c: C.woodDark },
    { p: [5.2, 0, 0], s: [1.2, 4.2, 1.2], c: C.woodDark },
    { p: [0, 1.05, 0], s: [11.6, 3.15, 1.2], c: C.hot },

    // wall-jump shaft: 7 wide, 12 deep, walls from y=0 up
    { p: [-3.5, 0, -10], s: [1, 13, 12], c: C.stoneDark },
    { p: [3.5, 0, -10], s: [1, 13, 12], c: C.stoneDark },
    // the ledge sits past the north end of the shaft, top at 5.4
    { p: [0, 4.6, -19], s: [10, 0.8, 6], c: C.moss },

    // firing step in front of the dummies
    { p: [0, 0, -13], s: [14, 0.5, 2], c: C.sand },
  ],
  slopes: [],
  gates: [
    { id: 'exit', p: [0, 0, 22.5], s: [8, 7, 1], c: C.techDark },
  ],
  npcs: [
    {
      id: 'trainer', name: 'Sergeant Vell', role: 'trainer', p: [0, 0, 14], color: 0xd8a13a,
      lines: ['Two of you, one exit. Learn the kit or die tired.'],
    },
  ],
  enemies: [
    { type: 'dummy', p: [-7, 0, -24] },
    { type: 'dummy', p: [0, 0, -24] },
    { type: 'dummy', p: [7, 0, -24] },
  ],
  tasks: [],
  exitGate: 'exit',
  exit: { p: [0, 0, 25], s: [8, 4, 3], label: 'Both of you, step through the gate' },
};

// =====================================================================
// 1 — VILLAGE HUB  (revisited between levels)
// =====================================================================
const hub = {
  id: 'hub',
  name: 'Village Hub',
  objective: 'Talk to the villagers, then take the road north.',
  hint: 'Press E near a villager to talk. The shopkeeper sells colours only — nothing that changes your stats.',
  sky: 0xa8d8f5, fogNear: 80, fogFar: 260,
  ground: { size: [90, 90], color: C.grass },
  spawns: [[-3, 0, 14], [3, 0, 14]],
  kill: -20,
  safe: true,
  boxes: [
    ...ring(0, 0, 88, 88, 9, 1.2, C.stoneDark),

    ...hut(-20, -6, 10, 9, 4.5),
    ...hut(-19, 12, 9, 8, 4),
    ...hut(20, -8, 11, 10, 5, C.sand, C.rust),
    ...hut(21, 11, 9, 9, 4.5, C.sand, C.rust),
    ...hut(-2, -28, 14, 10, 6, C.stone, C.roof),

    // square: well and planters (planters are jump-on height)
    { p: [0, 0, 0], s: [4, 1.2, 4], c: C.stone },
    { p: [0, 1.2, 0], s: [2.4, 2.6, 2.4], c: C.stoneDark },
    { p: [-7, 0, 5], s: [2.5, 0.9, 2.5], c: C.woodDark },
    { p: [7, 0, 5], s: [2.5, 0.9, 2.5], c: C.woodDark },

    // market stall (the shopkeeper stands behind it)
    { p: [11, 0, -1], s: [6, 0.2, 3], c: C.wood },
    { p: [11, 2.6, -1], s: [6.6, 0.3, 3.6], c: C.hot },
    { p: [8.2, 0.2, -1], s: [0.3, 2.4, 0.3], c: C.woodDark },
    { p: [13.8, 0.2, -1], s: [0.3, 2.4, 0.3], c: C.woodDark },

    // bell tower — the hold task pad sits at its south face
    { p: [-11, 0, -15], s: [4, 7, 4], c: C.stone },
    { p: [-11, 7, -15], s: [5.4, 0.6, 5.4], c: C.roof },

    // road out
    { p: [0, 0, 28], s: [10, 0.15, 26], c: C.dirt },
  ],
  slopes: [],
  gates: [
    { id: 'exit', p: [0, 0, 40], s: [10, 9, 1.2], c: C.techDark },
  ],
  npcs: [
    {
      id: 'quest', name: 'Elder Maro', role: 'quest', p: [-3.5, 0, -5], color: 0x4f7ad8,
      lines: ['Two of you came. Good — nothing out there opens for one.'],
    },
    {
      id: 'shop', name: 'Bexi the Dyer', role: 'shop', p: [11, 0, 1.8], color: 0xe0759a,
      lines: ['Colours only. I sell dye, not advantages.'],
    },
    {
      id: 'hint', name: 'Old Wick', role: 'hint', p: [6.5, 0, -13], color: 0x7fbf6a,
      lines: ['Stuck? Ask again in a moment. I only hold one useful thing at a time.'],
    },
  ],
  enemies: [],
  tasks: [
    {
      id: 'bell', kind: 'hold', label: 'Ring the village bell',
      p: [-11, 0, -11.6], r: 2.4, seconds: 4,
      hint: 'Stand on the pad and hold E. Step off and the progress resets.',
    },
  ],
  exitGate: 'exit',
  exit: { p: [0, 0, 42], s: [10, 5, 3], label: 'Both of you, take the road north' },
};

// =====================================================================
// 2 — GUNFIGHT ARENA
// =====================================================================
const arena = {
  id: 'arena',
  name: 'Gunfight Arena',
  objective: 'Clear three waves and set the relay.',
  hint: 'One holds E on the generator while the other runs the relay up the east ramp.',
  sky: 0xd9a06a, fogNear: 55, fogFar: 190,
  ground: { size: [70, 70], color: C.sand },
  spawns: [[-3, 0, 26], [3, 0, 26]],
  kill: -20,
  boxes: [
    ...ring(0, 0, 68, 68, 10, 1.2, C.stoneDark),

    // cover
    { p: [-12, 0, 10], s: [5, 1.6, 5], c: C.stone },
    { p: [12, 0, 10], s: [5, 1.6, 5], c: C.stone },
    { p: [-12, 0, -10], s: [5, 1.6, 5], c: C.stone },
    { p: [0, 0, 0], s: [7, 2.2, 7], c: C.rust },
    { p: [-22, 0, 2], s: [3, 3.2, 12], c: C.stone },
    { p: [0, 0, 20], s: [12, 1.4, 3], c: C.stone },
    { p: [0, 0, -20], s: [12, 1.4, 3], c: C.stone },

    // east catwalk, top at 5.0, fed by the ramp below
    { p: [27, 4.5, -14], s: [10, 0.5, 26], c: C.stoneDark },
    { p: [27, 5.0, -26.7], s: [10, 1.2, 0.6], c: C.rust },
    { p: [31.4, 5.0, -14], s: [1.2, 1.2, 26], c: C.rust },

    // generator housing (west)
    { p: [-27, 0, -18], s: [6, 3, 6], c: C.techDark },
    { p: [-27, 3, -18], s: [1.4, 2.4, 1.4], c: C.tech },
  ],
  slopes: [
    // Rises to 5.0 — the catwalk's TOP, not its base. A ramp that only reaches
    // the base leaves a step taller than STEP_HEIGHT once the player's radius
    // puts them against the edge, and the relay becomes unreachable.
    { p: [27, 0, 7], s: [10, 5.0, 16], dir: '-z', c: C.stoneDark },
  ],
  gates: [
    { id: 'exit', p: [0, 0, 30], s: [8, 10, 1.2], c: C.techDark },
  ],
  npcs: [],
  enemies: [],
  waves: [
    { enemies: [['grunt', 3]], delay: 3 },
    { enemies: [['grunt', 4], ['runner', 2]], delay: 4 },
    { enemies: [['grunt', 3], ['brute', 1]], delay: 4 },
  ],
  spawnPoints: [[-28, 0, 28], [28, 0, 28], [-28, 0, -28], [10, 0, -28], [0, 0, -30]],
  tasks: [
    {
      id: 'gen', kind: 'defend', label: 'Hold the generator while the relay is set',
      hold: { p: [-27, 0, -13.5], r: 2.6 },
      goal: { p: [27, 5.0, -22], r: 3.0 },
      hint: 'The holder must keep E down the whole time. Let go and the relay resets.',
    },
  ],
  exitGate: 'exit',
  exit: { p: [0, 0, 32], s: [8, 5, 3], label: 'Both of you, reach the north gate' },
};

// =====================================================================
// 3 — SWORDFIGHT CORRIDOR
// =====================================================================
const corridor = {
  id: 'corridor',
  name: 'Swordfight Corridor',
  objective: 'Cut through the guards, then throw both switches together.',
  hint: 'Bullets barely scratch these guards — press 3 for the sword, hold right-click to block.',
  sky: 0x2b2f3d, fogNear: 22, fogFar: 100,
  ground: { size: [44, 132], color: C.stoneDark },
  spawns: [[-2, 0, 56], [2, 0, 56]],
  kill: -20,
  gunDamageMul: 0.18,
  boxes: [
    // end caps
    { p: [0, 0, -64.6], s: [22.4, 11, 1.2], c: C.stone },
    { p: [0, 0, 64.6], s: [22.4, 11, 1.2], c: C.stone },
    // side walls, split to leave a doorway at z -49..-39 for each alcove
    { p: [-10.6, 0, -56.8], s: [1.2, 11, 15.6], c: C.stone },
    { p: [10.6, 0, -56.8], s: [1.2, 11, 15.6], c: C.stone },
    { p: [-10.6, 0, 12.5], s: [1.2, 11, 103], c: C.stone },
    { p: [10.6, 0, 12.5], s: [1.2, 11, 103], c: C.stone },

    // pinch points
    { p: [-7, 0, 34], s: [6, 11, 2], c: C.stone },
    { p: [7, 0, 34], s: [6, 11, 2], c: C.stone },
    { p: [-7, 0, 6], s: [6, 11, 2], c: C.stone },
    { p: [7, 0, 6], s: [6, 11, 2], c: C.stone },
    { p: [-7, 0, -24], s: [6, 11, 2], c: C.stone },
    { p: [7, 0, -24], s: [6, 11, 2], c: C.stone },

    // switch alcoves — hollow rooms reached through the doorways above
    { p: [-19.6, 0, -44], s: [1.2, 11, 12], c: C.stone },
    { p: [-15, 0, -49.6], s: [10, 11, 1.2], c: C.stone },
    { p: [-15, 0, -38.4], s: [10, 11, 1.2], c: C.stone },
    { p: [-18, 0, -44], s: [1, 3, 1.4], c: C.rust },
    { p: [19.6, 0, -44], s: [1.2, 11, 12], c: C.stone },
    { p: [15, 0, -49.6], s: [10, 11, 1.2], c: C.stone },
    { p: [15, 0, -38.4], s: [10, 11, 1.2], c: C.stone },
    { p: [18, 0, -44], s: [1, 3, 1.4], c: C.rust },

    // crates to fight around
    { p: [-5, 0, 20], s: [2, 3, 2], c: C.woodDark },
    { p: [5, 0, 20], s: [2, 3, 2], c: C.woodDark },
    { p: [0, 0, -6], s: [3, 2.4, 3], c: C.woodDark },
    { p: [-5, 0, -34], s: [2, 3, 2], c: C.woodDark },
    { p: [5, 0, -34], s: [2, 3, 2], c: C.woodDark },
  ],
  slopes: [],
  gates: [
    { id: 'exit', p: [0, 0, -55], s: [20, 11, 1.2], c: C.techDark },
  ],
  npcs: [],
  enemies: [
    { type: 'swordman', p: [0, 0, 40] },
    { type: 'swordman', p: [-4, 0, 24] },
    { type: 'swordman', p: [4, 0, 24] },
    { type: 'swordman', p: [0, 0, 10] },
    { type: 'brute', p: [0, 0, -2] },
    { type: 'swordman', p: [-4, 0, -18] },
    { type: 'swordman', p: [4, 0, -18] },
    { type: 'swordman', p: [0, 0, -30] },
    { type: 'brute', p: [-3, 0, -40] },
    { type: 'brute', p: [3, 0, -40] },
  ],
  tasks: [
    {
      id: 'locks', kind: 'synced', label: 'Throw both gate switches together',
      windowMs: 3000,
      pads: [
        { id: 'west', p: [-16.5, 0, -44], r: 2.4 },
        { id: 'east', p: [16.5, 0, -44], r: 2.4 },
      ],
      hint: 'Both switches must be thrown within 3 seconds of each other — count it out loud.',
    },
  ],
  exitGate: 'exit',
  exit: { p: [0, 0, -59], s: [18, 5, 4], label: 'Both of you, reach the south gate' },
};

// =====================================================================
// 4 — SLIDE & JUMP GAUNTLET  (no combat)
// =====================================================================
// Heights are deliberate: a sprint jump clears ~7 units flat and rises ~1.6.
const gauntlet = {
  id: 'gauntlet',
  name: 'Slide & Jump Gauntlet',
  objective: 'Cross the gauntlet. Bring the core to the terminal.',
  hint: 'Sprint then hold Ctrl to slide — a slide jump goes further than a run jump, and fits under the red bars.',
  // Long sight lines matter here: you have to judge a jump before committing.
  sky: 0x1d2233, fogNear: 110, fogFar: 420,
  ground: null,
  spawns: [[-2, 0, 6], [2, 0, 6]],
  kill: -25,
  noCombat: true,
  boxes: [
    // 1 — start pad, top 0
    { p: [0, -1, 6], s: [14, 1, 14], c: C.techDark },

    // 3 — long bar platform, top 2.0 (z -45..-15)
    { p: [0, 1.0, -30], s: [12, 1, 30], c: C.stoneDark },
    { p: [0, 3.05, -24], s: [12, 3, 1], c: C.hot },
    { p: [0, 3.05, -32], s: [12, 3, 1], c: C.hot },
    { p: [0, 3.05, -40], s: [12, 3, 1], c: C.hot },

    // 4 — stagger jumps
    { p: [-6, 1.0, -52], s: [6, 1, 6], c: C.stoneDark },   // top 2.0
    { p: [5, 2.5, -59], s: [6, 1, 6], c: C.stoneDark },    // top 3.5
    { p: [-5, 4.0, -67], s: [6, 1, 6], c: C.stoneDark },   // top 5.0

    // 5 — wall-jump shaft (interior x -10..-4), floor top 5.0
    { p: [-7, 4.0, -80], s: [6, 1, 16], c: C.stoneDark },
    { p: [-10.5, 0, -80], s: [1, 14, 16], c: C.void },
    { p: [-3.5, 0, -80], s: [1, 10, 16], c: C.void },      // top 10.0 = flush with the deck
    { p: [-7, 9.2, -86], s: [6, 0.8, 4], c: C.cold },      // core lip, top 10.0

    // 6 — high deck east, top 10.0
    { p: [3, 9.2, -80], s: [14, 0.8, 16], c: C.stoneDark },
    { p: [16, 9.2, -78], s: [12, 0.8, 12], c: C.stoneDark },

    // 8 — terminal deck, top 0
    { p: [16, -1, -40], s: [16, 1, 16], c: C.techDark },
    { p: [16, 0, -42], s: [3, 1.6, 1.6], c: C.tech },
  ],
  slopes: [
    // 2 — launch ramp: 0 at z=0, 2.5 at z=-8, then a 7-unit gap
    { p: [0, 0, -4], s: [10, 2.5, 8], dir: '-z', c: C.rust },
    // 7 — the long slide down: 10.0 at z=-72 down to 0 at z=-48
    { p: [16, 0, -60], s: [12, 10, 24], dir: '-z', c: C.stoneDark },
  ],
  gates: [
    { id: 'exit', p: [16, 0, -38], s: [10, 8, 1.2], c: C.techDark },
  ],
  checkpoints: [
    [0, 0, 6], [0, 2, -18], [0, 2, -42], [-6, 2, -52], [-5, 5, -67],
    [-7, 5, -76], [-7, 10, -86], [3, 10, -76], [16, 0, -45],
  ],
  npcs: [],
  enemies: [],
  tasks: [
    {
      id: 'core', kind: 'fetch', label: 'Carry the core to the terminal',
      item: { p: [-7, 10, -86] },
      console: { p: [16, 0, -42], r: 3.0 },
      hint: 'Whoever carries the core moves slower and cannot sprint — the other should scout ahead.',
    },
  ],
  exitGate: 'exit',
  exit: { p: [16, 0, -35], s: [10, 5, 3], label: 'Both of you, reach the terminal gate' },
};

// =====================================================================
// 5 — ZOMBIE HORDE SURVIVAL
// =====================================================================
const horde = {
  id: 'horde',
  name: 'Zombie Horde Survival',
  objective: 'Survive six waves. Back to back.',
  hint: 'Four ramps feed the keep — you cannot cover them all facing the same way.',
  sky: 0x1a1410, fogNear: 25, fogFar: 120,
  ground: { size: [76, 76], color: 0x3d3228 },
  spawns: [[-2, 2.6, 2], [2, 2.6, 2]],
  kill: -20,
  boxes: [
    ...ring(0, 0, 74, 74, 12, 1.4, 0x2a2119),

    // centre keep, top 2.6
    { p: [0, 0, 0], s: [16, 2.6, 16], c: C.stoneDark },
    { p: [-7, 2.6, -7], s: [2, 1.4, 2], c: C.stone },
    { p: [7, 2.6, -7], s: [2, 1.4, 2], c: C.stone },
    { p: [-7, 2.6, 7], s: [2, 1.4, 2], c: C.stone },
    { p: [7, 2.6, 7], s: [2, 1.4, 2], c: C.stone },

    // barricades
    { p: [-20, 0, 14], s: [8, 1.4, 1.4], c: C.woodDark },
    { p: [20, 0, 14], s: [8, 1.4, 1.4], c: C.woodDark },
    { p: [-20, 0, -14], s: [8, 1.4, 1.4], c: C.woodDark },
    { p: [20, 0, -14], s: [8, 1.4, 1.4], c: C.woodDark },
    { p: [0, 0, 26], s: [1.4, 1.4, 10], c: C.woodDark },
    { p: [0, 0, -26], s: [1.4, 1.4, 10], c: C.woodDark },

    // floodlight pylon (the wave-4 hold task)
    { p: [-25, 0, -25], s: [3, 6, 3], c: C.techDark },
    { p: [-25, 6, -25], s: [1.6, 1, 1.6], c: 0xe8c04a },
  ],
  slopes: [
    { p: [0, 0, 11], s: [8, 2.6, 6], dir: '-z', c: C.stoneDark },
    { p: [0, 0, -11], s: [8, 2.6, 6], dir: '+z', c: C.stoneDark },
    { p: [11, 0, 0], s: [6, 2.6, 8], dir: '-x', c: C.stoneDark },
    { p: [-11, 0, 0], s: [6, 2.6, 8], dir: '+x', c: C.stoneDark },
  ],
  gates: [
    { id: 'exit', p: [0, 0, 33], s: [8, 12, 1.4], c: C.techDark },
  ],
  npcs: [],
  enemies: [],
  waves: [
    { enemies: [['zombie', 5]], delay: 4 },
    { enemies: [['zombie', 7]], delay: 4 },
    { enemies: [['zombie', 6], ['runner', 3]], delay: 4 },
    { enemies: [['zombie', 8], ['runner', 3]], delay: 5 },
    { enemies: [['zombie', 8], ['runner', 4], ['brute', 1]], delay: 5 },
    { enemies: [['zombie', 10], ['runner', 5], ['brute', 2]], delay: 5 },
  ],
  spawnPoints: [
    [-30, 0, 30], [30, 0, 30], [-30, 0, -30], [30, 0, -30],
    [0, 0, 33], [0, 0, -33], [33, 0, 0], [-33, 0, 0],
  ],
  tasks: [
    {
      id: 'flood', kind: 'hold', label: 'Restart the floodlight',
      p: [-25, 0, -21.6], r: 2.4, seconds: 6, activeFromWave: 4,
      hint: 'One of you has to leave the keep for this — the other holds alone for six seconds.',
    },
  ],
  exitGate: 'exit',
  exit: { p: [0, 0, 35], s: [8, 5, 3], label: 'Both of you, reach the north gate' },
};

// =====================================================================
// 6 — FINAL LEVEL
// =====================================================================
const final = {
  id: 'final',
  name: 'The Broadcast',
  objective: 'Hold the mast, break the signal, stay alive.',
  hint: 'One holds the mast and fights; the other runs the colour console. Neither works alone.',
  sky: 0x241a2e, fogNear: 32, fogFar: 170,
  ground: { size: [80, 80], color: 0x342a3f },
  spawns: [[-3, 0, 26], [3, 0, 26]],
  kill: -20,
  boxes: [
    ...ring(0, 0, 78, 78, 13, 1.4, C.void),

    // central mast, platform top 1.2
    { p: [0, 0, 0], s: [10, 1.2, 10], c: C.techDark },
    { p: [0, 1.2, 0], s: [2.4, 14, 2.4], c: C.stoneDark },

    // cover
    { p: [-16, 0, 12], s: [6, 2, 2], c: C.stone },
    { p: [16, 0, 12], s: [6, 2, 2], c: C.stone },
    { p: [-16, 0, -12], s: [6, 2, 2], c: C.stone },
    { p: [16, 0, -12], s: [6, 2, 2], c: C.stone },
    { p: [-9, 0, 0], s: [2, 2.6, 8], c: C.stone },
    { p: [9, 0, 0], s: [2, 2.6, 8], c: C.stone },

    // NW console alcove, floor top 4.8, open on its +z side for the ramp
    { p: [-27, 4, -27], s: [14, 0.8, 14], c: C.techDark },
    { p: [-27, 4.8, -34.5], s: [15.5, 4, 1.5], c: C.stoneDark },
    { p: [-34.5, 4.8, -27], s: [1.5, 4, 14], c: C.stoneDark },
    { p: [-19.5, 4.8, -27], s: [1.5, 4, 14], c: C.stoneDark },

    // NE catwalk, top 4.8
    { p: [27, 4, -20], s: [10, 0.8, 22], c: C.stoneDark },
    { p: [31.4, 4.8, -20], s: [1.2, 1.2, 22], c: C.rust },
  ],
  slopes: [
    // 4.8 at the alcove edge (z=-20) down to 0 at z=-8
    { p: [-27, 0, -14], s: [8, 4.8, 12], dir: '-z', c: C.stoneDark },
    // 4.8 at the catwalk edge (z=-9) down to 0 at z=3
    { p: [27, 0, -3], s: [10, 4.8, 12], dir: '-z', c: C.stoneDark },
  ],
  gates: [
    { id: 'exit', p: [0, 0, 35], s: [8, 13, 1.4], c: C.techDark },
  ],
  npcs: [],
  enemies: [],
  waves: [
    { enemies: [['grunt', 4], ['swordman', 2]], delay: 4 },
    { enemies: [['grunt', 4], ['runner', 4], ['brute', 1]], delay: 5 },
    { enemies: [['grunt', 5], ['swordman', 3], ['brute', 2]], delay: 5 },
  ],
  spawnPoints: [[-34, 0, 34], [34, 0, 34], [-34, 0, -34], [34, 0, -34], [0, 0, -36], [12, 0, 34]],
  tasks: [
    {
      id: 'mast', kind: 'defend', label: 'Hold the mast while the breaker is thrown',
      hold: { p: [0, 1.2, 3.2], r: 2.8 },
      goal: { p: [27, 4.8, -26], r: 3.0 },
      hint: 'Holding E does not stop you shooting — the mast holder can still fight.',
    },
    {
      id: 'signal', kind: 'pattern', label: 'Match the broadcast pattern',
      p: [-27, 4.8, -27], r: 6,
      length: 4,
      buttons: [
        { id: 'r', p: [-30.5, 4.8, -29], color: 0xe2603a },
        { id: 'g', p: [-27, 4.8, -30.5], color: 0x5fbf5a },
        { id: 'b', p: [-23.5, 4.8, -29], color: 0x4a90d9 },
        { id: 'y', p: [-27, 4.8, -24], color: 0xe8c04a },
      ],
      hint: 'Watch the four pads flash, then press E on them in the same order.',
    },
  ],
  exitGate: 'exit',
  exit: { p: [0, 0, 37], s: [8, 5, 3], label: 'Both of you, reach the north gate' },
};

// =====================================================================

export const LEVELS = { training, hub, arena, corridor, gauntlet, horde, final };

// Campaign order. The hub sits before every fight, for shopping and a breather.
export const CAMPAIGN = [
  'training',
  'hub', 'arena',
  'hub', 'corridor',
  'hub', 'gauntlet',
  'hub', 'horde',
  'hub', 'final',
];

/** Quest-giver text, keyed by the campaign stage the players are about to enter. */
export const QUEST_TEXT = {
  2: 'North of here is an old arena, and gunmen hold it. One of you holds the generator while the other carries the relay up the east ramp.',
  4: 'The corridor under the chapel is full of armoured guards. Bullets skip off their plate — use the blade. Two switches at the far end, thrown together, open the gate.',
  6: 'The old maintenance run is broken open. No enemies down there, just a long fall. Fetch the core from the top of the shaft and carry it to the terminal.',
  8: 'Something is walking up out of the dark. Six waves. Hold the keep, and do not get separated.',
  10: 'Last one. The mast on the hill is broadcasting whatever calls them. One holds it, one breaks the signal.',
};

export function levelForStage(stage) {
  return LEVELS[CAMPAIGN[stage]] || null;
}

/** Training drills. A step clears only when BOTH players have performed it. */
export const TUTORIAL_STEPS = [
  { id: 'move', text: 'Move with W A S D, look with the mouse.' },
  { id: 'sprint', text: 'Hold Shift and sprint down the lane.' },
  { id: 'jump', text: 'Press Space to jump.' },
  { id: 'slide', text: 'Sprint, then hold Ctrl to slide under the red bar.' },
  { id: 'walljump', text: 'In the shaft, jump off one wall then the other to reach the ledge.' },
  { id: 'shoot', text: 'Destroy a training dummy. Left-click to fire, R to reload.' },
];
