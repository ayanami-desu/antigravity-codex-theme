import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isDaemonCommandLine,
  getDaemonPidCandidateDirs,
  parseDaemonPidsFromPsOutput,
  parseDaemonPidsFromWinCimJson,
  findRunningDaemonPids,
  inspectDaemonPidStatus,
  terminateDaemonPids
} from '../core/shared.mjs';
import {
  isRunningInsideManagedService,
  stopRunningDaemonProcesses
} from '../core/installer/service.mjs';
import { acquireDaemonPidLock, createCdpManager } from '../core/daemon/cdp-bridge.mjs';

test('isDaemonCommandLine matches cross-platform daemon commands and rejects non-daemon commands', () => {
  const shouldMatch = [
    '/opt/homebrew/bin/node --disable-warning=ExperimentalWarning /Users/alice/.gemini/antigravity/scripts/antigravity-codex-daemon.mjs',
    '"C:\\Program Files\\nodejs\\node.exe" --disable-warning=ExperimentalWarning "C:\\Users\\张三\\.gemini\\antigravity\\scripts\\antigravity-codex-daemon.mjs"',
    'C:\\Program Files\\nodejs\\node.exe --disable-warning=ExperimentalWarning C:\\Users\\alice\\.gemini\\antigravity\\scripts\\antigravity-codex-daemon.mjs',
    '/usr/bin/env node /home/alice/.gemini/antigravity/scripts/antigravity-font-daemon.mjs',
    'node /Users/alice/.gemini/antigravity/codex-theme/core/daemon.mjs',
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\alice\\antigravity-codex-theme\\core\\daemon.mjs"'
  ];
  for (const cmd of shouldMatch) {
    assert.equal(isDaemonCommandLine(cmd), true, `Expected match: ${cmd}`);
  }

  const shouldReject = [
    'node /Users/alice/.gemini/antigravity/codex-theme/install.mjs install --target-dir /Users/alice/.gemini/antigravity/codex-theme',
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\alice\\.gemini\\antigravity\\codex-theme\\install.mjs" install',
    '/opt/homebrew/bin/node /Users/alice/.gemini/antigravity/codex-theme/core/daemon.mjs --once',
    '/opt/homebrew/bin/node /Users/alice/.gemini/antigravity/codex-theme/core/daemon.mjs --once --safe-mode',
    'node --test tests/daemon-singleton.test.mjs',
    'node -e "console.log(\'antigravity-codex-daemon.mjs\')"',
    'node --check core/daemon.mjs',
    'node /Users/alice/projects/my-app/core/daemon.mjs',
    'node /Users/alice/projects/vite/bin/vite.js',
    'grep antigravity-codex-daemon.mjs',
    '/bin/zsh -c "ps -axww | grep antigravity-codex-daemon.mjs"',
    'powershell -Command "Get-CimInstance Win32_Process"'
  ];
  for (const cmd of shouldReject) {
    assert.equal(isDaemonCommandLine(cmd), false, `Expected reject: ${cmd}`);
  }

  // Generic daemon.mjs is accepted only when allowGenericDaemonScript is enabled (for PIDs from our own .pid file)
  assert.equal(
    isDaemonCommandLine('node core/daemon.mjs', { allowGenericDaemonScript: false }),
    false
  );
  assert.equal(
    isDaemonCommandLine('node core/daemon.mjs', { allowGenericDaemonScript: true }),
    true
  );
});

