/** Prepare an isolated genuine Ego probe. Default is read-only; this script NEVER launches Ego. */
import { readFile, writeFile, mkdir, mkdtemp, lstat, readdir, realpath, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flag = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const homeDirectory = homedir();
const metadataRoots = [
  '.agents/skills', '.codex/skills', '.claude/skills', '.cursor/skills', '.gemini/skills', '.windsurf/skills', '.opencode/skills', '.config/opencode/skills',
  '.codex/config.toml', '.codex/rules/default.rules', '.claude/settings.json', '.cursor/mcp.json', '.local/bin/ego-browser', '.local/share/ego', '.ego-browser',
  '.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile',
  'Library/Preferences/com.citrolabs.ego.lite.plist',
  'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist',
  'Library/Application Support/ego', 'Library/Application Support/ego lite', 'Library/Application Support/Ego', 'Library/Application Support/Ego Lite',
  'Library/Caches/com.citrolabs.ego.lite',
];

// Only directory/file metadata is read. Existing credentials and profile contents are never opened.
async function globalMetadata() {
  const records = {};
  const visit = async (path, recurse) => {
    let entry;
    try { entry = await lstat(path, { bigint: true }); }
    catch (error) { records[path] = { missing: error.code === 'ENOENT', error: error.code === 'ENOENT' ? undefined : error.code }; return; }
    records[path] = { type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file', size: String(entry.size), mtimeNs: String(entry.mtimeNs), ctimeNs: String(entry.ctimeNs), mode: String(entry.mode), inode: String(entry.ino) };
    if (entry.isDirectory() && !entry.isSymbolicLink() && recurse) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), true);
    }
  };
  for (const relative of metadataRoots) await visit(join(homeDirectory, relative), relative.endsWith('/skills') || relative === '.local/share/ego');
  return records;
}

export function sandboxPolicy({ testRoot, app, sdk, homeDirectory }) {
  const quote = value => JSON.stringify(value);
  return `(version 1)
; Restrict this native app and its child processes, not the user's other apps.
(allow default)
; All writes are denied except this disposable root and the null device.
(deny file-write*)
(allow file-write* (subpath ${quote(testRoot)}) (literal "/dev/null"))
; Deny all reads under the real home, including every private browser/profile
; and agent configuration. The pinned single-file SDK is the only exception.
(deny file-read* (subpath ${quote(homeDirectory)}))
(allow file-read* (subpath ${quote(testRoot)}) (subpath ${quote(app)}) (literal ${quote(sdk)}))
; Block launch/default-handler and preference services that could delegate a
; global write outside the process. Do not use LaunchServices to start Ego.
(deny mach-lookup
  (global-name "com.apple.coreservices.launchservicesd")
  (global-name "com.apple.lsd.modifydb")
  (global-name "com.apple.cfprefsd.agent")
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.securityd")
  (global-name "com.apple.nsurlsessiond"))
; Fixture traffic is local. Native named-service Mach IPC remains available.
(deny network-outbound)
(allow network-outbound (remote tcp "localhost:*") (subpath ${quote(testRoot)}))
`;
}

async function inspection() {
  const report = JSON.parse(await readFile(join(root, 'artifacts/ego-host-inspection.json'), 'utf8'));
  const app = await realpath(report.app), helper = await realpath(report.helper);
  const executable = join(app, 'Contents/MacOS/ego lite');
  await access(executable, constants.X_OK); await access(helper, constants.X_OK);
  if (report.signature.appNormalVerificationExit !== 0 || report.signature.helperNormalVerificationExit !== 0) throw new Error('Recorded app/helper verification is not successful; inspect signatures again before preparing.');
  return { report, app, helper, executable, sdk: join(root, 'upstream/ego-lite/package/ego-browser/dist/out/index.js') };
}

