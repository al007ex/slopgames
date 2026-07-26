import './styles.css';

import { GameMode } from '@shared/constants';
import type { MatchInitMsg, MatchOverMsg, Snapshot } from '@shared/types';
import { api, getToken, setToken, type Profile } from './api';
import { initAudio, setAudioEnabled, sfx } from './audio';
import { GameClient } from './game/game';
import { Net } from './net';
import { el, mount } from './ui/dom';
import { confirmDialog, queueOverlay, resultsOverlay, toast, type QueueHandle } from './ui/overlays';
import {
  authScreen,
  brawlersScreen,
  homeScreen,
  navbar,
  rankScreen,
  roadScreen,
  settingsScreen,
  shopScreen,
  topbar,
} from './ui/screens';

export type ScreenName = 'auth' | 'home' | 'brawlers' | 'shop' | 'road' | 'rank' | 'settings';

export interface PartyInfo {
  code: string;
  leader: string;
  members: { id: string; name: string; brawler: string; trophies: number }[];
}

export class App {
  profile: Profile | null = null;
  net = new Net();
  screen: ScreenName = 'auth';
  mode: GameMode = GameMode.GemGrab;
  vsBots = true;
  party: PartyInfo | null = null;

  private uiRoot = document.getElementById('ui') as HTMLDivElement;
  private canvas = document.getElementById('game') as HTMLCanvasElement;
  private game: GameClient;
  private queue: QueueHandle | null = null;
  private inMatch = false;
  private matchChrome: HTMLElement | null = null;

