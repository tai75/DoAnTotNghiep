const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = new Proxy(prisma, {
  get(target, property) {
    if (process.env.NODE_ENV === 'test') {
      const testClient = globalThis.__JOB_CONNECT_TEST_PRISMA__;
      if (!testClient) throw new Error('Test Prisma adapter is not configured');
      return testClient[property];
    }
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
