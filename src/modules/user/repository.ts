import { User, RegisterUserDTO, UpdateUserDTO } from './model.js';

export interface IUserRepository {
  create(data: RegisterUserDTO): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findActive(): Promise<User[]>;
  update(id: string, fields: UpdateUserDTO): Promise<User | null>;
  delete(id: string): Promise<void>;
}