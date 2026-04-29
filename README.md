# felix-natalis
## Birthday Reminder Service

**Technical Documentation** · v1.2.0

*Node.js · TypeScript · MongoDB · Redis · BullMQ*

---

## 1. Overview

`felix-natalis` is a birthday reminder microservice written in Node.js and TypeScript. It registers users with their birthday and timezone, schedules notification jobs using a Redis-backed queue, and delivers birthday messages via configurable notification channels (currently log-file based).

The system is designed around three independently deployable roles:

- **api** - HTTP server that handles user registration and management (CRUD)
- **scheduler** - hourly cron job that enqueues birthday reminders within an 8-hour sliding window
- **worker** - BullMQ consumer that processes jobs, sends notifications, and advances the next birthday date

### Key Design Decisions

- **Scheduler-only enqueueing:** jobs are never enqueued at registration time; only the hourly scheduler tick populates the queue
- **Distributed locking:** Redlock prevents duplicate scheduler execution across multiple instances
- **Idempotency:** a ReminderLog collection prevents duplicate notifications even if a job is retried
- **Deterministic job IDs:** BullMQ job IDs are derived from userId + scheduledAt, enabling natural deduplication across scheduler ticks
- **Sliding 8-hour window:** the scheduler looks ahead 8 hours each tick, ensuring no birthday is missed between hourly runs

### Why Sliding 8-hour Window Scheduler?
- **Persistence and Self-Healing**: BullMQ stores delayed jobs in a Redis sorted set, sorted by their execution timestamp. A job delayed 365 days sits in Redis for an entire year. At scale (millions of users × 1 job each) this becomes significant, and Redis memory is expensive. Redis sorted sets have no persistence guarantee equivalent to MongoDB. If Redis instance loses data, you lose your entire pending job list. With this approach, bugs, crashes, and missed jobs are automatically healed within at most 8 hours.
- **Clock Drift**: When you enqueue a job at registration, you compute the delay once based on current timezone rules, but timezone rules change. A delay computed today for a birthday 11 months away may be off by an hour after a DST transition. The scheduler-based approach recomputes `nextBirthDayAt` fresh on each tick using current timezone data, so it's always accurate.
- **Timezone Consistency**: Suppose we use a `MM-DD` date bucket to speed up job lookup, and users span all timezones, `nextBirthDayAt` values are scattered across a full 24-hour UTC range on any given day. A Tokyo user fires at 03-14T00:00Z, a London user fires at 03-15T09:00Z, a New York user fires at 03-15T14:00Z. There's no single moment the scheduler can wake up and say "today's birthdays". You need a time window regardless. Compared to date bucket, sliding-window approach can actually be an efficient query if the index on `nextBirthDayAt` is used properly.
- **Easy Race Condition Handling**: Only the scheduler with access to Redlock can add jobs to the queue. Since enqueueing is centralized in a single process guarded by a distributed lock, there's no risk of two processes racing to enqueue the same user simultaneously. Contrast this with direct enqueueing at registration time, where a user updating their birthday and the scheduler ticking at the same moment could both attempt to enqueue, requiring careful atomic remove-then-add logic with its own failure modes.
- **Simple Mutation Handling**: With direct enqueueing, every mutation (birthday change, timezone change, deactivation, deletion) requires finding the existing delayed job, removing it atomically, and re-enqueueing with new parameters. If the remove succeeds but the re-enqueue fails, the user has no job and no safety net. With the sliding window, mutations only need to update the user document. The scheduler re-derives the correct queue state from MongoDB on the next tick automatically.
- **Deployment Flexibility**: Changing `BIRTHDAY_HOUR` or any scheduling parameter takes effect on the next tick with no migration needed. With direct enqueueing, a queue full of jobs computed at the old parameters would require a bulk re-enqueue script to correct.
- **Configurable Scheduling Frequency**: Number of job scheduling per day directly relates to tradeoff between compute load and data corectness/persistence. Scheduling frequency can be reduced to decrease compute load at the cost of data update immediacy (i.e when a user updates their birthday or timezone) and capability for system to recover from data loss. In realistic use case, a person would rarely update their birthday or timezone, so the immediacy cost is largely theoretical. A daily scheduler is practically indistinguishable from an hourly one from the user's perspective. As such, hourly scheduling might not be necessary and can be configured as needed to some other value in `SCHEDULING_FREQUENCY` config variable (e.g once every 6 hours).
---

