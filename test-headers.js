const http = require('http');
const server = http.createServer((req, res) => {
  console.log(req.headers);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end();
  server.close();
});
server.listen(4000, () => {
  const { EventSource } = require('eventsource');
  new EventSource('http://localhost:4000', { headers: { Authorization: 'Bearer test' } });
});
