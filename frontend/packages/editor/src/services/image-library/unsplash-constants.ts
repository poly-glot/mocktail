/**
 * Unsplash attribution constants. `UTM_SOURCE` is what photographer and
 * Unsplash links carry back to unsplash.com so they can attribute referrals
 * to this app — required by their API guidelines.
 */

export const UNSPLASH_UTM_SOURCE = 'mocktail';
export const UNSPLASH_UTM_MEDIUM = 'referral';

export function withUtm(href: string): string {
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=${UNSPLASH_UTM_MEDIUM}`;
}

export const UNSPLASH_HOME_URL = withUtm('https://unsplash.com/');