## 2. Architecture

### Role-Based Startup

The `ROLE` environment variable controls which subsystems start:

| ROLE      | Starts                        | Description                      |
|-----------|-------------------------------|----------------------------------|
| api       | Express + MongoDB             | Serves HTTP endpoints only       |
| scheduler | Cron + MongoDB + Redis        | Runs hourly scheduler tick       |
| worker    | BullMQ Worker + MongoDB + Redis | Consumes and processes jobs    |

---

## 3. Project Structure

```
src/
├── app.ts                              Express app factory
├── main.ts                             Entry point (role-based boot)
├── config/index.ts                     Env-var config with validation
├── infrastructure/
│   ├── db.ts                           Mongoose connection
│   ├── redis.ts                        ioredis client
│   ├── redlock.ts                      Distributed lock setup
│   ├── logger.ts                       Winston logger
│   └── mongo/
│       ├── user.repository.mongo.ts    MongoDB implementation of UserRepository
│       └── reminder.repository.ts      MongoDB implementation of ReminderRepository
└── modules/
    ├── user/                           Registration, update, deactivate, delete
    ├── reminder/                       Queue model, scheduler, birthday utils
    └── notification/                   Worker, service, channels, message builder
```

---

## 4. HTTP API Reference

Base path: `/api/v1/users`

### POST /register

Registers a new user. Does not enqueue any job.

| Field    | Type   | Required | Description                          |
|----------|--------|----------|--------------------------------------|
| name     | string | Yes      | Full name of the user                |
| email    | string | Yes      | Unique email address                 |
| birthday | ISO Date, JS Date objects, or timestamps  | Yes      | Date in Joi format           |
| timezone | string | Yes      | IANA timezone (e.g. Asia/Tokyo)      |

**Responses:**
- `201 Created` - user object with id
- `400 Bad Request` - validation error (missing fields, invalid email, bad timezone, bad date)
- `409 Conflict` - email already registered

### GET /:id

Returns a single user by MongoDB ObjectId.

- `200 OK` - user object
- `404 Not Found`

### PUT /:id

Updates user fields. If birthday or timezone changes, `nextBirthDayAt` is recomputed and the existing queued job is removed.

| Field    | Type              | Required |
|----------|-------------------|----------|
| name     | string            | No       |
| email    | string            | No       |
| birthday | ISO Date, JS Date objects, or timestamps | No     |
| timezone | string (IANA)     | No       |

- `200 OK` - updated user object
- `404 Not Found`
- `409 Conflict` - email taken

### PATCH /deactivate/:id

Marks user as inactive and removes any queued birthday job.

- `204 No Content`
- `404 Not Found`

### DELETE /:id

Permanently deletes a user. Any in-flight job for this user will be silently skipped by the worker (user not found check).

- `204 No Content`

---

## 5. Core Modules

### UserService

Handles all user lifecycle operations. Coordinates between the repository and the reminder queue.

| Method          | Description                                                              |
|-----------------|--------------------------------------------------------------------------|
| register(dto)   | Validates uniqueness, computes nextBirthDayAt, persists user             |
| update(id, dto) | Recomputes nextBirthDayAt and removes stale job if birthday/timezone changes |
| deactivate(id)  | Sets active=false and removes queued job                                 |
| delete(id)      | Hard deletes user from DB                                                |
| getById(id)     | Fetches user by ID                                                       |

### ReminderQueue

