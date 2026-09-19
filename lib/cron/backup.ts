/**
 * Database Backup Core Logic
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

export interface BackupResult {
  success: boolean;
  timestamp: string;
  backupFile?: string;
  backupPath?: string;
  sizeBytes?: number;
  output: string;
  error?: string;
}

export async function runDatabaseBackup(options?: {
  keep?: number;
  targetDb?: string;
}): Promise<BackupResult> {
  const repoRoot = path.resolve(process.cwd());
  const scriptPath = path.join(repoRoot, "scripts", "backup-db.sh");

  const env = {
    ...process.env,
    ...(options?.keep ? { BACKUP_KEEP: String(options.keep) } : {}),
  };

  const args: string[] = [];
  if (options?.targetDb) {
    args.push(options.targetDb);
  }

  try {
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath, ...args], {
      cwd: repoRoot,
      env,
      timeout: 120_000,
    });

    const combinedOutput = `${stdout}\n${stderr}`.trim();

    // Extract path from output (e.g. "已备份: /.../backups/prod_20260912_155056.db (3.3M)")
    const match = combinedOutput.match(/已备份:\s*([^\s]+\.db)/);
    const backupPath = match ? match[1] : undefined;
    const backupFile = backupPath ? path.basename(backupPath) : undefined;

    let sizeBytes: number | undefined;
    if (backupPath) {
      try {
        const stat = await fs.stat(backupPath);
        sizeBytes = stat.size;
      } catch {
        // Ignore stat error if file cannot be read directly
      }
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      backupFile,
      backupPath,
      sizeBytes,
      output: combinedOutput,
    };
  } catch (err: any) {
    return {
      success: false,
      timestamp: new Date().toISOString(),
      output: err.stdout ? String(err.stdout) : "",
      error: err.stderr ? String(err.stderr) : err.message,
    };
  }
}
