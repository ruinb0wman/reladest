import { describe, expect, test } from 'vitest';

import { libraryBackAction } from '@/app/library/utils/libraryUtils';

/**
 * Android back inside the library: it has to undo the in-app level before it
 * reaches the app, or the gesture exits while the user is looking at a group.
 *
 * The regression this pins: a virtual group (series / author / tag / subject /
 * status) carries only `?group=` and has NO manual group path, so a gate that
 * asks `currentGroupPath` alone treats it as "at the root" and lets the gesture
 * exit the app.
 */
describe('libraryBackAction', () => {
  test('a manual group path goes up one level (and nested paths keep working)', () => {
    expect(libraryBackAction('Fiction', '')).toBe('up-one-group');
    expect(libraryBackAction('Fiction/Mystery', '')).toBe('up-one-group');
  });

  test('a virtual group leaves the group, even without a manual path', () => {
    expect(libraryBackAction(undefined, 'author-7f3a')).toBe('leave-group');
  });

  test('the manual path wins when both are present', () => {
    // A manual group inside an active shelf keeps `group=` populated too; going
    // up one level is still the shallower undo.
    expect(libraryBackAction('Fiction', 'author-7f3a')).toBe('up-one-group');
  });

  test('the library root hands the gesture back to the app', () => {
    expect(libraryBackAction(undefined, '')).toBeNull();
  });
});
