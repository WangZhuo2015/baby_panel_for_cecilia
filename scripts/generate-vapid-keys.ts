import webPush from 'web-push';
import fs from 'fs';
import path from 'path';

const keys = webPush.generateVAPIDKeys();
const envPath = path.join(process.cwd(), '.env.local');

let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf-8');
}

// Remove existing VAPID lines if present
envContent = envContent
  .split('\n')
  .filter(line => !line.startsWith('VAPID_'))
  .join('\n')
  .trim();

envContent += `\n\n# VAPID keys for Web Push Notifications\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:cecilia@baby-app.local\n`;

fs.writeFileSync(envPath, envContent);
console.log('VAPID keys generated and saved to .env.local');
console.log('Public key:', keys.publicKey);
