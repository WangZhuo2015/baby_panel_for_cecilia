import webPush from 'web-push';
import fs from 'fs';
import path from 'path';

const keys = webPush.generateVAPIDKeys();

// 同时写入 .env.local（next dev 读取）与 .env（docker compose / 生产读取），避免两套密钥漂移
const envPaths = [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
];

const block = `\n\n# VAPID keys for Web Push Notifications\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:cecilia@baby-app.local\n`;

for (const envPath of envPaths) {
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  envContent = envContent
    .split('\n')
    .filter(line => !line.startsWith('VAPID_'))
    .join('\n')
    .trimEnd();

  fs.writeFileSync(envPath, envContent + block);
  try { fs.chmodSync(envPath, 0o600); } catch { /* 平台不支持则忽略 */ }
}

console.log('VAPID keys generated and saved to .env.local & .env');
console.log('Public key:', keys.publicKey);
console.log('⚠️  密钥已轮换：所有旧订阅将失效(401/403)，服务端会在下次推送时自动清理；');
console.log('   各设备需重新开启通知。若使用 Docker 部署，需重启容器以加载新密钥。');
