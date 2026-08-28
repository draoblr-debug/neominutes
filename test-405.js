import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function test(urlStr) {
  try {
    const transport = new SSEClientTransport(new URL(urlStr), {
      eventSourceInit: { 
        fetch: (url, init) => {
          init.headers = { ...init.headers, Authorization: "Bearer test" };
          return fetch(url, init);
        }
      }
    });
    console.log(`Testing ${urlStr}...`);
    await transport.start();
  } catch (e) {
    console.log(`Error for ${urlStr}:`, e.message);
  }
}

async function run() {
  await test("https://api.neosapien.xyz/mcp");
  await test("https://api.neosapien.xyz/mcp/sse");
}
run();
