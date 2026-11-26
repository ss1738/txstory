/** How the UI and exports describe where a story's provider responses came from. */
import type { Story } from '../../core/types.js';

export interface ModeText {
  badge: string;
  title: string;
  sources: string;
  notice: string;
  card: string;
}

export function modeText(story: Pick<Story, 'mode' | 'sources' | 'generatedAt'>): ModeText {
  const recordedOn = story.sources[0]?.retrievedAt.slice(0, 10) ?? 'unknown date';
  switch (story.mode) {
    case 'recorded':
      return {
        badge: `Recorded example · ${recordedOn}`,
        title: 'Built from saved provider responses, not a fresh lookup.',
        sources: 'These are RECORDED responses saved in a recording; retrieval times are when they were recorded.',
        notice: 'Built from RECORDED provider responses (a saved recording), not a fresh lookup. See sources[].retrievedAt.',
        card: 'Recorded example (saved provider responses)',
      };
    case 'synthetic':
      return {
        badge: 'Synthetic example',
        title: 'Built from synthetic responses written for testing and demonstration. Not real provider data.',
        sources: 'These are SYNTHETIC responses generated for testing (scripts/synthetic-fixtures.ts). They are not real provider data.',
        notice: 'Built from SYNTHETIC provider responses generated for testing. This is not real provider data and not a real transaction.',
        card: 'Synthetic example (not real provider data)',
      };
    case 'mixed':
      return {
        badge: 'Mixed sources',
        title: 'Built partly from saved and partly from live responses.',
        sources: 'Some responses were fetched live and some were replayed from a recording; see each row.',
        notice: 'Built from a mix of live and recorded provider responses. See sources[].mode.',
        card: 'Mixed live and recorded responses',
      };
    case 'live':
      return {
        badge: `Live · ${story.generatedAt.slice(11, 16)} UTC`,
        title: 'Fetched live from the configured providers.',
        sources: 'Responses were fetched live at the times shown.',
        notice: 'Built from live provider responses at the times listed in sources[].retrievedAt.',
        card: `Live lookup · ${story.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
      };
  }
}
