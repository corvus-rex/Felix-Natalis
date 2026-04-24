// tests/integration/setup/containers.ts
import { MongoDBContainer, StartedMongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer, StartedRedisContainer }     from '@testcontainers/redis';
import mongoose from 'mongoose';
import Redis    from 'ioredis';

export interface TestInfra {
  mongoContainer: StartedMongoDBContainer;
  redisContainer: StartedRedisContainer;
  mongoose:       typeof mongoose;
  redisClient:    Redis;
}

export const startInfra = async (): Promise<TestInfra> => {
  const [mongoContainer, redisContainer] = await Promise.all([
    new MongoDBContainer('mongo:7').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  await mongoose.connect(
    mongoContainer.getConnectionString(),
    { directConnection: true }
  );

  const redisClient = new Redis(
    redisContainer.getPort(),
    redisContainer.getHost(),
    { maxRetriesPerRequest: null }
  );

  return {
    mongoContainer,
    redisContainer,
    mongoose,
    redisClient,
  };
};

export const stopInfra = async (infra: TestInfra): Promise<void> => {
  await infra.mongoose.disconnect();
  await infra.redisClient.quit();
  await new Promise(resolve => setTimeout(resolve, 500));
  await Promise.all([
    infra.mongoContainer.stop(),
    infra.redisContainer.stop(),
  ]);
};