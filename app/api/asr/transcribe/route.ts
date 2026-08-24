import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { writeFile, unlink, readFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";

export const maxDuration = 120;

/**
 * 服务端语音转文字（中文 ASR）。
 *
 * 通过 ASR_COMMAND 环境变量接入任意自托管模型（推荐 SenseVoice / faster-whisper），
 * 命令模板中 {input} 会被替换为临时音频文件绝对路径，命令须将识别文本打印到 stdout。
 *
 * 示例（SenseVoice sherpa-onnx CLI）：
 *   ASR_COMMAND="python3 /srv/asr/sensevoice.py {input}"
 * 示例（faster-whisper）：
 *   ASR_COMMAND="python3 /srv/asr/faster_whisper.py --lang zh {input}"
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const rateLimit = checkRateLimit(`asr:${auth.user.id || getClientIp(request)}`, 20, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    const cmdTemplate = process.env.ASR_COMMAND;
    if (!cmdTemplate || !cmdTemplate.includes("{input}")) {
      return NextResponse.json(
        {
          error: "语音识别服务未配置",
          hint: "服务器需设置 ASR_COMMAND 环境变量（含 {input} 占位符），详见 docs/ASR_SETUP.md",
        },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: "未收到音频数据" }, { status: 400 });
    }
    if (audio.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "音频过大（上限 25MB / 约2分钟）" }, { status: 400 });
    }

    // 落临时文件
    const extByMime: Record<string, string> = {
      "audio/webm": ".webm",
      "audio/ogg": ".ogg",
      "audio/mp4": ".m4a",
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
    };
    const ext = extByMime[audio.type] || ".webm";
    const tmpPath = path.join(os.tmpdir(), `asr_${crypto.randomBytes(8).toString("hex")}${ext}`);
    await writeFile(tmpPath, Buffer.from(await audio.arrayBuffer()));

    try {
      const argv = cmdTemplate.split(" ").map((seg) => seg.replace(/\{input\}/g, tmpPath));
      const bin = argv.shift() as string;

      const text = await new Promise<string>((resolve, reject) => {
        execFile(
          bin,
          argv,
          { timeout: 110_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env } },
          (err, stdout) => {
            if (err) reject(new Error(`ASR 进程失败: ${err.message.slice(0, 200)}`));
            else resolve(String(stdout).trim());
          }
        );
      });

      if (!text) {
        return NextResponse.json({ error: "未能识别到语音内容，请靠近麦克风重试" }, { status: 422 });
      }
      return NextResponse.json({ text: text.slice(0, 4000) });
    } finally {
      unlink(tmpPath).catch(() => {});
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    console.error("POST /api/asr/transcribe error:", error);
    void readFile; // keep import tree-shake safe
    return NextResponse.json(
      { error: `语音识别失败：${msg ? msg.slice(0, 160) : "请稍后重试"}` },
      { status: 502 }
    );
  }
}
