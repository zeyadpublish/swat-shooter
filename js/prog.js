// v1.5 progression + economy, saved on this device (localStorage 'swat-prog'):
// rank / XP, coins, unlocked weapons + operators, carried medkits, career stats.
const KEY = 'swat-prog';
export const need = (lv) => 800 + 100 * lv; // XP from rank lv to lv + 1
export const PRICES = { guns: { m4a1: 0, pistol: 0, akm: 400, shotgun: 600, svd: 900 }, medkit: 150 };
export const MEDKIT_MAX = 3;
export const COINS = { kill: 10, headshot: 5, wave: 25, win: 100, match: 30, streak: 15 };
const BASE = () => ({ xp: 0, coins: 250, guns: ['m4a1', 'pistol'], ops: ['swat', 'breacher'], op: 'swat', medkits: 1, matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, bestWave: 0, bestScore: 0, bestStreak: 0, levels: {} });
let P = null;
export function prog() {
  if (P) return P;
  try { P = Object.assign(BASE(), JSON.parse(localStorage.getItem(KEY) || '{}') || {}); } catch (e) { P = BASE(); }
  return P;
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(prog())); } catch (e) {} }
export function levelOf(xp) { let lv = 1, rest = Math.max(0, xp | 0); while (rest >= need(lv) && lv < 99) { rest -= need(lv); lv++; } return { lv, cur: rest, need: need(lv), frac: rest / need(lv) }; }
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export function addCoins(n) { const p = prog(); p.coins = Math.max(0, (p.coins | 0) + Math.round(n)); save(); return p.coins; }
export function addXP(n) { const p = prog(), before = levelOf(p.xp); p.xp += Math.round(n); save(); const after = levelOf(p.xp); return { before, after, up: after.lv > before.lv }; }
// v1.5 ranks: names per level + rank gates on some weapons / operators (on top of the coin price)
export const RANKS = ['RECRUIT', 'PRIVATE', 'PRIVATE 1ST CLASS', 'SPECIALIST', 'CORPORAL', 'SERGEANT', 'STAFF SERGEANT', 'SGT 1ST CLASS', 'MASTER SERGEANT', 'FIRST SERGEANT', 'SERGEANT MAJOR', '2ND LIEUTENANT', '1ST LIEUTENANT', 'CAPTAIN', 'MAJOR', 'LT COLONEL', 'COLONEL', 'COMMANDER'];
export const rankName = (lv) => RANKS[Math.min(RANKS.length - 1, Math.max(0, lv - 1))];
export const RANK_REQ = { gun: { akm: 2, shotgun: 3, svd: 5 }, op: { ranger: 2, viper: 3, sentinel: 5, warden: 6, recon: 8, sergeant: 10 } };
export const rankReq = (kind, id) => (RANK_REQ[kind] || {})[id] || 0;
export const rankOK = (kind, id) => levelOf(prog().xp).lv >= rankReq(kind, id);
export function owns(kind, id) { const p = prog(); return kind === 'gun' ? (PRICES.guns[id] === 0 || p.guns.includes(id)) : p.ops.includes(id); }
// spend coins; returns true when bought
export function buy(kind, id, price) {
  const p = prog(); if (p.coins < price) return false;
  if ((kind === 'gun' || kind === 'op') && !rankOK(kind, id)) return false;
  if (kind === 'medkit') { if (p.medkits >= MEDKIT_MAX) return false; p.medkits++; }
  else if (kind === 'gun') { if (owns('gun', id)) return false; p.guns.push(id); }
  else if (kind === 'op') { if (owns('op', id)) return false; p.ops.push(id); }
  p.coins -= price; save(); return true;
}
