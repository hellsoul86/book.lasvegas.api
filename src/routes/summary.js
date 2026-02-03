async function summaryRoutes(fastify) {
  fastify.get('/api/summary', async () => {
    return fastify.services.roundService.buildSummary();
  });
}

module.exports = summaryRoutes;
