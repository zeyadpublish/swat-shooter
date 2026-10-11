// Asset set selection. Phones/tablets in a browser load the shrunk set in assets-mobile/ (1K HDR, textures <= 1024 px,
// props 512 px, meshopt). The Android app ships that set as assets/ and desktop uses the full set in assets/.
// Override with ?assets=mobile or ?assets=desktop.
import { isTouchDevice } from './touch.js';
const p = new URLSearchParams(location.search);
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const MOBILE_ASSETS = p.get('assets') === 'mobile' || (p.get('assets') !== 'desktop' && !native && isTouchDevice());
export const ASSET_DIR = MOBILE_ASSETS ? 'assets-mobile/' : 'assets/';
export const asset = (path) => ASSET_DIR + path.replace(/^assets\//, '');
