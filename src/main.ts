import 'dotenv/config';
import express from 'express';
import { config } from './config/index.js';
import { logger } from './infrastructure/logger.js';
import { IDatabaseClient, MongooseClient, connectDatabase } from './infrastructure/db.js';
import { IUserRepository } from './modules/user/repository.js';
import { UserRepositoryMongo } from './infrastructure/mongo/user.repository.mongo.js';
import { IReminderRepository } from './modules/reminder/repository.js';
import { UserService } from './modules/user/service.js';
import { UserController } from './modules/user/controller.js';
import { userRouter } from './modules/user/router.js';
import { errorHandler } from './middleware/errorHandler.js';
import { morganMiddleware } from './middleware/morganMiddleware.js';
import { connectRedis } from './infrastructure/redis.js';
import { ReminderRepositoryMongo } from './infrastructure/mongo/reminder.repository.mongo.js';
import { ReminderQueue } from './modules/reminder/model.js';
import { LogFileChannel } from './modules/notification/channel/logfile.js';
import { NotificationService } from './modules/notification/service.js';
import { startWorker } from './modules/notification/worker.js';
import { startBirthdayScheduler } from './modules/reminder/scheduler.js';
import { createRedlock } from './infrastructure/redlock.js';
import { createApp } from './app.js';

let dbClient: IDatabaseClient;
let uri: string;
let userRepo: IUserRepository;
let reminderRepo: IReminderRepository;

switch (config.dbType) {
  case 'mongodb':
    logger.info('Using MongoDB as the database');
    dbClient = new MongooseClient({
        maxPoolSize: config.dbPoolSize,
        serverSelectionTimeoutMS: config.serverTimeout,
    });
    uri = config.mongoUri;
    userRepo = new UserRepositoryMongo();
    reminderRepo = new ReminderRepositoryMongo();
    break;
  default:
    logger.error(`Unsupported DB_TYPE: ${config.dbType}`);
    process.exit(1);
}

const redis = connectRedis(config.redisUrl);
await connectDatabase(dbClient, uri, logger);

const reminderQueue  = new ReminderQueue(redis);
const logFileChannel = new LogFileChannel(config.channel.logFileDir);
const notificationSvc = new NotificationService([logFileChannel]);

switch (config.role) {
  case 'api':
    logger.info('Starting API server...');
    const userService    = new UserService(userRepo, reminderQueue);
    const userController = new UserController(userService);
    const app            = createApp(userController, redis); 
    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });
    break;

  case 'worker':
    logger.info('Starting worker...');
    startWorker(redis, userRepo, reminderRepo, notificationSvc);
    break;

  case 'scheduler':
    logger.info('Starting scheduler...');
    const redlock = createRedlock(redis);
    startBirthdayScheduler(redlock, userRepo, reminderQueue);
    break;

  default:
    logger.error(`Unsupported ROLE: ${config.role}`);
    process.exit(1);
}
