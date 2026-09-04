#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import {
  getLlmProfiles,
  switchActiveProfile,
  type LlmProfile,
} from "../lib/llm-profiles";

function maskApiKey(key: string): string {
  if (!key) return "<not set>";
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function testConnection(profile: LlmProfile): Promise<boolean> {
  process.stdout.write(`\n🔍 正在测试连接到 [${profile.name || profile.model}] (${profile.baseUrl})... `);
  try {
    const url = `${profile.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(profile.headers || {}),
    };
    if (profile.apiKey) {
      headers.Authorization = `Bearer ${profile.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        ...(profile.completionExtras || {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      console.log(`✅ 连接成功! (HTTP ${res.status})`);
      return true;
    } else {
      const errText = await res.text();
      console.log(`❌ 接口返回错误 (HTTP ${res.status}): ${errText.slice(0, 160)}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ 网络请求失败: ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const restartFlag = args.includes("--restart");
  const testFlag = args.includes("--test");
  const profileArg = args.find((a) => !a.startsWith("--"));

  const { activeProfile, profiles } = getLlmProfiles();

  if (!profileArg) {
    console.log("\n🤖 当前已配置的 LLM Profiles:");
    console.log("================================================================");
    for (const [key, p] of Object.entries(profiles)) {
      const isActive = key === activeProfile;
      const marker = isActive ? "👉 *" : "   ";
      console.log(`${marker} [${key}] ${p.name || key}`);
      console.log(`     Model:       ${p.model}`);
      if (p.visionModel && p.visionModel !== p.model) {
        console.log(`     VisionModel: ${p.visionModel}`);
      }
      console.log(`     BaseUrl:     ${p.baseUrl}`);
      console.log(`     ApiKey:      ${maskApiKey(p.apiKey)}`);
      console.log("");
    }
    console.log("================================================================");
    console.log(`当前激活 Profile: [${activeProfile}]`);
    console.log("\n切换命令示例:");
    console.log("  npm run llm:switch <profile_id>");
    console.log("  npm run llm:switch <profile_id> -- --test      # 切换并测试连通性");
    console.log("  npm run llm:switch <profile_id> -- --restart   # 切换并重启服务");
    console.log("  npm run llm:switch <profile_id> -- --test --restart\n");
    return;
  }

  const result = switchActiveProfile(profileArg, { syncEnv: true });
  if (!result.success) {
    console.error(`\n❌ 切换失败: ${result.error}\n`);
    process.exit(1);
  }

  const selected = result.profile!;
  console.log(`\n🎉 成功切换至 Profile: [${profileArg}] (${selected.name || profileArg})`);
  console.log(`   Model:   ${selected.model}`);
  console.log(`   BaseUrl: ${selected.baseUrl}`);
  console.log(`   ApiKey:  ${maskApiKey(selected.apiKey)}`);
  console.log(`   已同步写入 .env 与 llm-profiles.json`);

  if (testFlag) {
    await testConnection(selected);
  }

  if (restartFlag) {
    console.log("\n🔄 正在重启 baby-panel.service 服务...");
    try {
      execSync("sudo systemctl restart baby-panel.service", { stdio: "inherit" });
      console.log("✅ 服务重启成功!");
    } catch (err) {
      console.error("❌ 服务重启失败:", (err as Error).message);
    }
  } else {
    console.log("\n💡 提示: 若生产服务正在运行，请重启使配置生效:");
    console.log("   sudo systemctl restart baby-panel.service");
    console.log("   或使用: npm run llm:switch <profile_id> -- --restart\n");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
