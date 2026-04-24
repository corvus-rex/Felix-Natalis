import mongoose, { Schema, Document, Model } from 'mongoose';
import { IUserRepository } from '../../modules/user/repository.js';
import { User, InsertUserDTO, UpdateUserDTO } from '../../modules/user/model.js';

interface UserDocument extends Document {
  name: string;
  email: string;
  birthday: Date;
  nextBirthDayAt: Date;
  timezone: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<UserDocument>(
  {
    name: String,
    email: { type: String, unique: true },
    birthday: Date,
    nextBirthDayAt: { type: Date, index: true },
    timezone: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const UserModel = mongoose.model<UserDocument>('User', schema);

// mapper (Mongo -> User Domain)
const toUser = (doc: any): User => ({
  id: doc._id.toString(),
  name: doc.name,
  email: doc.email,
  birthday: doc.birthday,
  nextBirthDayAt: doc.nextBirthDayAt,
  timezone: doc.timezone,
  active: doc.active,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export class UserRepositoryMongo implements IUserRepository {
  async create(data: InsertUserDTO): Promise<User> {
    const doc = await UserModel.create(data);
    return toUser(doc.toObject());
  }

  async findById(id: string): Promise<User | null> {
    const doc = await UserModel.findById(id).lean();
    return doc ? toUser(doc) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email }).lean();
    return doc ? toUser(doc) : null;
  }

  async findActive(): Promise<User[]> {
    const docs = await UserModel.find({ active: true }).lean();
    return docs.map(toUser);
  }

  async update(id: string, fields: UpdateUserDTO): Promise<User | null> {
    const doc = await UserModel.findByIdAndUpdate(
      id,
      { $set: fields },
      { returnDocument: 'after' }
    ).lean();

    return doc ? toUser(doc) : null;
  }

  async delete(id: string): Promise<void> {
    await UserModel.findByIdAndDelete(id);
  }

  async findUsersWithBirthdayBetween(from: Date, to: Date): Promise<User[]> {
    const docs = await UserModel.find({
      active: true,
      nextBirthdayAt: {
        $gte: from,
        $lte: to,
      },
    }).sort({ nextBirthdayAt: 1 }).lean();

    return docs.map(toUser);
  }
}