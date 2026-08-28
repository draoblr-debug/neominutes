import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js';

async function run() {
  const meta = await discoverAuthorizationServerMetadata('https://api.neosapien.xyz');
  const clientInfo = await registerClient('https://api.neosapien.xyz', {
    metadata: meta,
    clientMetadata: {
      client_name: 'AI Studio Web App',
      redirect_uris: ['https://ais-dev-ux6sdunaduaqhvf6457bos-910131093918.asia-southeast1.run.app/api/oauth/callback']
    }
  });
  console.log(clientInfo);
}
run();