test('parseDaemonPidsFromPsOutput and parseDaemonPidsFromWinCimJson extract duplicate daemons accurately', () => {
  const psOutput = [
    '  100 /sbin/launchd',
    '19364 /opt/homebrew/bin/node --disable-warning=ExperimentalWarning /Users/a/.gemini/antigravity/scripts/antigravity-codex-daemon.mjs',
    ' 4916 /opt/homebrew/bin/node /Users/a/.gemini/antigravity/codex-theme/core/daemon.mjs',
    ' 5555 /opt/homebrew/bin/node /Users/a/.gemini/antigravity/codex-theme/core/daemon.mjs --once',
    ' 6666 /opt/homebrew/bin/node /Users/a/.gemini/antigravity/codex-theme/install.mjs install',
    ' 7777 grep antigravity-codex-daemon.mjs'
  ].join('\n');

  assert.deepEqual(
    parseDaemonPidsFromPsOutput(psOutput, { excludePids: [4916] }),
    [19364]
  );
  assert.deepEqual(
    parseDaemonPidsFromPsOutput(psOutput, { excludePids: [6666] }),
    [4916, 19364]
  );

  // Single-object CIM JSON (PowerShell without array wrapper)
  const singleWinJson = JSON.stringify({
    ProcessId: 19364,
    CommandLine:
      '"C:\\Program Files\\nodejs\\node.exe" --disable-warning=ExperimentalWarning "C:\\Users\\user\\.gemini\\antigravity\\scripts\\antigravity-codex-daemon.mjs"'
  });
  assert.deepEqual(parseDaemonPidsFromWinCimJson(singleWinJson), [19364]);

  // BOM-prefixed array JSON with 1.2.0 + 1.3.1 daemons plus install.mjs & unrelated node.exe
  const multiWinJson =
    '\uFEFF' +
    JSON.stringify([
      {
        ProcessId: 19364,
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" --disable-warning=ExperimentalWarning "C:\\Users\\user\\.gemini\\antigravity\\scripts\\antigravity-codex-daemon.mjs"'
      },
      {
        ProcessId: 4916,
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" --disable-warning=ExperimentalWarning "C:\\Users\\user\\.gemini\\antigravity\\scripts\\antigravity-codex-daemon.mjs"'
      },
      {
        ProcessId: 8888,
        CommandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\user\\codex-theme\\install.mjs" install'
      },
      {
        ProcessId: 9999,
        CommandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\work\\web\\node_modules\\vite\\bin\\vite.js"'
      }
    ]);
  assert.deepEqual(
    parseDaemonPidsFromWinCimJson(multiWinJson, { excludePids: [4916] }),
    [19364]
  );
  assert.deepEqual(parseDaemonPidsFromWinCimJson('not-json'), []);
});

test('findRunningDaemonPids uses ps on POSIX and falls back from powershell to pwsh on Windows', () => {
  const posixCalls = [];
  const posixPids = findRunningDaemonPids({
    platform: 'darwin',
    excludePids: [4916],
    spawnSyncImpl: (cmd, args) => {
      posixCalls.push([cmd, args]);
      return {
        status: 0,
        stdout:
          '19364 /opt/homebrew/bin/node /Users/a/.gemini/antigravity/scripts/antigravity-codex-daemon.mjs\n4916 /opt/homebrew/bin/node /Users/a/.gemini/antigravity/scripts/antigravity-codex-daemon.mjs\n'
      };
    }
  });
  assert.deepEqual(posixPids, [19364]);
  assert.equal(posixCalls[0][0], 'ps');
  assert.deepEqual(posixCalls[0][1], ['-axww', '-o', 'pid=,command=']);

  const winBins = [];
  const winPids = findRunningDaemonPids({
    platform: 'win32',
    excludePids: [4916],
    spawnSyncImpl: (cmd) => {
      winBins.push(cmd);
      if (cmd === 'powershell') return { error: new Error('ENOENT'), status: null };
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            ProcessId: 19364,
            CommandLine:
              '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\a\\.gemini\\antigravity\\scripts\\antigravity-codex-daemon.mjs"'
          }
        ])
      };
    }
  });
  assert.deepEqual(winBins, ['powershell', 'pwsh']);
  assert.deepEqual(winPids, [19364]);
});

