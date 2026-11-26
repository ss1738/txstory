import { useCallback, useEffect, useReducer } from 'react';
import type { ChainKey } from '../core/chains.js';
import type { Story } from '../core/types.js';
import { ApiError, fetchStory } from './api.js';

export type StoryState =
  | { status: 'loading' }
  /** Fast stage shown; the cross-check is still loading. */
  | { status: 'partial'; story: Story }
  | { status: 'ready'; story: Story; enrichError?: string }
  | { status: 'error'; error: ApiError };

type Action =
  | { type: 'start' }
  | { type: 'fast'; story: Story }
  | { type: 'full'; story: Story }
  | { type: 'enrich-failed'; message: string }
  | { type: 'error'; error: ApiError };

function reducer(state: StoryState, a: Action): StoryState {
  switch (a.type) {
    case 'start': return { status: 'loading' };
    case 'fast': return state.status === 'ready' ? state : { status: 'partial', story: a.story };
    case 'full': return { status: 'ready', story: a.story };
    case 'enrich-failed': return state.status === 'partial' ? { status: 'ready', story: state.story, enrichError: a.message } : state;
    case 'error': return state.status === 'partial' || state.status === 'ready' ? state : { status: 'error', error: a.error };
  }
}

/**
 * Load a story in two stages: a fast story (RPC + quick explorer endpoints)
 * renders first; the full story adds the explorer balance cross-check.
 */
export function useStory(chain: ChainKey, hash: string, example: boolean) {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' } as StoryState);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const ctrl = new AbortController();
    dispatch({ type: 'start' });
    const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError('internal', 'Unexpected error while loading the story.'));
    const fast = fetchStory(chain, hash, { stage: 'fast', example, signal: ctrl.signal })
      .then((story) => { if (!ctrl.signal.aborted) dispatch({ type: 'fast', story }); return true; })
      .catch((e: unknown) => { if (!ctrl.signal.aborted && (e as Error).name !== 'AbortError') dispatch({ type: 'error', error: asError(e) }); return false; });
    fetchStory(chain, hash, { stage: 'full', example, signal: ctrl.signal })
      .then((story) => { if (!ctrl.signal.aborted) dispatch({ type: 'full', story }); })
      .catch(async (e: unknown) => {
        if (ctrl.signal.aborted || (e as Error).name === 'AbortError') return;
        const fastOk = await fast;
        if (fastOk) dispatch({ type: 'enrich-failed', message: asError(e).message });
        else dispatch({ type: 'error', error: asError(e) });
      });
    return () => ctrl.abort();
  }, [chain, hash, example, attempt]);

  return { state, retry: useCallback(() => retry(), []) };
}
