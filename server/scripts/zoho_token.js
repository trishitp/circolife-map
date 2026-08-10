//   node scripts/zoho_token.js
//   node scripts/zoho_token.js --code=1000.xxxxx
import { getAccessToken, exchangeAuthCode, zohoAuthStatus } from '../src/zoho/analyticsClient.js';

const codeArg = process.argv.find((a) => a.startsWith('--code='));
const code = codeArg ? codeArg.slice('--code='.length) : null;

try {
  if (code) {
    const r = await exchangeAuthCode(code);
    console.log(JSON.stringify({ exchanged: r, status: zohoAuthStatus() }, null, 2));
  } else {
    await getAccessToken({ force: true });
    console.log(JSON.stringify(zohoAuthStatus(), null, 2));
  }
} catch (e) {
  console.error(e.message);
  if (e.zoho) console.error(JSON.stringify(e.zoho, null, 2));
  console.error(JSON.stringify(zohoAuthStatus(), null, 2));
  process.exit(1);
}
