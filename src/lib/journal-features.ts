// Enable after the private bucket migration passes in the target environment.
export const journalFeatures = { screenshots: process.env.NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED === 'true' };
