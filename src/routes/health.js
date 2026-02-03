async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));
}

module.exports = healthRoutes;
