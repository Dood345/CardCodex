import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { ExternalStorage: 'EXTERNAL_STORAGE', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn() },
}));

import { NATIVE_TARGETS, savedMessage } from './saveFile';

describe('saveFile', () => {
  it('tries the public Downloads folder first on Android, then Documents', () => {
    expect(NATIVE_TARGETS.map((t) => [t.directory, t.folder, t.where])).toEqual([
      ['EXTERNAL_STORAGE', 'Download/', 'downloads'],
      ['DOCUMENTS', '', 'documents'],
    ]);
  });

  it('says where the file went', () => {
    expect(savedMessage({ where: 'downloads' }, 'a.json')).toBe('Saved to Downloads/a.json');
    expect(savedMessage({ where: 'documents' }, 'a.json')).toBe('Saved to Documents/a.json');
    expect(savedMessage({ where: 'share' }, 'a.json')).toBe('Shared a.json');
    expect(savedMessage({ where: 'browser' }, 'a.json')).toBe('Downloaded a.json');
  });
});