test('inspectDaemonPidStatus distinguishes dead, daemon, other, and unknown across POSIX and Windows', () => {
  assert.equal(
    inspectDaemonPidStatus(19364, [], { platform: 'win32', isAliveImpl: () => false }),
    'dead'
  );

  // Windows CIM returns unrelated node.exe -> 'other'
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'win32',
      isAliveImpl: () => true,
      spawnSyncImpl: () => ({
        status: 0,
        stdout: JSON.stringify({ Name: 'node.exe', CommandLine: 'node.exe C:\\dev\\app\\server.js' })
      })
    }),
    'other'
  );

  // Windows CIM returns UAC-hidden CommandLine: null for node.exe (PID from our .pid file) -> 'daemon'
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'win32',
      isAliveImpl: () => true,
      spawnSyncImpl: () => ({
        status: 0,
        stdout: JSON.stringify({ Name: 'node.exe', CommandLine: null })
      })
    }),
    'daemon'
  );

  // Windows CIM & tasklist both timeout -> 'unknown' (must NOT blindly unlink .pid file)
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'win32',
      isAliveImpl: () => true,
      spawnSyncImpl: () => ({ error: new Error('ETIMEDOUT'), status: null, stdout: '' })
    }),
    'unknown'
  );

  // Windows CIM fails but tasklist fallback confirms node.exe -> 'daemon'
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'win32',
      isAliveImpl: () => true,
      spawnSyncImpl: (cmd) => {
        if (cmd === 'tasklist') {
          return { status: 0, stdout: '"node.exe","19364","Console","1","45,120 K"\r\n' };
        }
        return { error: new Error('blocked'), status: 1, stdout: '' };
      }
    }),
    'daemon'
  );

  // POSIX ps confirms daemon vs other vs timeout
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'darwin',
      isAliveImpl: () => true,
      spawnSyncImpl: () => ({
        status: 0,
        stdout: '/opt/homebrew/bin/node /Users/a/.gemini/antigravity/scripts/antigravity-codex-daemon.mjs\n'
      })
    }),
    'daemon'
  );
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'darwin',
      isAliveImpl: () => true,
      spawnSyncImpl: () => ({ status: 0, stdout: '/Applications/Safari.app/Contents/MacOS/Safari\n' })
    }),
    'other'
  );
  assert.equal(
    inspectDaemonPidStatus(19364, [], {
      platform: 'darwin',
      isAliveImpl: () => true,
      spawnSyncImpl: () => ({ error: new Error('ETIMEDOUT'), status: null, stdout: '' })
    }),
    'unknown'
  );
});

test('terminateDaemonPids escalates to SIGKILL on POSIX and taskkill /PID /F (without /T) on Windows', () => {
  // POSIX graceful exit on SIGTERM
  const alivePosixGraceful = new Set([19364]);
  const signalsGraceful = [];
  const resGraceful = terminateDaemonPids([19364], {
    platform: 'darwin',
    waitMs: 100,
    forceWaitMs: 50,
    pollIntervalMs: 10,
    killImpl: (pid, sig) => {
      signalsGraceful.push([pid, sig]);
      if (sig === 'SIGTERM') alivePosixGraceful.delete(pid);
    },
    isAliveImpl: (pid) => alivePosixGraceful.has(pid),
    sleepImpl: () => {}
  });
  assert.deepEqual(signalsGraceful, [[19364, 'SIGTERM']]);
  assert.deepEqual(resGraceful, { attempted: [19364], stopped: [19364], stillAlive: [] });

  // POSIX stuck process escalates to SIGKILL
  const alivePosixStuck = new Set([19364]);
  const signalsStuck = [];
  const resStuck = terminateDaemonPids([19364], {
    platform: 'linux',
    waitMs: 40,
    forceWaitMs: 40,
    pollIntervalMs: 10,
    killImpl: (pid, sig) => {
      signalsStuck.push([pid, sig]);
      if (sig === 'SIGKILL') alivePosixStuck.delete(pid);
    },
    isAliveImpl: (pid) => alivePosixStuck.has(pid),
    sleepImpl: () => {}
  });
  assert.deepEqual(signalsStuck, [
    [19364, 'SIGTERM'],
    [19364, 'SIGKILL']
  ]);
  assert.deepEqual(resStuck, { attempted: [19364], stopped: [19364], stillAlive: [] });

  // Windows stuck process escalates to taskkill /PID <pid> /F (MUST NOT pass /T)
  const aliveWinStuck = new Set([19364]);
  const taskkillCalls = [];
  const resWin = terminateDaemonPids([19364], {
    platform: 'win32',
    waitMs: 40,
    forceWaitMs: 40,
    pollIntervalMs: 10,
    killImpl: () => {},
    isAliveImpl: (pid) => aliveWinStuck.has(pid),
    sleepImpl: () => {},
    spawnSyncImpl: (cmd, args) => {
      taskkillCalls.push([cmd, args]);
      if (cmd === 'taskkill') aliveWinStuck.delete(19364);
      return { status: 0 };
    }
  });
  assert.equal(taskkillCalls.length, 1);
  assert.equal(taskkillCalls[0][0], 'taskkill');
  assert.deepEqual(taskkillCalls[0][1], ['/PID', '19364', '/F']);
  assert.equal(taskkillCalls[0][1].includes('/T'), false, 'taskkill must never use /T on daemon PID');
  assert.deepEqual(resWin, { attempted: [19364], stopped: [19364], stillAlive: [] });
});