async function prepare() {
  const info = await inspection();
  const testRoot = await realpath(await mkdtemp(join(tmpdir(), 'jevry-ego-native-')));
  const profile = join(testRoot, 'profile'), state = join(testRoot, 'sdk-state'), nativeTmp = join(testRoot, 'native-tmp');
  for (const path of [profile, state, nativeTmp]) await mkdir(path, { mode: 0o700 });
  const serviceName = `jevry-ego-${randomUUID()}`;
  const policyPath = join(testRoot, 'ego-isolation.sb');
  await writeFile(policyPath, sandboxPolicy({ ...info, testRoot, homeDirectory }), { mode: 0o600 });
  const baseline = await globalMetadata();
  const baselinePath = join(testRoot, 'global-metadata-before.json');
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n', { mode: 0o600 });
  const taskName = `Jevry genuine Ego isolation ${randomUUID()}`;
  const probePath = join(testRoot, 'native-probe.mjs');
  await writeFile(probePath, `// Run only after profile/global checks and minimal no-import onboarding.
process.env.EGO_BROWSER_STATE_DIR = ${JSON.stringify(state)};
process.env.EGO_BROWSER_PAGE_BUDGET = '3';
if (!globalThis.ego) throw new Error('Genuine Ego native bindings unavailable');
const task = await taskSpace(${JSON.stringify(taskName)});
try {
  const page = task.page('p1');
  await page.goto('about:blank');
  const version = await task.cdp('Browser.getVersion');
  console.log(JSON.stringify({genuineNativeBindings:true,taskSpaceId:task.spaceId,pageUrl:await page.url(),browserVersion:version,stateDir:process.env.EGO_BROWSER_STATE_DIR}));
} finally { await task.finish({keep:[]}); }
`, { mode: 0o600 });
  const manifest = {
    generatedAt: new Date().toISOString(), phase: 'prepared-no-launch', app: info.app, helper: info.helper, executable: info.executable, sdk: info.sdk,
    verifiedDownload: { sha256: info.report.sha256, version: info.report.version, authority: info.report.signature.authority, strictVerificationCaveat: info.report.signature.deepStrictFailure },
    testRoot, profile, state, nativeTmp, serviceName, policyPath, baselinePath, probePath, taskName,
    launch: { executable: '/usr/bin/sandbox-exec', args: ['-f', policyPath, info.executable, `--user-data-dir=${profile}`, `--ego-server-name=${serviceName}`, '--startup-ego-browser-service', 'about:blank'], environmentDelta: { TMPDIR: nativeTmp }, cwd: testRoot, stdoutPath: join(testRoot, 'app.stdout.log'), stderrPath: join(testRoot, 'app.stderr.log') },
    helperProbe: { executable: '/usr/bin/sandbox-exec', args: ['-f', policyPath, info.helper, `--ego-server-name=${serviceName}`, 'nodejs', '--sdk-path', info.sdk], stdinFile: probePath, timeoutMs: 30000 },
    rules: ['Do not run during model timings. No app/helper is launched by this preparer.', 'Preserve HOME and CODEX_HOME unchanged. Only TMPDIR points to disposable native-tmp.', 'Flags are static-binary candidates; verify the actual profile before treating them as supported.', 'No Chrome/other-browser import, default-browser change, login or signup. Use skip/decline only when visibly offered.', 'Do not run the convenience installer or remove quarantine/signature metadata.', 'If sandbox policy blocks initialization, retain the concrete error; do not silently loosen home/global-write restrictions.', 'The helper can autostart Ego. Invoke it only after the separately sandboxed named service is proven running.', 'Compile the pinned SDK after timings with install scripts disabled. Do not use npm link or global skill installation.', 'Only the created task space is closed by native-probe.mjs; no user task spaces or profiles are enumerated.'],
    proofRequired: ['sandbox deny-read and deny-write probe passes', 'main native PID command line includes the exact profile and unique service name', 'actual Local State or Default/Preferences exists within the fresh profile', 'native PID has an open file under the fresh profile', 'monitored global configuration metadata is unchanged before, during and after the run', 'native helper probe reports globalThis.ego and actual browser version while its Page ledger stays under sdk-state'],
  };
  const manifestPath = join(testRoot, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return { manifestPath, ...manifest };
}

async function readManifest(path) {
  const manifest = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (!manifest.testRoot || !manifest.policyPath?.startsWith(manifest.testRoot + '/') || !manifest.profile?.startsWith(manifest.testRoot + '/')) throw new Error('Invalid isolation manifest.');
  return manifest;
}

async function checkPolicy(path) {
  const manifest = await readManifest(path);
  // The outside-write canary is an owned workspace artifact, never a global config.
  const outsideCanary = join(root, 'artifacts', `ego-denied-${randomUUID()}`);
  const allowedCanary = join(manifest.testRoot, 'policy-canary');
  const script = `const fs=require('node:fs');const result={};
fs.writeFileSync(${JSON.stringify(allowedCanary)},'owned test');result.allowedWrite=true;
try{fs.readFileSync(${JSON.stringify(join(root, 'package.json'))});result.homeReadDenied=false;}catch(e){result.homeReadDenied=['EPERM','EACCES'].includes(e.code);}
try{fs.writeFileSync(${JSON.stringify(outsideCanary)},'unexpected policy failure');result.outsideWriteDenied=false;}catch(e){result.outsideWriteDenied=['EPERM','EACCES'].includes(e.code);}
console.log(JSON.stringify(result));if(!result.homeReadDenied||!result.outsideWriteDenied)process.exitCode=1;`;
  try {
    const { stdout } = await execFileAsync('/usr/bin/sandbox-exec', ['-f', manifest.policyPath, process.execPath, '-e', script], { cwd: manifest.testRoot, env: { ...process.env, TMPDIR: manifest.nativeTmp }, timeout: 10000 });
    const result = { ...JSON.parse(stdout), checkedAt: new Date().toISOString(), appLaunched: false };
    await writeFile(join(manifest.testRoot, 'policy-check.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { await rm(outsideCanary, { force: true }); await rm(allowedCanary, { force: true }); }
}

async function verify(path, pid) {
  const manifest = await readManifest(path);
  const before = JSON.parse(await readFile(manifest.baselinePath, 'utf8'));
  const after = await globalMetadata();
  const changedGlobals = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const profileEvidence = [];
  for (const relative of ['Local State', 'Default/Preferences', 'Default/History']) {
    try { const file = await lstat(join(manifest.profile, relative)); if (file.isFile()) profileEvidence.push({ relative, bytes: file.size }); } catch {}
  }
  let processEvidence;
  if (pid !== undefined) {
    if (!/^\d+$/.test(pid)) throw new Error('PID must be numeric.');
    const { stdout: command } = await execFileAsync('/bin/ps', ['-p', pid, '-o', 'command='], { timeout: 5000 });
    let opened = '';
    try { opened = (await execFileAsync('/usr/sbin/lsof', ['-a', '-p', pid, '-Fn'], { timeout: 5000 })).stdout; } catch (error) { opened = error.stdout || ''; }
    processEvidence = { pid: Number(pid), exactProfileArgument: command.includes(`--user-data-dir=${manifest.profile}`), exactServiceArgument: command.includes(`--ego-server-name=${manifest.serviceName}`), openedProfileFiles: opened.split('\n').filter(line => line.startsWith('n' + manifest.profile + '/')).map(line => line.slice(1)) };
  }
  return { checkedAt: new Date().toISOString(), changedGlobals, globalsUnchanged: changedGlobals.length === 0, profileEvidence, processEvidence,
    profileIsolationProven: changedGlobals.length === 0 && profileEvidence.length > 0 && !!processEvidence?.exactProfileArgument && !!processEvidence?.exactServiceArgument && processEvidence.openedProfileFiles.length > 0,
    caveat: 'Metadata stability is supporting evidence, not a substitute for the OS deny-write policy. Recheck after stopping only the PID(s) started from this manifest. No existing profile contents were read.' };
}

async function main() {
  if (process.argv.includes('--prepare')) return prepare();
  if (flag('policy-check')) return checkPolicy(flag('policy-check'));
  if (flag('verify')) return verify(flag('verify'), flag('pid'));
  const info = await inspection();
  return { mode: 'read-only-inspect', version: info.report.version, app: info.app, helper: info.helper, executable: info.executable, sdk: info.sdk,
    writtenFiles: 0, appLaunched: false, helperExecuted: false,
    next: 'After matched timings: --prepare creates a fresh manifest and policy; --policy-check=<manifest> probes OS restrictions without Ego; launch arrays are then reviewed/executed separately; --verify=<manifest> --pid=<nativePID> checks isolation.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
