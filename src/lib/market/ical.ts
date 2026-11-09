import 'server-only';

/** Narrow reader for non-recurring BLS/BEA publication feeds. */
export function parseOfficialIcal(
  text: string,
): { uid: string; title: string; date: string }[] {
  if (!text.startsWith('BEGIN:VCALENDAR') || !text.includes('END:VCALENDAR'))
    throw new Error('Invalid calendar');
  const result: { uid: string; title: string; date: string }[] = [];
  for (const block of text
    .replace(/\r?\n[ \t]/g, '')
    .split('BEGIN:VEVENT')
    .slice(1)) {
    const fields = new Map<string, { params: string; value: string }>();
    for (const line of block.split(/\r?\n/)) {
      if (line === 'END:VEVENT') break;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(';');
      fields.set(name, {
        params: params.join(';'),
        value: line.slice(colon + 1),
      });
    }
    if (fields.get('STATUS')?.value === 'CANCELLED') continue;
    if (fields.has('RRULE') || fields.has('RECURRENCE-ID'))
      throw new Error('Unsupported recurring release');
    const start = fields.get('DTSTART');
    const title = fields
      .get('SUMMARY')
      ?.value.replace(/\\[nN]/g, ' ')
      .replace(/\\([,;\\])/g, '$1')
      .trim();
    const uid = fields.get('UID')?.value;
    if (!start || !title || !uid) throw new Error('Incomplete release');
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(
      start.value,
    );
    if (!match) continue; // All-day and unknown-time releases have no countdown.
    const [, y, m, d, h, min, s, utc] = match;
    const local = `${y}-${m}-${d}T${h}:${min}:${s}`;
    const target = Date.parse(`${local}Z`);
    if (
      !Number.isFinite(target) ||
      new Date(target).toISOString().slice(0, 19) !== local
    )
      throw new Error('Invalid release date');
    let time = target;
    if (!utc) {
      const zone = start.params.match(/(?:^|;)TZID=([^;]+)/)?.[1];
      if (!zone || !['US-Eastern', 'America/New_York'].includes(zone))
        throw new Error('Unsupported calendar timezone');
      const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      for (let i = 0; i < 3; i++) {
        const represented = Date.parse(
          `${formatter.format(time).replace(' ', 'T')}Z`,
        );
        time += target - represented;
      }
      if (formatter.format(time).replace(' ', 'T') !== local)
        throw new Error('Nonexistent release time');
    }
    result.push({ uid, title, date: new Date(time).toISOString() });
  }
  return result;
}
