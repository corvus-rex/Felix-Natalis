import { User, InsertUserDTO, UpdateUserDTO } from './model.js';

export interface IUserRepository {
  create(data: InsertUserDTO): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findActive(): Promise<User[]>;
  update(id: string, fields: UpdateUserDTO): Promise<User | null>;
  delete(id: string): Promise<void>;
  findUsersWithBirthdayBetween(from: Date, to: Date): Promise<User[]>;
}