  constructor() {
    this.game = new GameClient(this.canvas, (cmd) => this.net.send(cmd));
    this.wireNet();

    const savedMode = localStorage.getItem('pixelbrawl.mode') as GameMode | null;
    if (savedMode && Object.values(GameMode).includes(savedMode)) this.mode = savedMode;
    const savedBots = localStorage.getItem('pixelbrawl.vsBots');
    if (savedBots !== null) this.vsBots = savedBots === '1';
    if (localStorage.getItem('pixelbrawl.sound') === '0') setAudioEnabled(false);

    const unlock = () => {
      initAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /* -------------------------------- boot -------------------------------- */

  async boot() {
    const token = getToken();
    if (!token) return this.go('auth');
    try {
      const { profile } = await api.profile();
      this.profile = profile;
      this.net.connect(token);
      this.go('home');
    } catch {
      setToken('');
      this.go('auth');
    }
  }

  onAuth(token: string, profile: Profile) {
    setToken(token);
    this.profile = profile;
    this.net.connect(token);
    this.go('home');
  }

  logout() {
    setToken('');
    this.profile = null;
    this.party = null;
    this.net.close();
    this.go('auth');
  }

  /* ------------------------------ rendering ----------------------------- */

  go(screen: ScreenName) {
    this.screen = screen;
    if (screen !== 'home') this.cancelQueue(false);
    this.render();
  }

  setProfile(p: Profile) {
    this.profile = p;
    this.render();
  }

  render() {
    if (this.inMatch) return;
    localStorage.setItem('pixelbrawl.mode', this.mode);
    localStorage.setItem('pixelbrawl.vsBots', this.vsBots ? '1' : '0');

    const stage = el('div', { class: 'bg-stage' }, el('div', { class: 'bg-grid' }));

    if (!this.profile || this.screen === 'auth') {
      mount(this.uiRoot, stage, authScreen(this));
      return;
    }

    let body: HTMLElement;
    switch (this.screen) {
      case 'brawlers':
        body = brawlersScreen(this);
        break;
      case 'shop':
        body = shopScreen(this);
        break;
      case 'road':
        body = roadScreen(this);
        break;
      case 'rank':
        body = rankScreen(this);
        break;
      case 'settings':
        body = settingsScreen(this);
        break;
      default:
        body = homeScreen(this);
    }

    mount(this.uiRoot, stage, topbar(this), body, this.screen === 'settings' ? null : navbar(this));
  }

  async refreshProfile() {
    try {
      const { profile } = await api.profile();
      this.profile = profile;
      this.render();
    } catch {
      /* keep the cached profile if the request fails */
    }
  }

  /* ----------------------------- matchmaking ---------------------------- */

  play() {
    if (!this.profile) return;
    if (this.queue) return;
    if (this.party && this.party.leader !== this.myConnId && this.party.members.length > 1) {
      toast('ONLY THE PARTY LEADER CAN START');
      return;
    }
    this.net.send({ t: 'queue', mode: this.mode, vsBots: this.vsBots });
    this.queue = queueOverlay(this.mode, this.vsBots, () => this.cancelQueue(true));
  }

  private cancelQueue(notifyServer: boolean) {
    if (!this.queue) return;
    this.queue.close();
    this.queue = null;
    if (notifyServer) this.net.send({ t: 'cancel' });
  }

  myConnId = '';

  /* ------------------------------- network ------------------------------ */

  private wireNet() {
    this.net.on('auth_ok', (m) => {
      this.profile = m.profile;
      if (!this.inMatch) this.render();
    });
    this.net.on('auth_fail', () => {
      setToken('');
      this.logout();
      toast('SESSION EXPIRED - SIGN IN AGAIN');
    });
    this.net.on('kicked', () => {
      toast('SIGNED IN SOMEWHERE ELSE');
      this.net.close();
    });
    this.net.on('profile', (m) => {
      this.profile = m.profile;
      if (!this.inMatch) this.render();
    });
    this.net.on('error', (m) => toast(String(m.msg ?? 'ERROR')));

    this.net.on('party', (m) => {
      this.party = m.code ? { code: m.code, leader: m.leader, members: m.members } : null;
      if (this.party) {
        const me = this.party.members.find((x) => x.name === this.profile?.name);
        if (me) this.myConnId = me.id;
      }
      if (!this.inMatch) this.render();
    });

    this.net.on('queue_status', (m) => {
      this.queue?.update(`${m.have} / ${m.need} PLAYERS  ${m.waited}S`);
    });
    this.net.on('queue_cancel', () => this.cancelQueue(false));

    this.net.on('match_init', (m: MatchInitMsg) => this.startMatch(m));
    this.net.on('snap', (m: { s: Snapshot }) => {
      this.game.ping = this.net.ping;
      this.game.onSnapshot(m.s);
    });
    this.net.on('match_over', (m: MatchOverMsg & { profile?: Profile }) => this.endMatch(m));

    this.net.on('close', () => {
      if (this.inMatch) toast('CONNECTION LOST - RECONNECTING');
    });
  }

  private startMatch(init: MatchInitMsg) {
    this.cancelQueue(false);
    this.inMatch = true;
    this.uiRoot.classList.add('hidden');
    this.canvas.hidden = false;
    initAudio();
    this.game.start(init);

    this.matchChrome = el(
      'div',
      { style: { position: 'absolute', top: 'calc(4px + var(--safe-t))', right: 'calc(4px + var(--safe-r))' } },
      el('button', {
        class: 'btn-sm btn-ghost',
        text: 'QUIT',
        style: { opacity: '0.75' },
        onclick: () =>
          confirmDialog('LEAVE MATCH?', 'YOU WILL LOSE TROPHIES FOR ABANDONING.', () => {
            this.net.send({ t: 'leave' });
            this.leaveMatch();
          }),
      }),
    );
    document.getElementById('overlays')!.appendChild(this.matchChrome);
  }

  private endMatch(m: MatchOverMsg & { profile?: Profile }) {
    if (!this.inMatch) return;
    if (m.profile) this.profile = m.profile;
    resultsOverlay(m, this.game.mode, () => {
      this.leaveMatch();
      void this.refreshProfile();
    });
  }

  private leaveMatch() {
    this.inMatch = false;
    this.game.stop();
    this.canvas.hidden = true;
    this.uiRoot.classList.remove('hidden');
    this.matchChrome?.remove();
    this.matchChrome = null;
    this.render();
  }
}

const app = new App();
void app.boot();

// expose for quick debugging in the console
(window as any).app = app;
void sfx;
