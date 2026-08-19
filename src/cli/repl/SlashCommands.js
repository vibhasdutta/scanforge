/**
 * ScanForge Slash Commands Registry (Claude Code Style)
 */

export const SLASH_COMMANDS = [
  {
    name: '/audit',
    aliases: ['/run', '/scan'],
    args: '<url...>',
    description: 'Start Lighthouse audit on one or multiple URLs (or all queued targets)',
    category: 'Audit',
    examples: ['/audit', '/audit https://example.com', '/audit https://example.com https://example.com/pricing'],
  },
  {
    name: '/stop',
    aliases: ['/cancel'],
    args: '',
    description: 'Stop / cancel the running audit immediately',
    category: 'Audit',
    examples: ['/stop'],
  },
  {
    name: '/target',
    aliases: ['/targets', '/tar', '/list', '/urls', '/queue'],
    args: '[url, url, ...]',
    description: 'Manage target URLs — add, select, delete, and audit',
    category: 'Targets',
    examples: ['/target', '/target https://example.com', '/target https://example.com, https://example.com/docs'],
  },
  {
    name: '/clear',
    aliases: ['/clean', '/cls'],
    args: '',
    description: 'Clear the screen only — queued targets and saved audit reports are kept',
    category: 'Session',
    examples: ['/clear'],
  },
  {
    name: '/clearaudit',
    aliases: ['/auditclear', '/clearsession', '/resetaudit'],
    args: '',
    description: 'Clear all audit reports collected this session, for a fresh run',
    category: 'Reports',
    examples: ['/clearaudit'],
  },
  {
    name: '/settings',
    aliases: ['/config'],
    args: '',
    description: 'Open the interactive settings panel — mode, device, processing, categories, CPU & memory limits',
    category: 'Settings',
    examples: ['/settings'],
  },
  {
    name: '/report',
    aliases: ['/results', '/scores', '/r'],
    args: '',
    description: 'Browse this session\'s audit reports, select one or more, and save them as one combined Markdown report',
    category: 'Reports',
    examples: ['/report'],
  },
  {
    name: '/outdir',
    aliases: ['/savepath', '/path'],
    args: '[directory_path]',
    description: 'View or set custom export folder (defaults to OS Downloads folder)',
    category: 'Settings',
    examples: ['/outdir', '/outdir ./reports', '/outdir D:/Audits'],
  },
  {
    name: '/status',
    aliases: ['/info', '/companion'],
    args: '',
    description: 'Show companion server status (Port 3210 & Extension connection)',
    category: 'Status',
    examples: ['/status'],
  },
  {
    name: '/help',
    aliases: ['/?'],
    args: '',
    description: 'Show the complete list of slash commands and shortcuts',
    category: 'Help',
    examples: ['/help'],
  },
  {
    name: '/exit',
    aliases: ['/quit', '/q'],
    args: '',
    description: 'Exit ScanForge session',
    category: 'Session',
    examples: ['/exit'],
  },
];

export function findMatchingCommands(query) {
  if (!query.startsWith('/')) return [];
  const normalized = query.toLowerCase();
  return SLASH_COMMANDS.filter(cmd =>
    cmd.name.toLowerCase().startsWith(normalized) ||
    cmd.aliases.some(alias => alias.toLowerCase().startsWith(normalized)) ||
    cmd.description.toLowerCase().includes(normalized.slice(1))
  );
}
