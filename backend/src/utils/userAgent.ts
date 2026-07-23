export function parseDeviceLabel(userAgent?: string): string {
  const ua = userAgent || '';
  if (!ua) return 'Unknown device';

  if (/Android TV|GoogleTV|AFT[A-Z]|BRAVIA|SmartTV/i.test(ua)) return 'Android TV';
  if (/Tizen|webOS|NetCast|HbbTV/i.test(ua)) return 'Smart TV';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows Phone/i.test(ua)) return 'Windows Phone';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Mobile/i.test(ua)) return 'Mobile browser';

  return 'Web browser';
}

export function parsePlayerLabel(userAgent?: string): string {
  const ua = userAgent || '';
  if (!ua) return 'Web player';

  const patterns: { re: RegExp; format: (m: RegExpMatchArray) => string }[] = [
    { re: /Live\s*Wave\s*([\d.]+)/i, format: (m) => `Live Wave ${m[1]}` },
    { re: /LiveWave\s*([\d.]+)/i, format: (m) => `Live Wave ${m[1]}` },
    { re: /TiviMate\s*([\d.]+)?/i, format: (m) => `TiviMate${m[1] ? ` ${m[1]}` : ''}` },
    { re: /IPTV\s*Smarters\s*([\d.]+)?/i, format: (m) => `IPTV Smarters${m[1] ? ` ${m[1]}` : ''}` },
    { re: /Perfect\s*Player\s*([\d.]+)?/i, format: (m) => `Perfect Player${m[1] ? ` ${m[1]}` : ''}` },
    { re: /VLC\/([\d.]+)/i, format: (m) => `VLC ${m[1]}` },
    { re: /Kodi\/([\d.]+)/i, format: (m) => `Kodi ${m[1]}` },
    { re: /ExoPlayerLib\/([\d.]+)/i, format: (m) => `ExoPlayer ${m[1]}` },
    { re: /AppleCoreMedia/i, format: () => 'Apple AVPlayer' },
    { re: /Chrome\/([\d.]+)/i, format: (m) => `Chrome ${m[1].split('.')[0]}` },
    { re: /Firefox\/([\d.]+)/i, format: (m) => `Firefox ${m[1].split('.')[0]}` },
    { re: /Edg\/([\d.]+)/i, format: (m) => `Edge ${m[1].split('.')[0]}` },
    { re: /Safari\/([\d.]+)/i, format: () => 'Safari' },
  ];

  for (const { re, format } of patterns) {
    const match = ua.match(re);
    if (match) return format(match);
  }

  return 'Web player';
}
