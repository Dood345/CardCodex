#!/usr/bin/env node
/**
 * Build signed Android release APKs (one per ABI plus a universal one):
 *   1. vite build            → dist/
 *   2. cap sync android      → web assets + plugins into android/
 *   3. gradlew assembleRelease (signed when android/keystore.properties or the
 *      ANDROID_KEYSTORE_* environment variables are present)
 *   4. copy the APKs to release/ and print them.
 *
 * Usage: npm run android:release [-- --debug]   (--debug builds assembleDebug instead)
 * Needs JDK 21 (JAVA_HOME); on Windows the Android Studio JBR is used when JAVA_HOME is unset.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const debug = process.argv.includes('--debug');
const buildType = debug ? 'debug' : 'release';
const isWin = process.platform === 'win32';

const env = { ...process.env };
if (!env.JAVA_HOME && isWin) {
  const jbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (existsSync(join(jbr, 'bin', 'java.exe'))) env.JAVA_HOME = jbr;
}

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    console.error(`\n${cmd} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

if (!debug) {
  const hasProps = existsSync(join(androidDir, 'keystore.properties'));
  const hasEnv = !!(env.ANDROID_KEYSTORE_PATH && env.ANDROID_KEYSTORE_PASSWORD && env.ANDROID_KEY_ALIAS && env.ANDROID_KEY_PASSWORD);
  if (!hasProps && !hasEnv) {
    console.error(
      'No release signing configured: create android/keystore.properties (see README → Android → Release builds)\n' +
        'or set ANDROID_KEYSTORE_PATH / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD.',
    );
    process.exit(2);
  }
}

const npx = isWin ? 'npx.cmd' : 'npx';
run(npx, ['vite', 'build'], root);
run(npx, ['cap', 'sync', 'android'], root);
run(join(androidDir, isWin ? 'gradlew.bat' : 'gradlew'), [debug ? 'assembleDebug' : 'assembleRelease', '--no-daemon'], androidDir);

const outDir = join(androidDir, 'app', 'build', 'outputs', 'apk', buildType);
const apks = readdirSync(outDir).filter((f) => f.endsWith('.apk'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const releaseDir = join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
console.log(`\nCardCodex ${version} ${buildType} APKs:`);
for (const f of apks) {
  copyFileSync(join(outDir, f), join(releaseDir, f));
  console.log(`  release/${f}`);
}
if (!debug) console.log('\nInstall on a phone: adb install -r release/CardCodex-<version>-arm64-v8a-release.apk');
