// Public build-time switches allow each integration to be disabled independently.
export const marketFeatures = {
  calendar: process.env.NEXT_PUBLIC_MARKET_CALENDAR_ENABLED !== 'false',
  macro: process.env.NEXT_PUBLIC_MARKET_MACRO_ENABLED !== 'false',
};
