jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import {clearAllChatHistory} from '../src/services/chatHistoryStore';

test('clears only chat-history keys with supported storage operations', async () => {
  const storage = jest.requireMock(
    '@react-native-async-storage/async-storage',
  ).default as {
    getAllKeys: jest.Mock;
    removeItem: jest.Mock;
  };
  storage.getAllKeys.mockResolvedValue([
    '@ringmemory:chat_history:self',
    '@ringmemory:token',
    '@ringmemory:chat_history:archive',
  ]);
  storage.removeItem.mockResolvedValue(undefined);

  await clearAllChatHistory();

  expect(storage.removeItem.mock.calls).toEqual([
    ['@ringmemory:chat_history:self'],
    ['@ringmemory:chat_history:archive'],
  ]);
});