test('stopRunningDaemonProcesses sweeps orphaned OS daemons without .pid files and preserves unknown/alive .pid files', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-daemon-sweep-'));
  try {
    const pidDead = path.join(tmpRoot, 'ag-codex-daemon-dead.pid');
    const pidUnknown = path.join(tmpRoot, 'ag-codex-daemon-unknown.pid');
    const pidStuck = path.join(tmpRoot, 'ag-theme-daemon-stuck.pid');
    fs.writeFileSync(pidDead, '11111', 'utf8');
    fs.writeFileSync(pidUnknown, '22222', 'utf8');
    fs.writeFileSync(pidStuck, '33333', 'utf8');

    const alive = new Set([19364, 22222, 33333]);
    const terminatedTargets = [];
    const stopped = stopRunningDaemonProcesses({
      platform: 'win32',
      pidDirs: [tmpRoot],
      excludePids: [99999],
      // Orphan 1.2.0 PID 19364 has NO .pid file at all, yet is found via OS process table!
      findRunningDaemonPidsImpl: () => [19364],
      inspectDaemonPidStatusImpl: (pid) => {
        if (pid === 11111) return 'dead';
        if (pid === 22222) return 'unknown';
        if (pid === 33333) return 'daemon';
        return 'other';
      },
      terminateDaemonPidsImpl: (pids) => {
        terminatedTargets.push(...pids);
        alive.delete(19364);
        // Simulate 33333 failing to die (e.g. elevated process)
        return { attempted: pids, stopped: [19364], stillAlive: [33333] };
      },
      isPidAliveImpl: (pid) => alive.has(pid)
    });

    assert.deepEqual(stopped, [19364]);
    assert.deepEqual(terminatedTargets.sort((a, b) => a - b), [19364, 33333]);
    assert.equal(fs.existsSync(pidDead), false, 'dead .pid file should be unlinked');
    assert.equal(fs.existsSync(pidUnknown), true, 'unknown-status live .pid file must NOT be blindly unlinked');
    assert.equal(fs.existsSync(pidStuck), true, 'still-alive daemon .pid file must NOT be unlinked');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('acquireDaemonPidLock sweeps orphan daemons on startup and fences superseded daemons during sync()', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-pidlock-'));
  try {
    const alive = new Set([19364, 4916, 5120]);
    const terminated = [];

    // 1. New daemon (4916) starts and sweeps orphan 1.2.0 daemon (19364) discovered in OS process table
    const lock = acquireDaemonPidLock(null, false, null, {
      platform: 'win32',
      pidDir: tmpRoot,
      pidDirs: [tmpRoot],
      selfPid: 4916,
      registerSignals: false,
      findRunningDaemonPidsImpl: () => [19364],
      isConfirmedDaemonPidImpl: () => false,
      terminateDaemonPidsImpl: (pids) => {
        terminated.push(...pids);
        for (const p of pids) alive.delete(p);
        return { attempted: pids, stopped: pids, stillAlive: [] };
      },
      isPidAliveImpl: (pid) => alive.has(pid)
    });

    assert.deepEqual(terminated, [19364]);
    assert.equal(fs.readFileSync(lock.pidFile, 'utf8').trim(), '4916');
    assert.equal(lock.isOwner(), true);

    // 2. Wire lock into createCdpManager and verify sync() exits cleanly when a newer daemon (5120) takes over
    let supersededBy = null;
    let supersededCount = 0;
    let bundleRebuildCalls = 0;
    const manager = createCdpManager({
      bundleCtrl: {
        rebuildBundleIfNeeded: () => {
          bundleRebuildCalls += 1;
          return false;
        },
        getState: () => ({
          activeConfig: { enabled: true, modules: {}, endpoints: [], allowedOrigins: [] },
          cachedPatchVersion: '1.4.0-test',
          cachedInjectScript: ''
        })
      },
      metricsReader: { parseConversationMetrics: () => null },
      hasSqlite: () => false,
      runOnce: false,
      pidLock: lock,
      onSuperseded: (pid) => {
        supersededCount += 1;
        supersededBy = pid;
      }
    });

    // Simulate newer daemon (5120) overwriting pidFile while alive
    fs.writeFileSync(lock.pidFile, '5120', 'utf8');
    assert.equal(lock.isOwner(), false);
    assert.equal(lock.getOwnerPid(), 5120);

    await manager.sync();
    await manager.sync(); // Idempotent: second tick must not re-fire onSuperseded or touch CDP

    assert.equal(supersededCount, 1);
    assert.equal(supersededBy, 5120);
    assert.equal(bundleRebuildCalls, 0, 'superseded daemon must not rebuild bundle or touch CDP');

    // 3. If newer holder dies, lock reclaims ownership safely
    alive.delete(5120);
    assert.equal(lock.isOwner(), true);
    assert.equal(fs.readFileSync(lock.pidFile, 'utf8').trim(), '4916');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('getDaemonPidCandidateDirs deduplicates candidate temp directories across platforms', () => {
  const winDirs = getDaemonPidCandidateDirs({
    platform: 'win32',
    tmpDir: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\',
    homeDir: 'C:\\Users\\Alice',
    env: {
      TEMP: 'c:\\users\\alice\\appdata\\local\\temp',
      TMP: 'C:\\Program Files\\Git\\tmp',
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local'
    }
  });
  assert.deepEqual(winDirs, ['C:\\Users\\Alice\\AppData\\Local\\Temp', 'C:\\Program Files\\Git\\tmp']);

  const macDirs = getDaemonPidCandidateDirs({
    platform: 'darwin',
    tmpDir: '/var/folders/xx/T/',
    homeDir: '/Users/alice',
    env: { TMPDIR: '/var/folders/xx/T' }
  });
  assert.deepEqual(macDirs, ['/var/folders/xx/T', '/tmp']);
});

test('service.mjs stops active services before process sweeping on install, restart, and uninstall', () => {
  const src = fs.readFileSync(new URL('../core/installer/service.mjs', import.meta.url), 'utf8');

  const regBody = src.slice(src.indexOf('export function registerSystemService'), src.indexOf('export function restartSystemService'));
  assert.ok(
    regBody.indexOf('stopActiveSystemService()') !== -1 &&
      regBody.indexOf('stopActiveSystemService()') < regBody.indexOf('stopRunningDaemonProcesses()'),
    'registerSystemService must stop active system service before sweeping daemon processes'
  );
  assert.match(
    regBody,
    /systemctl --user enable --now \$\{SERVICE_IDS\.linuxUnit\} && systemctl --user restart \$\{SERVICE_IDS\.linuxUnit\}/,
    'Linux registerSystemService must explicitly restart unit so updated daemon takes effect'
  );

  const restartBody = src.slice(src.indexOf('export function restartSystemService'), src.indexOf('export function uninstallSystemService'));
  assert.ok(
    restartBody.indexOf('stopActiveSystemService()') !== -1 &&
      restartBody.indexOf('stopActiveSystemService()') < restartBody.indexOf('stopRunningDaemonProcesses()'),
    'restartSystemService must stop active system service before sweeping daemon processes'
  );

  const uninstallBody = src.slice(src.indexOf('export function uninstallSystemService'));
  assert.ok(
    uninstallBody.lastIndexOf('stopRunningDaemonProcesses()') > uninstallBody.indexOf('bootoutMacLabel') &&
      uninstallBody.lastIndexOf('stopRunningDaemonProcesses()') > uninstallBody.indexOf('systemctl --user disable --now') &&
      uninstallBody.lastIndexOf('stopRunningDaemonProcesses()') > uninstallBody.indexOf("'/Delete'"),
    'uninstallSystemService must disable/delete OS services before final process sweep'
  );

  // Self-update safety invariants (Issues #14 & #15):
  // LaunchAgent / systemd units must not tear down child installer processes during self-updates,
  // and registerSystemService must restart in place instead of calling bootout/stop when invoked from the daemon.
  assert.match(regBody, /<key>AbandonProcessGroup<\/key>\s*<true\/>/, 'macOS LaunchAgent plist must set AbandonProcessGroup=true');
  assert.match(regBody, /<key>ThrottleInterval<\/key>\s*<integer>2<\/integer>/, 'macOS LaunchAgent plist must set short ThrottleInterval');
  assert.match(regBody, /KillMode=process/, 'Linux systemd unit must set KillMode=process');
  assert.match(
    regBody,
    /if \(!fromManagedService\)\s*\{\s*stopActiveSystemService\(\);/,
    'registerSystemService must skip stopActiveSystemService() when invoked from the managed daemon'
  );
  assert.match(regBody, /kickRes = spawnSync\('launchctl', \['kickstart', '-k'/, 'macOS self-update must check kickstart -k exit status');
  assert.match(regBody, /restartRes = spawnSync\('systemctl', \['--user', 'restart', '--no-block'/, 'Linux self-update must check systemctl restart exit status and fallback on failure');
  assert.match(regBody, /if \(scheduledTaskStarted\)[\s\S]*findRunningDaemonPids/, 'Windows schtasks /Run must confirm a daemon PID appeared before skipping detached spawn fallback');
});

test('inspectDaemonPidStatus with requireCommandLineMatch refuses to guess generic Windows node.exe as daemon', () => {
  const statusNoCmd = inspectDaemonPidStatus(8888, ['antigravity-codex-daemon.mjs'], {
    platform: 'win32',
    excludePids: [9999],
    isAliveImpl: () => true,
    requireCommandLineMatch: true,
    spawnSyncImpl: (bin) => {
      if (bin === 'powershell') {
        return { status: 0, stdout: JSON.stringify({ Name: 'node.exe', CommandLine: '' }) };
      }
      return { status: 0, stdout: '"node.exe","8888","Console","1","20,000 K"\r\n' };
    }
  });
  assert.equal(statusNoCmd, 'unknown', 'Must not falsely treat an opaque Windows node.exe parent as daemon');

  const statusPsFail = inspectDaemonPidStatus(8888, ['antigravity-codex-daemon.mjs'], {
    platform: 'win32',
    excludePids: [9999],
    isAliveImpl: () => true,
    requireCommandLineMatch: true,
    spawnSyncImpl: (bin) => {
      if (bin === 'powershell' || bin === 'pwsh') {
        return { status: 1, stdout: '' };
      }
      return { status: 0, stdout: '"node.exe","8888","Console","1","20,000 K"\r\n' };
    }
  });
  assert.equal(statusPsFail, 'unknown', 'Must not fall back to tasklist node.exe heuristic when requireCommandLineMatch is true');
});

test('isRunningInsideManagedService detects updater flag, env, LaunchAgent, systemd cgroup, and daemon ppid', () => {
  const noDaemon = () => 'other';

  assert.equal(
    isRunningInsideManagedService({
      platform: 'darwin',
      env: {},
      argv: ['node', 'install.mjs', 'install'],
      ppid: 1234,
      inspectDaemonPidStatusImpl: noDaemon
    }),
    false,
    'Normal interactive terminal invocation must not be treated as inside managed service'
  );

  assert.equal(
    isRunningInsideManagedService({
      platform: 'darwin',
      env: {},
      argv: ['node', 'install.mjs', 'install', '--from-updater'],
      ppid: 1234,
      inspectDaemonPidStatusImpl: noDaemon
    }),
    true
  );

  assert.equal(
    isRunningInsideManagedService({
      platform: 'win32',
      env: { AG_FROM_DAEMON_UPDATER: '1' },
      argv: ['node', 'install.mjs', 'install'],
      ppid: 1234,
      inspectDaemonPidStatusImpl: noDaemon
    }),
    true
  );

  assert.equal(
    isRunningInsideManagedService({
      platform: 'darwin',
      env: { XPC_SERVICE_NAME: 'com.antigravity.codex-theme' },
      argv: ['node', 'install.mjs', 'install'],
      ppid: 1234,
      inspectDaemonPidStatusImpl: noDaemon
    }),
    true,
    'macOS LaunchAgent child spawned by older updater without --from-updater must still be detected via XPC_SERVICE_NAME'
  );

  assert.equal(
    isRunningInsideManagedService({
      platform: 'linux',
      env: {},
      argv: ['node', 'install.mjs', 'install'],
      ppid: 1234,
      readFileSyncImpl: () => '0::/user.slice/user-1000.slice/user@1000.service/app.slice/antigravity-codex-theme.service\n',
      inspectDaemonPidStatusImpl: noDaemon
    }),
    true,
    'Linux systemd cgroup child spawned by older updater must be detected via /proc/self/cgroup'
  );

  let capturedOpts = null;
  assert.equal(
    isRunningInsideManagedService({
      platform: 'win32',
      env: {},
      argv: ['node', 'install.mjs', 'install'],
      ppid: 4321,
      inspectDaemonPidStatusImpl: (pid, _extra, opts) => {
        capturedOpts = opts;
        return pid === 4321 ? 'daemon' : 'other';
      }
    }),
    true,
    'Windows child spawned by older updater without --from-updater must be detected via daemon ppid'
  );
  assert.equal(capturedOpts?.requireCommandLineMatch, true, 'ppid detection must enforce strict command-line matching');
});
