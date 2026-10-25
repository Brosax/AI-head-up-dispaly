import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec = promisify(execFile);

export async function findTokscale(root) {
  let config = {};
  try { config = JSON.parse(await readFile(path.join(root, 'local-config.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('local-config.json 无效。'); }
  if (config.tokscalePath) {
    if (!path.isAbsolute(config.tokscalePath)) throw new Error('tokscalePath 必须是可执行文件的绝对路径。');
    await access(config.tokscalePath);
    return config.tokscalePath;
  }
  const cached = path.join(os.homedir(), '.bun', 'install', 'cache', '@tokscale', 'cli-win32-x64-msvc@4.20.1@@@1', 'bin', 'tokscale.exe');
  if (process.platform === 'win32') { try { await access(cached); return cached; } catch {} }
  return process.platform === 'win32' ? 'tokscale.exe' : 'tokscale';
}

export async function collect(root) {
  const executable = await findTokscale(root);
  const configDirectory = path.join(root, 'data', 'tokscale');
  await mkdir(configDirectory, { recursive: true });
  // Keep configuration/cache local, avoid unrelated account imports and provider probes.
  await writeFile(path.join(configDirectory, 'settings.json'), JSON.stringify({ usage: {
    disabledProviders: ['zai', 'amp', 'antigravity', 'copilot', 'cursor', 'grok-bot', 'kimi', 'minimax', 'minimax-token-plan', 'warp', 'sakana', 'opencode-go'],
  } }), 'utf8');
  try {
    const { stdout } = await exec(executable, ['usage', '--json'], {
      cwd: root, env: { ...process.env, TOKSCALE_CONFIG_DIR: configDirectory },
      timeout: 45000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  } catch (error) {
    // Do not surface raw stderr: upstream diagnostics may contain account data or paths.
    if (error.code === 'ENOENT') throw new Error('未找到 Tokscale。可配置本机可执行文件路径，或导入 usage --json 文件。');
    if (error.killed) throw new Error('Tokscale 读取超时；已保留上次记录，请检查网络及登录状态。');
    throw new Error('Tokscale 未返回有效额度。请在原工具检查登录和网络，再重试或导入 JSON。');
  }
}