Wraps BullMQ Queue with deterministic job ID generation.

**Job ID format:**
```
birthday_{userId}_{ISO-timestamp-with-colons-replaced-by-underscores}
```

This ensures that if the scheduler runs twice within the same hour for the same user, BullMQ naturally deduplicates the job.

| Method                                  | Description                                                                      |
|-----------------------------------------|----------------------------------------------------------------------------------|
| add(data, delay)                        | Enqueues job with deterministic ID; removeOnComplete age=3600s for dedup window  |
| removeBirthdayReminder(userId, scheduledAt) | Reconstructs job ID and removes it from the queue                           |
| removeById(jobId)                       | Low-level removal by explicit job ID                                             |

### Birthday Scheduler

Runs as a node-cron job on the `0 * * * *` schedule (top of every hour). Protected by a Redlock distributed lock (TTL 60 seconds) to prevent duplicate execution.

**Each tick:**
- Computes window: `[now, now + 8 hours]`
- Queries `findUsersWithBirthdayBetween`, active users only
- For each user: computes delay in ms, calls `queue.add()`
- Jobs with delay ≤ 0 are skipped (birthday already passed)

The 8-hour lookahead ensures every birthday is captured despite the 1-hour tick interval, with a comfortable buffer.

### ReminderJobProcessor

Processes each BullMQ job in five steps:

| Step | Action                              | On failure / skip                              |
|------|-------------------------------------|------------------------------------------------|
| 1    | findById(userId)                    | User deleted, return early, no notification   |
| 2    | claimReminder(userId, scheduledAt)  | Already claimed (duplicate key), return early |
| 3    | Type guard (birthday only)          | Unknown type, warn and return                 |
| 4    | notificationService.notifyBirthday() | Throws, job fails, BullMQ may retry          |
| 5    | update nextBirthDayAt (+1 year)     | Advances date for next year's reminder         |

### NotificationService

Fan-out: calls `channel.send()` on all registered channels concurrently via `Promise.all()`. Currently ships with one channel: `LogFileChannel`.

### LogFileChannel

Appends a formatted entry to `notifications.log` in the configured log directory. Each entry is delimited by `-----` and `--------------` markers. Multiple locale are supported for future-proofing, for now only 'en' locale is supported.

```
-----
To: Felix Natalis <felix@natalis.com>
Subject: 🎉 Happy Birthday!
Body:
Hi Felix Natalis,

      Today is your birthday! ...
--------------
```

---

## 6. Data Models

### User (MongoDB)

| Field              | Type              | Description                                                    |
|--------------------|-------------------|----------------------------------------------------------------|
| _id                | ObjectId          | Auto-generated MongoDB ID                                      |
| name               | String            | Display name                                                   |
| email              | String (unique)   | Primary identifier for deduplication                           |
| birthday           | Date              | Original birthday stored as Date                               |
| nextBirthDayAt     | Date (indexed)    | Next occurrence at birthdayHour in user's timezone             |
| timezone           | String            | IANA timezone identifier                                       |
| active             | Boolean           | False = deactivated, excluded from scheduling                  |
| createdAt / updatedAt | Date           | Auto-managed by Mongoose timestamps                            |

### ReminderLog (MongoDB)

Idempotency store. One document per `(userId, scheduledAt)` pair. Unique compound index prevents duplicate insertions.

| Field       | Type   | Description                           |
|-------------|--------|---------------------------------------|
| userId      | String | References User._id as string         |
| scheduledAt | Date   | Normalized ISO timestamp of the job   |

### ReminderJobData (BullMQ payload)

| Field       | Type          | Description                                                  |
|-------------|---------------|--------------------------------------------------------------|
| userId      | string        | MongoDB User ID                                              |
| type        | "birthday"    | Job type discriminator (extensible)                          |
| scheduledAt | string (ISO)  | Normalized UTC ISO string; used for idempotency key          |

---

## 7. Configuration

