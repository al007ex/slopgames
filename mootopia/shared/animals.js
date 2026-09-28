// The animals. Passive ones wander and run when hit; hostile ones charge the
// nearest player they can see. `sprite` is a file under img/animals/, `drawn`
// is one drawn in code. `score` is the gold for the kill, `drop` the food.

export const ANIMALS = [
  { id: 0, name: 'Deer', sprite: 'deer', biomes: ['grass'], count: 34,
    health: 500, weight: 0.8, speed: 0.00095, turnSpeed: 0.001, scale: 72, spriteMlt: 1.25, score: 150, drop: 50 },
  { id: 1, name: 'Arctic Fox', sprite: 'arcticfox_1', biomes: ['snow'], count: 14,
    health: 800, weight: 0.6, speed: 0.00085, turnSpeed: 0.001, scale: 66, spriteMlt: 1.5, score: 200, drop: 80 },
  { id: 2, name: 'Boar', drawn: 'boar', biomes: ['grass', 'desert'], count: 12, hostile: true, charge: true,
    health: 1800, dmg: 20, weight: 0.5, speed: 0.00094, turnSpeed: 0.00074, scale: 78, viewRange: 800, score: 1000, drop: 100 },
  { id: 3, name: 'Tusker', drawn: 'tusker', biomes: ['desert'], count: 6, hostile: true, charge: true,
    health: 2800, dmg: 20, weight: 0.45, speed: 0.001, turnSpeed: 0.0008, scale: 90, viewRange: 900, score: 2000, drop: 400 },
  { id: 4, name: 'Wolf', sprite: 'wolf_1', biomes: ['grass'], count: 14, hostile: true, charge: true,
    health: 300, dmg: 8, weight: 0.45, speed: 0.001, turnSpeed: 0.002, scale: 84, spriteMlt: 1.45, viewRange: 800, score: 500, drop: 200 },
  { id: 5, name: 'Snow Wolf', sprite: 'wolf_3', biomes: ['snow'], count: 9, hostile: true, charge: true,
    health: 450, dmg: 10, weight: 0.45, speed: 0.00105, turnSpeed: 0.002, scale: 84, spriteMlt: 1.45, viewRange: 850, score: 700, drop: 250 },
  { id: 6, name: 'Fox', sprite: 'fox_1', biomes: ['grass', 'desert'], count: 5, noTrap: true,
    health: 300, weight: 0.2, speed: 0.0018, turnSpeed: 0.006, scale: 62, spriteMlt: 1.55, score: 2000, drop: 100 },
  { id: 7, name: 'OLD GRIZZLE', drawn: 'bear', boss: true, fixedSpawn: [2600, 1250], respawn: 60000, count: 1, hostile: true, charge: true, noTrap: true,
    health: 18000, dmg: 40, colDmg: 100, weight: 0.4, speed: 0.0007, turnSpeed: 0.01, scale: 80, spriteMlt: 1.8, nameScale: 50,
    viewRange: 1000, hitRange: 210, hitDelay: 1000, leapForce: 0.9, score: 8000, drop: 100 },
  { id: 8, name: 'Treasure', drawn: 'chest', fixedSpawn: [11400, 13300], respawn: 120000, count: 1, hostile: true, still: true,
    health: 20000, colDmg: 200, weight: 0.1, speed: 0, turnSpeed: 0, scale: 70, nameScale: 35, score: 5000, drop: 0 },
];

export const animalById = (id) => ANIMALS[id];
