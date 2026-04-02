import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ProfileEditor from '$lib/components/ProfileEditor.svelte';
import type { MonitoringProfile } from '$lib/types';

function makeProfile(overrides: Partial<MonitoringProfile> = {}): MonitoringProfile {
  return {
    id: 'test-id',
    name: 'Test Profile',
    directories: ['/home/user/project'],
    alerts: { on_approval_needed: 'high', on_session_end: 'low', on_stop: 'medium' },
    alert_volume: 80,
    notification_command: '',
    ...overrides,
  };
}

describe('ProfileEditor', () => {
  it('renders profile name', () => {
    const { getByDisplayValue } = render(ProfileEditor, {
      props: { profile: makeProfile({ name: 'Work' }), onSave: vi.fn(), onDelete: vi.fn() },
    });
    expect(getByDisplayValue('Work')).toBeTruthy();
  });

  it('renders directories', () => {
    const { getByDisplayValue } = render(ProfileEditor, {
      props: {
        profile: makeProfile({ directories: ['/home/user/work'] }),
        onSave: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByDisplayValue('/home/user/work')).toBeTruthy();
  });

  it('calls onDelete when delete is confirmed', async () => {
    const onDelete = vi.fn();
    const { getByText } = render(ProfileEditor, {
      props: { profile: makeProfile(), onSave: vi.fn(), onDelete },
    });
    await fireEvent.click(getByText('Delete'));
    await fireEvent.click(getByText('Confirm'));
    expect(onDelete).toHaveBeenCalledWith('test-id');
  });
});
