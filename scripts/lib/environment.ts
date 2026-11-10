import fs from 'node:fs';

export function loadLocalEnvironment() {
  if (!fs.existsSync('.env.local')) return;
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function daysArgument(defaultDays = 60) {
  const raw = process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1];
  const days = raw ? Number(raw) : defaultDays;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('--days must be an integer from 1 to 365');
  return days;
}
