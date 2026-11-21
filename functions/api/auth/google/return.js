// Only known office sections can appear after Google OAuth. Never allow
// absolute URLs, paths, query strings or arbitrary hash redirects.
const SECTION_NAMES = new Set([
  'overview','departments','agents','workflow','studio','production',
  'connections','wbFinance','ozonFinance','ozonProfit'
]);
export function safeOfficeReturn(value) {
  return typeof value === 'string' && SECTION_NAMES.has(value) ? value : 'overview';
}
