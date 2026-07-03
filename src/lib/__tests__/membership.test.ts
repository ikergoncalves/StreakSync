import { isSoleOwner } from '../membership';

function member(userId: string, role: 'owner' | 'member') {
  return { user_id: userId, role };
}

describe('isSoleOwner', () => {
  it('is true when the user holds the only owner role', () => {
    const members = [member('user-1', 'owner'), member('user-2', 'member')];

    expect(isSoleOwner(members, 'user-1')).toBe(true);
  });

  it('is false for a regular member', () => {
    const members = [member('user-2', 'owner'), member('user-1', 'member')];

    expect(isSoleOwner(members, 'user-1')).toBe(false);
  });

  it('is false when another owner exists', () => {
    const members = [member('user-1', 'owner'), member('user-2', 'owner')];

    expect(isSoleOwner(members, 'user-1')).toBe(false);
  });

  it('is false when there are no members loaded', () => {
    expect(isSoleOwner([], 'user-1')).toBe(false);
  });
});
