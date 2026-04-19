import 'dotenv/config';
import express from 'express';
import { config } from './config/index.js';
import { logger } from './infrastructure/logger.js';
import { IDatabaseClient, MongooseClient, connectDatabase } from './infrastructure/db.js';
import { IUserRepository } from './modules/user/repository.js';
import { UserRepositoryMongo } from './infrastructure/mongo/user.repository.mongo.js';
import { UserService } from './modules/user/service.js';
import { UserController } from './modules/user/controller.js';
import { userRouter } from './modules/user/router.js';
import { errorHandler } from './middleware/errorHandler.js';
import { morganMiddleware } from './middleware/morganMiddleware.js';

let dbClient: IDatabaseClient;
let uri: string;
let userRepo: IUserRepository;

switch (config.dbType) {
  case 'mongodb':
    logger.info('Using MongoDB as the database');
    dbClient = new MongooseClient({
        maxPoolSize: config.dbPoolSize,
        serverSelectionTimeoutMS: config.serverTimeout,
    });
    uri = config.mongoUri;
    userRepo = new UserRepositoryMongo();
    break;
  default:
    logger.error(`Unsupported DB_TYPE: ${config.dbType}`);
    process.exit(1);
}

await connectDatabase(dbClient, uri, logger);

const app = express();

app.use(express.json());
app.use(morganMiddleware);

const userService = new UserService(userRepo);
const userController = new UserController(userService);
app.use('/api/v1/users', userRouter(userController));


app.get('/health', (_, res) => {
  res.json({ status: 'Hello sekai' });
});

app.use(errorHandler);

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});