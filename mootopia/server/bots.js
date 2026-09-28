// Computer players that keep a quiet server lively. They leave one by one as
// real players arrive. (Their brains arrive in a later milestone.)

export class Bots {
  constructor(game, target = 0) {
    this.game = game;
    this.target = target;
    this.list = [];
  }

  humans() { let n = 0; for (const p of this.game.players.values()) if (!p.bot) n++; return n; }

  fill() {}
  makeRoom() {}
  update() {}
}
