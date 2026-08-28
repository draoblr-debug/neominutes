import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';

async function run() {
  const meta = await discoverAuthorizationServerMetadata('https://api.neosapien.xyz');
  console.log(meta);
}
run();
