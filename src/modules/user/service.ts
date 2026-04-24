import { IUserRepository } from './repository.js';
import { IReminderQueue } from '../reminder/model.js';
import { User, RegisterUserDTO, UpdateUserDTO } from './model.js';
import { UserError } from './error.js';
import { getNextBirthday } from '../reminder/birthdayUtils.js';

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

    try {
      return await this.userRepository.create(data);
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
    // 1. Ensure user exists
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new UserError('User not found', 'NOT_FOUND', 404);
    }

    // 2. Optional: enforce unique email if updating email
    if (data.email && data.email !== existing.email) {
      const emailTaken = await this.userRepository.findByEmail(data.email);
      if (emailTaken) {
        throw new UserError('Email already registered', 'DUPLICATE_EMAIL', 409);
      }
    }

    // 3. Perform update
    const updated = await this.userRepository.update(id, data);

    // If update fail on repository level, throw internal service error
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
    await this.reminderQueue.removeBirthdayReminder(id, getNextBirthday(updated.birthday, updated.timezone));
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
    await this.reminderQueue.removeBirthdayReminder(id, getNextBirthday(existing.birthday, existing.timezone));
  }
}