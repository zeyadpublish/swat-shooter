// Hand-drawn inline SVG icons for the HUD (original artwork, no external icon set).
const S = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;
const st = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  // full-auto fire: three stacked cartridges
  fire: S(`<g fill="currentColor"><path d="M12 1.6c-1.7 1.4-2.3 3.2-2.3 5.1h4.6c0-1.9-.6-3.7-2.3-5.1z"/><rect x="9.7" y="7.6" width="4.6" height="10.6" rx=".5"/><rect x="9.1" y="19" width="5.8" height="2.4" rx=".6"/>
    <path opacity=".55" d="M5.5 5.2c-1.3 1.1-1.8 2.5-1.8 4h3.6c0-1.5-.5-2.9-1.8-4zM3.7 10h3.6v8.2H3.7zM3.2 19h4.6v2.2H3.2zM18.5 5.2c-1.3 1.1-1.8 2.5-1.8 4h3.6c0-1.5-.5-2.9-1.8-4zM16.7 10h3.6v8.2h-3.6zM16.2 19h4.6v2.2h-4.6z"/></g>`),
  bullet: S(`<g fill="currentColor"><path d="M12 1.5c-2 1.6-2.6 3.6-2.6 5.6h5.2c0-2-.6-4-2.6-5.6z"/><rect x="9.4" y="8" width="5.2" height="11" rx=".6"/><rect x="8.8" y="19.8" width="6.4" height="2.5" rx=".7"/></g>`),
  scope: S(`<g ${st}><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></g><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`),
  reload: S(`<g ${st}><path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20.2 3.6v4.4h-4.4"/></g><path fill="currentColor" d="M10.1 7.6h3.6l.9 8.8h-3.7z"/><rect x="10.3" y="16.8" width="4.4" height="1.4" rx=".4" fill="currentColor" opacity=".7"/>`),
  jump: S(`<g ${st} stroke-width="2.4"><path d="M6 12.5l6-6 6 6"/><path d="M6 19l6-6 6 6" opacity=".6"/></g><path d="M5 3h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/>`),
  crouch: S(`<circle cx="13" cy="5" r="2.3" fill="currentColor"/><g ${st} stroke-width="2.3"><path d="M12.3 8.6l-2.6 5.4"/><path d="M9.7 14l4.8 1.4-.6 5.6"/><path d="M9.7 14l-2.4 4.4 3.4 2.4"/><path d="M12 9.8l4.6 2.2 3.2-.6"/></g>`),
  sprint: S(`<circle cx="15" cy="4" r="2.3" fill="currentColor"/><g ${st} stroke-width="2.3"><path d="M13.8 7.6l-2.8 5.6"/><path d="M13.4 8.8l3.4 2.4 2.8-.8"/><path d="M12.8 8.6l-3.6.4-2.2 2.6"/><path d="M11 13.2l3.6 2.6-1.4 5.2"/><path d="M11 13.2l-2.4 3.4-4.2.6"/></g>`),
  pause: S(`<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor"/>`),
  gear: S(`<circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-dasharray="3 2.97"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`),
  lock: S(`<rect x="5" y="10.5" width="14" height="10.5" rx="2.2" fill="currentColor"/><path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1" ${st} stroke-width="2.2"/>`),
  cross: S(`<path fill="currentColor" d="M9 2.8h6v6.2h6.2v6H15v6.2H9V15H2.8V9H9z"/>`),
  shield: S(`<path fill="currentColor" d="M12 2l8 3v6.2c0 5-3.4 9.1-8 10.8-4.6-1.7-8-5.8-8-10.8V5z"/>`),
  skull: S(`<path fill="currentColor" fill-rule="evenodd" d="M12 2.5a8 8 0 0 0-8 8c0 2.9 1.4 4.6 2.9 5.6V20a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1v-3.9c1.5-1 2.9-2.7 2.9-5.6a8 8 0 0 0-8-8zM8.6 9.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm6.8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM12 14.2l1.4 2.4h-2.8z"/>`),
  target: S(`<g ${st}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/></g><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`),
  wave: S(`<g ${st}><path d="M5 21.5V3"/><path d="M5 4h12.5l-2.6 4.2 2.6 4.3H5" fill="currentColor" fill-opacity=".35"/></g>`),
  star: S(`<path fill="currentColor" d="M12 2.2l2.9 6.3 6.8.7-5.1 4.6 1.5 6.8L12 17.2l-6.1 3.4 1.5-6.8L2.3 9.2l6.8-.7z"/>`),
  headshot: S(`<circle cx="12" cy="9.2" r="5" fill="currentColor"/><path fill="currentColor" d="M3.5 22c.3-4.2 3.9-6.6 8.5-6.6s8.2 2.4 8.5 6.6z"/><g fill="none" stroke="#ff3b30" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="9.2" r="7.2" stroke-width="1.6"/><path d="M12 .8v3.4M12 14.2v3.4M3.6 9.2H7M17 9.2h3.4"/></g>`),
  swap: S(`<path d="M4 9h13.5M14 5.5L17.5 9 14 12.5M20 15H6.5M10 11.5L6.5 15 10 18.5" ${st} stroke-width="2.3"/>`),
  exit: S(`<path d="M14 4h5v16h-5" ${st} stroke-width="2.2"/><path d="M3.5 12h11M10.5 7.5 15 12l-4.5 4.5" ${st} stroke-width="2.4"/>`),
  users: S(`<circle cx="9" cy="8" r="3.4" fill="currentColor"/><path d="M2.5 20c.4-4 3-6 6.5-6s6.1 2 6.5 6z" fill="currentColor"/><circle cx="17" cy="9" r="2.6" fill="currentColor" opacity=".7"/><path d="M15.5 13.6c3.2-.4 5.7 1.4 6 5.4h-4.6" fill="currentColor" opacity=".7"/>`),
  list: S(`<path d="M8 6.5h12M8 12h12M8 17.5h12" ${st} stroke-width="2.4"/><circle cx="4" cy="6.5" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="17.5" r="1.5" fill="currentColor"/>`),
  chat: S(`<path d="M4 5.5h16v10H10l-4.5 3.8V15.5H4z" ${st} stroke-width="2.2" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" ${st} stroke-width="1.8"/>`),
  // armoured vehicle (enter / exit)
  car: S(`<path fill="currentColor" d="M5.2 9.2l1.9-4.1c.3-.6.9-1 1.6-1h6.6c.7 0 1.3.4 1.6 1l1.9 4.1H21a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1h-1.3a2.7 2.7 0 0 1-5.3 0H9.6a2.7 2.7 0 0 1-5.3 0H3a1 1 0 0 1-1-1v-6.3a1 1 0 0 1 1-1zm2.3 0h9l-1.4-3.2H8.9z"/><circle cx="7" cy="17.5" r="1.4" fill="#000" opacity=".45"/><circle cx="17" cy="17.5" r="1.4" fill="#000" opacity=".45"/>`),
  // v1.5 (UI v4) icons
  chevR: S(`<path d="M9.5 6l6 6-6 6" ${st} stroke-width="2.4"/>`),
  back: S(`<path d="M14.5 5.5 8 12l6.5 6.5" ${st} stroke-width="2.6"/>`),
  info: S(`<circle cx="12" cy="12" r="9" ${st}/><path d="M12 11v6" ${st} stroke-width="2.4"/><circle cx="12" cy="7.6" r="1.4" fill="currentColor"/>`),
  monitor: S(`<rect x="3" y="4.5" width="18" height="12" rx="1.5" ${st}/><path d="M9 20h6M12 16.5V20" ${st}/>`),
  pad: S(`<path d="M7 8h10a4 4 0 0 1 3.9 4.9l-.9 3.9a2.2 2.2 0 0 1-3.8.9L14.5 16h-5l-1.7 1.7a2.2 2.2 0 0 1-3.8-.9l-.9-3.9A4 4 0 0 1 7 8z" ${st}/><path d="M8 11v3M6.5 12.5h3" ${st} stroke-width="1.8"/><circle cx="15.5" cy="11.5" r="1" fill="currentColor"/><circle cx="17.5" cy="13.5" r="1" fill="currentColor"/>`),
  audio: S(`<path d="M4 14v-3a8 8 0 0 1 16 0v3" ${st}/><rect x="3" y="13" width="4.5" height="7" rx="1.5" fill="currentColor"/><rect x="16.5" y="13" width="4.5" height="7" rx="1.5" fill="currentColor"/>`),
  plus: S(`<path d="M12 3v6M12 15v6M3 12h6M15 12h6" ${st} stroke-width="2.2"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`),
  play: S(`<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>`),
  edit: S(`<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19z" ${st}/><path d="M13.5 7l3.5 3.5" ${st}/>`),
  link: S(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" ${st}/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" ${st}/>`),
  bot: S(`<rect x="4" y="7.5" width="16" height="11" rx="2.5" ${st}/><path d="M12 4v3.5M2 12v3M22 12v3" ${st}/><circle cx="9" cy="13" r="1.6" fill="currentColor"/><circle cx="15" cy="13" r="1.6" fill="currentColor"/>`),
  user: S(`<circle cx="12" cy="8" r="3.8" ${st}/><path d="M4.5 20.5c.6-4 3.6-6.2 7.5-6.2s6.9 2.2 7.5 6.2" ${st}/>`),
  gas: S(`<path d="M12 20V5M6 11l6-6 6 6" ${st} stroke-width="2.6"/>`),
  brake: S(`<rect x="5" y="5" width="14" height="14" rx="2" ${st}/><path d="M9 12h6" ${st} stroke-width="2.6"/>`),
  hbrake: S(`<circle cx="12" cy="12" r="8.5" ${st}/><path d="M12 7.5v6" ${st} stroke-width="2.6"/><circle cx="12" cy="16.6" r="1.4" fill="currentColor"/>`),
  horn: S(`<path d="M3.5 10h3l6-4v12l-6-4h-3z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" ${st}/>`),
  bolt: S(`<path d="M13.5 2 5 13.5h6L10 22l9-12h-6z" fill="currentColor"/>`),
  trophy: S(`<path d="M7 4h10v5a5 5 0 0 1-10 0z" ${st}/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 20.5h8" ${st}/>`),
  signal: S(`<path d="M5 19v-3M10 19v-6M15 19v-9M20 19V7" ${st} stroke-width="2.6"/>`),
  chevron: S(`<path d="M7 14.5l5-5 5 5" ${st} stroke-width="2.6"/>`),
};
export const icon = (name, cls = '') => `<i class="ico ${cls}">${ICONS[name]}</i>`;
