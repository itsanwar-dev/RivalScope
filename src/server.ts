import { createApp } from './app.ts';

const portText = process.env.PORT ?? '3000';
if (!/^\d+$/.test(portText) || Number(portText) > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const host = process.env.HOST ?? '127.0.0.1';
const server = createApp();

server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(Number(portText), host, () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    console.log(`RivalScope listening on ${host}:${address.port}`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    });
  });
}
