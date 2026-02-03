const { buildApp } = require('./src/app');
const { PORT } = require('./src/config');

async function start() {
  const app = buildApp();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
