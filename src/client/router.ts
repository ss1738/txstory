import { useEffect, useState } from 'react';
import { CHAIN_KEY_PATTERN, type ChainKey } from '../core/chains.js';

export type Route =
  | { name: 'home' }
  | { name: 'story'; chain: ChainKey; hash: string; example: boolean; focus: string | null }
  | { name: 'about' }
  | { name: 'not-found'; path: string };

export function parseRoute(location: Pick<Location, 'pathname' | 'search' | 'hash'>): Route {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'home' };
  if (path === '/about') return { name: 'about' };
  const m = /^\/(tx|example)\/([^/]+)\/(0x[0-9a-fA-F]{64})$/.exec(path);
  // Any well-formed network key: the server knows which networks exist (custom ones too).
  if (m && CHAIN_KEY_PATTERN.test(m[2]!)) {
    const focus = new URLSearchParams(location.search).get('m');
    return { name: 'story', example: m[1] === 'example', chain: m[2]!, hash: m[3]!.toLowerCase(), focus: focus && /^[a-z:0-9-]{1,40}$/.test(focus) ? focus : null };
  }
  return { name: 'not-found', path };
}

export function storyPath(chain: ChainKey, hash: string, example = false): string {
  return `/${example ? 'example' : 'tx'}/${chain}/${hash.toLowerCase()}`;
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}
