/**
 * Build-time switch between the two ways the client is served:
 *  - with the TxStory server (`npm start`): live lookups and server examples;
 *  - as a static site (`npm run build:site`): no backend. Examples are
 *    shipped recordings rebuilt in the browser, and live lookups need a local
 *    install.
 */
export const STATIC_SITE = import.meta.env.VITE_TXSTORY_STATIC === '1';

export const REPOSITORY_URL = 'https://github.com/ss1738/txstory';
export const repoFile = (path: string) => `${REPOSITORY_URL}/blob/main/${path}`;
