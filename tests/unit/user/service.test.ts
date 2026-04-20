import { UserService } from '../../../src/modules/user/service';
import { IUserRepository } from '../../../src/modules/user/repository';
import { UserError } from '../../../src/modules/user/error';
 
describe('UserService', () => {
  let mockRepo: jest.Mocked<IUserRepository>;
  let service: UserService;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findActive: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    service = new UserService(mockRepo);
  });

  it('should register user', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);

    mockRepo.create.mockResolvedValue({
      id: '1',
      name: 'Adrian',
      email: 'adrian@test.com',
      birthday: new Date(),
      timezone: 'Asia/Jakarta',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.register({
      name: 'Adrian',
      email: 'adrian@test.com',
      birthday: new Date(),
      timezone: 'Asia/Jakarta',
    });

    expect(result.email).toBe('adrian@test.com');
    expect(mockRepo.create).toHaveBeenCalled();
  });

  it('should throw if email exists', async () => {
    mockRepo.findByEmail.mockResolvedValue({} as any);

    await expect(
      service.register({
        name: 'Adrian',
        email: 'adrian@test.com',
        birthday: new Date(),
        timezone: 'Asia/Jakarta',
      })
    ).rejects.toThrow(UserError);
  });

  it('should throw NOT_FOUND if user missing', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.getById('1')).rejects.toThrow(UserError);
  });
});