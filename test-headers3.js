import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import http from 'http';

const server = http.createServer((req, res) => {
  console.log('Incoming headers:', req.headers);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end();
  server.close();
});
server.listen(4002, async () => {
  const headers = { Authorization: 'Bearer test' };
  const transport = new SSEClientTransport(new URL('http://localhost:4002'), {
    eventSourceInit: {
      fetch: (url, init) => {
        init.headers = { ...init.headers, ...headers };
        return fetch(url, init);
      }
    },
    requestInit: { headers }
  });
  await transport.start();
  console.log('started');
});
