import { IUserRepository } from './repository.js';
import { IReminderQueue } from '../reminder/model.js';
import { User, RegisterUserDTO, UpdateUserDTO } from './model.js';
import { UserError } from './error.js';
import { computeNextBirthdayAt } from '../reminder/birthdayUtils.js';

// Service contract
export interface IUserService {
  register(data: RegisterUserDTO): Promise<User>;
  getById(id: string): Promise<User>;
  update(id: string, data: UpdateUserDTO): Promise<User>;
  deactivate(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

// Service Implementation
export class UserService implements IUserService {
  constructor(
    private readonly userRepository: IUserRepository, 
    private readonly reminderQueue: IReminderQueue
  ) {}

  async register(data: RegisterUserDTO): Promise<User> {
    const existing = await this.userRepository.findByEmail(data.email);

    if (existing) {
      throw new UserError('Email already registered', 'DUPLICATE_EMAIL', 409);
    }

    const nextBirthdayAt = computeNextBirthdayAt(data.birthday, data.timezone);

    try {
      return await this.userRepository.create({
        ...data,
        nextBirthDayAt: nextBirthdayAt,
        active: true,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        throw new UserError('Email already registered', 'DUPLICATE_EMAIL', 409);
      }
      throw err;
    }
  }

  async getById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new UserError('User not found', 'NOT_FOUND', 404);
    }

    return user;
  }
  async update(id: string, data: UpdateUserDTO): Promise<User> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new UserError('User not found', 'NOT_FOUND', 404);
    }

    if (data.email && data.email !== existing.email) {
      const emailTaken = await this.userRepository.findByEmail(data.email);
      if (emailTaken) {
        throw new UserError('Email already registered', 'DUPLICATE_EMAIL', 409);
      }
    }

    const updatePayload: any = { ...data };
 
    if (data.birthday || data.timezone) {
      const birthday = data.birthday ?? existing.birthday;
      const timezone = data.timezone ?? existing.timezone;

      updatePayload.nextBirthdayAt = computeNextBirthdayAt(
        birthday,
        timezone
      );
      await this.reminderQueue.removeBirthdayReminder(id, existing.nextBirthDayAt.toISOString());
    }

    const updated = await this.userRepository.update(id, updatePayload);

    if (!updated) {
      throw new UserError('Failed to update user', 'UPDATE_FAILED', 500);
    }

    return updated;
  }

  async deactivate(id: string): Promise<void> {
    const updated = await this.userRepository.update(id, { active: false });

    if (!updated) {
      throw new UserError('User not found', 'NOT_FOUND', 404);
    }
    await this.reminderQueue.removeBirthdayReminder(id, updated.nextBirthDayAt.toISOString());
  }
  
  async activate(id: string): Promise<void> {
    const updated = await this.userRepository.update(id, { active: true });

    if (!updated) {
      throw new UserError('User not found', 'NOT_FOUND', 404);
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.userRepository.findById(id);

    if (!existing) {
      throw new UserError('User not found', 'NOT_FOUND', 404);
    }

    await this.userRepository.delete(id);
    await this.reminderQueue.removeBirthdayReminder(id, existing.nextBirthDayAt.toISOString());
  }
}