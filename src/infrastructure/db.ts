import mongoose from 'mongoose';

// Abstraction for generic database client enables future support for other DBs
export interface DatabaseClient {
  connect(uri: string): Promise<void>;
}

// Concrete implementation using Mongoose
export class MongooseClient implements DatabaseClient {
  private options: {
    maxPoolSize: number;
    serverSelectionTimeoutMS: number;
  };

  constructor(options: {
    maxPoolSize: number;
    serverSelectionTimeoutMS: number;
  }) {
    this.options = options;
  }

  async connect(uri: string): Promise<void> {
    await mongoose.connect(uri, this.options);
  }
}

// Logger contract (keeps it decoupled from any logging lib)
export interface Logger {
  info(message: string): void;
  error?(message: string): void;
}

// Orchestrator function
export const connectDatabase = async (
  client: DatabaseClient,
  uri: string,
  logger: Logger
): Promise<void> => {
  await client.connect(uri);
  logger.info('MongoDB connected');
};