All configuration is read from environment variables. Required variables throw at startup if missing.

| Variable                   | Required | Default    | Description                                                    |
|----------------------------|----------|------------|----------------------------------------------------------------|
| DB_TYPE                    | Yes      | -          | Database type identifier                                       |
| DB_NAME                    | Yes      | -          | MongoDB database name                                          |
| MONGO_URL                  | Yes      | -          | MongoDB connection URI                                         |
| REDIS_URL                  | Yes      | -          | Redis connection URI                                           |
| ROLE                       | No       | api        | Runtime role: api \| scheduler \| worker                       |
| PORT                       | No       | 3000       | HTTP server port                                               |
| DB_POOL_SIZE               | No       | 15         | Mongoose connection pool size                                  |
| SERVER_SEL_TIMEOUT         | No       | 5000       | MongoDB server selection timeout (ms)                          |
| QUEUE_NAME                 | No       | reminder   | BullMQ queue name                                              |
| BIRTHDAY_HOUR              | No       | 9          | Hour (0-23) at which birthday notifications fire               |
| LOG_FILE_DIR               | No       | ../../logs | Directory for LogFileChannel output                            |
| SCHEDULING_FREQUENCY_HOURS | No       | 1          | Scheduler tick interval in hours. Accepted values: 1, 2, 3, 6. |
| QUERY_BATCH_SIZE           | No       | 420        | Maximum number of users fetched per query. Implements cursor.  |
| WORKER_CONCURRENCY         | No       | 5          | Number of jobs processed simultaneously per worker instance. DB_POOL_SIZE should be set to at least WORKER_CONCURRENCY × 3 to avoid connection pool exhaustion. |
---

## 8. Testing

The test suite is split into three layers, each run in isolation with `--runInBand` to prevent port/container conflicts.

### Unit Tests (`tests/unit/`)

Pure logic tests with no I/O. All dependencies are mocked.

- `notification/service.test.ts` - fan-out and locale resolution
- `notification/worker.test.ts` - processor steps: skip-if-deleted, idempotency, notify, advance date, leap year handling
- `reminder/scheduler.test.ts` - window calculation, inactive user exclusion, delay guard
- `user/controller.test.ts` - HTTP request/response mapping
- `user/service.test.ts` - register, update, deactivate business rules

```
npm run test:unit
```

### Integration Tests (`tests/integration/`)

Real MongoDB and Redis via Testcontainers. No HTTP layer.

- `user/repository.mongo.test.ts` - CRUD, findByEmail, findUsersWithBirthdayBetween
- `reminder/repository.mongo.test.ts` - claimReminder idempotency (duplicate key)
- `reminder/queue.test.ts` - add, removeById, removeBirthdayReminder, job ID determinism
- `user/router.test.ts` - Express route wiring and validation middleware

```
npm run test:integration
```

### E2E Tests (`tests/e2e/`)

Full stack: real containers, real HTTP via Supertest, real worker consuming real jobs.

| Suite                | What it verifies                                                              |
|----------------------|-------------------------------------------------------------------------------|
| Validation           | Missing fields, invalid email/timezone/birthday → 400                         |
| Registration -> DB    | User persisted with correct nextBirthDayAt                                    |
| Registration 409     | Duplicate email rejected, only one user in DB                                 |
| Scheduler tick       | Only active users in 8h window are enqueued; past and out-of-window users skipped |
| Scheduler idempotency | Two consecutive ticks do not double-enqueue the same user                    |
| Deactivation         | User marked inactive, queued job removed                                      |
| Timezone update      | Old job removed, nextBirthDayAt recomputed at birthdayHour in new zone        |
| Worker → log         | Job processed, log written, nextBirthDayAt advanced +1 year                  |
| Worker idempotency   | Retry with same scheduledAt does not write second log entry                   |
| Deleted user         | Job for deleted user skipped, no log entry                                    |
| Multiple users       | Each user gets exactly one log entry                                          |

