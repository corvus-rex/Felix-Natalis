import { NotificationService } from '../../../src/modules/notification/service';
import { INotificationChannel, NotificationRecipient, NotificationMessage } from '../../../src/modules/notification/model';
import * as birthdayLocaleModule from '../../../src/modules/notification/builder/birthday/locale/index.js';

describe('NotificationService', () => {
  const recipient: NotificationRecipient = {
    name: 'Gojo Satoru',
    email: 'gojo@test.com',
  } as NotificationRecipient;


  const mockMessage: NotificationMessage = {
    subject: 'Happy Birthday',
    body: 'Wishing you a wonderful day!',
  };
  
  let channel1: jest.Mocked<INotificationChannel>;
  let channel2: jest.Mocked<INotificationChannel>;

  beforeEach(() => {
    channel1 = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    channel2 = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    jest
      .spyOn(birthdayLocaleModule, 'buildBirthdayMessage')
      .mockReturnValue(mockMessage);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should build birthday message with default locale "en" when locale is not provided', async () => {
    const service = new NotificationService([channel1]);

    await service.notifyBirthday(recipient);

    expect(
      birthdayLocaleModule.buildBirthdayMessage
    ).toHaveBeenCalledWith('en', recipient);
  });

  it('should build birthday message with provided locale', async () => {
    const service = new NotificationService([channel1]);

    await service.notifyBirthday(recipient, 'id');

    expect(
      birthdayLocaleModule.buildBirthdayMessage
    ).toHaveBeenCalledWith('id', recipient);
  });

  it('should send notification through all channels', async () => {
    const service = new NotificationService([channel1, channel2]);

    await service.notifyBirthday(recipient);

    expect(channel1.send).toHaveBeenCalledWith(recipient, mockMessage);
    expect(channel2.send).toHaveBeenCalledWith(recipient, mockMessage);
  });

  it('should call each channel exactly once', async () => {
    const service = new NotificationService([channel1, channel2]);

    await service.notifyBirthday(recipient);

    expect(channel1.send).toHaveBeenCalledTimes(1);
    expect(channel2.send).toHaveBeenCalledTimes(1);
  });

  it('should resolve when all channels succeed', async () => {
    const service = new NotificationService([channel1, channel2]);

    await expect(
      service.notifyBirthday(recipient)
    ).resolves.toBeUndefined();
  });

  it('should reject if any channel fails', async () => {
    channel2.send.mockRejectedValue(new Error('SMS failed'));

    const service = new NotificationService([channel1, channel2]);

    await expect(
      service.notifyBirthday(recipient)
    ).rejects.toThrow('SMS failed');
  });

  it('should handle empty channels list', async () => {
    const service = new NotificationService([]);

    await expect(
      service.notifyBirthday(recipient)
    ).resolves.toBeUndefined();

    expect(
      birthdayLocaleModule.buildBirthdayMessage
    ).toHaveBeenCalledWith('en', recipient);
  });
});