import { execSync } from 'node:child_process';
import os from 'node:os';

// Under `sudo`, os.homedir() resolves to root's home, not the invoking user's — native
// messaging manifests then get written where the browser (running as the real user) never
// looks, with no error at all. sudo sets SUDO_USER to the real username; resolve their
// actual home via the OS user database instead of assuming /home/<user>, since some
// distros/setups differ.
export function getRealHomeDir() {
  const sudoUser = process.env.SUDO_USER;
  if (!sudoUser || !process.getuid || process.getuid() !== 0) return os.homedir();

  try {
    if (os.platform() === 'darwin') {
      const out = execSync(`dscl . -read /Users/${sudoUser} NFSHomeDirectory`, { encoding: 'utf8' });
      const home = out.split(':')[1]?.trim();
      if (home) return home;
    } else {
      const out = execSync(`getent passwd ${sudoUser}`, { encoding: 'utf8' });
      const home = out.trim().split(':')[5];
      if (home) return home;
    }
  } catch {}
  return os.homedir();
}