```
npm run test:e2e
```
---

## 9. Dependencies

### Runtime

| Package    | Version         | Purpose                                      |
|------------|-----------------|----------------------------------------------|
| express    | ^5.2.1          | HTTP server                                  |
| mongoose   | ^9.4.1          | MongoDB ODM                                  |
| bullmq     | ^5.75.2         | Redis-backed job queue                       |
| ioredis    | ^5.10.1         | Redis client                                 |
| redlock    | ^5.0.0-beta.2   | Distributed locking for scheduler            |
| node-cron  | ^4.2.1          | Cron scheduling                              |
| luxon      | ^3.7.2          | Timezone-aware date arithmetic               |
| joi        | ^18.1.2         | Request validation                           |
| winston    | ^3.19.0         | Structured logging                           |
| morgan     | ^1.10.1         | HTTP request logging                         |
| dotenv     | ^17.4.2         | Environment variable loading                 |

### Dev / Test

| Package                  | Purpose                                          |
|--------------------------|--------------------------------------------------|
| jest + ts-jest           | Test runner with TypeScript support              |
| supertest                | HTTP integration testing                         |
| @testcontainers/mongodb  | Disposable MongoDB for integration/E2E tests     |
| @testcontainers/redis    | Disposable Redis for integration/E2E tests       |
| tsx                      | TypeScript execution for development             |

---

## 10. Operational Notes

### Docker

The project ships with a multi-stage Dockerfile and a `docker-compose.yml` that 
wires all five services together.

**Building and running:**
```bash
docker compose up --build
```

**Services:**

| Service   | Role        | Port | Description                        |
|-----------|-------------|------|------------------------------------|
| api       | api         | 3001 | HTTP server, exposes REST endpoints |
| worker    | worker      | -    | BullMQ consumer, processes jobs    |
| scheduler | scheduler   | -    | Hourly cron, enqueues birthday jobs |
| mongo     | -           | 27017| MongoDB 7, data persisted via volume|
| redis     | -           | 6379 | Redis 7, queue and distributed lock |

**Scaling workers horizontally:**
```bash
docker compose up --scale worker=3
```
- Multiple worker instances are safe. BullMQ guarantees each job is consumed by exactly one worker.
- API is fully stateless: no shared memory, no local state. Horizontal scaling is just `--scale api=N` behind a load balancer with no coordination needed.
- Redlock on the scheduler means you can run multiple scheduler instances for redundancy without double-enqueueing.

**Scaling the scheduler:**
```bash
docker compose up --scale scheduler=2
```
Multiple scheduler instances are also safe - Redlock ensures only one 
acquires the lock per tick. The extra instance simply skips the tick 
if it loses the lock.

**Persistence:** MongoDB and Redis both mount named volumes 
(`mongo_data`, `redis_data`), so data survives container restarts.

### Adding a Notification Channel

Implement the `INotificationChannel` interface and pass an instance to `NotificationService`. No other code changes are required.

```typescript
export interface INotificationChannel {
  send(recipient: NotificationRecipient, message: NotificationMessage): Promise<void>;
}
```

### Extending Job Types

`ReminderJobData.type` is typed as `"birthday"` but the worker has a type guard that warns and returns for unknown types. Add a new type to the union and handle it in `ReminderJobProcessor.process()` to extend.

### Birthday Hour

`BIRTHDAY_HOUR` (default `9`) controls what local time the birthday notification fires. `computeNextBirthdayAt()` in `birthdayUtils.ts` uses Luxon to find the next occurrence of month/day at that hour in the user's IANA timezone, then converts to UTC for storage.

### Known Limitations

- `LogFileChannel` is the only delivery channel, no email or push notification support yet
- No authentication on the HTTP API
- `ReminderLog` is never pruned, will grow unbounded over time
- No resource limits set, in production, cap memory on the Redis container to prevent unbounded growth from the BullMQ queue.