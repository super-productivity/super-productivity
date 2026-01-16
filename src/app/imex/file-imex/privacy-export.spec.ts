import { privacyExport } from './privacy-export';

describe('privacyExport', () => {
  describe('existing sensitive fields (regression tests)', () => {
    it('should mask username field', () => {
      const input = { username: 'john_doe' };
      const result = JSON.parse(privacyExport(input));
      expect(result.username).toMatch(/^username__\d+$/);
      expect(result.username).not.toBe('john_doe');
    });

    it('should mask password field', () => {
      const input = { password: 'secret123' };
      const result = JSON.parse(privacyExport(input));
      expect(result.password).toMatch(/^password__\d+$/);
      expect(result.password).not.toBe('secret123');
    });

    it('should mask token field', () => {
      const input = { token: 'abc123xyz' };
      const result = JSON.parse(privacyExport(input));
      expect(result.token).toMatch(/^token__\d+$/);
      expect(result.token).not.toBe('abc123xyz');
    });

    it('should mask title field', () => {
      const input = { title: 'My Private Task' };
      const result = JSON.parse(privacyExport(input));
      expect(result.title).toMatch(/^title__\d+$/);
      expect(result.title).not.toBe('My Private Task');
    });

    it('should mask caldavUrl field', () => {
      const input = { caldavUrl: 'https://caldav.example.com/calendar' };
      const result = JSON.parse(privacyExport(input));
      expect(result.caldavUrl).toMatch(/^caldavUrl__\d+$/);
      expect(result.caldavUrl).not.toBe('https://caldav.example.com/calendar');
    });
  });

  describe('new sensitive fields (Issue #6020)', () => {
    it('should mask resourceName field', () => {
      const input = { resourceName: 'user@example.com/calendar' };
      const result = JSON.parse(privacyExport(input));
      expect(result.resourceName).toMatch(/^resourceName__\d+$/);
      expect(result.resourceName).not.toContain('@');
      expect(result.resourceName).not.toContain('example.com');
    });

    it('should mask name field (project/tag names)', () => {
      const input = { name: 'Secret Project Alpha' };
      const result = JSON.parse(privacyExport(input));
      expect(result.name).toMatch(/^name__\d+$/);
      expect(result.name).not.toBe('Secret Project Alpha');
    });

    it('should mask description field', () => {
      const input = { description: 'Private meeting notes' };
      const result = JSON.parse(privacyExport(input));
      expect(result.description).toMatch(/^description__\d+$/);
      expect(result.description).not.toBe('Private meeting notes');
    });

    it('should mask location field', () => {
      const input = { location: '123 Main St, Anytown' };
      const result = JSON.parse(privacyExport(input));
      expect(result.location).toMatch(/^location__\d+$/);
      expect(result.location).not.toBe('123 Main St, Anytown');
    });

    it('should mask calProviderId field', () => {
      const input = { calProviderId: 'provider-12345' };
      const result = JSON.parse(privacyExport(input));
      expect(result.calProviderId).toMatch(/^calProviderId__\d+$/);
      expect(result.calProviderId).not.toBe('provider-12345');
    });

    it('should mask summary field', () => {
      const input = { summary: 'Team meeting agenda' };
      const result = JSON.parse(privacyExport(input));
      expect(result.summary).toMatch(/^summary__\d+$/);
      expect(result.summary).not.toBe('Team meeting agenda');
    });
  });

  describe('email exposure prevention', () => {
    it('should completely mask email addresses in resourceName', () => {
      const input = { resourceName: 'john.doe@company.com/personal-calendar' };
      const result = JSON.parse(privacyExport(input));
      expect(result.resourceName).toMatch(/^resourceName__\d+$/);
      // Verify no email pattern exists
      expect(result.resourceName).not.toMatch(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      );
    });

    it('should mask multiple fields containing emails', () => {
      const input = {
        resourceName: 'user@example.com/cal',
        description: 'Contact: admin@example.org',
        location: 'support@company.net',
      };
      const result = JSON.parse(privacyExport(input));
      const jsonString = JSON.stringify(result);
      // Verify no email patterns in entire output
      expect(jsonString).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    });
  });

  describe('nested objects and arrays', () => {
    it('should mask sensitive fields in nested objects', () => {
      const input = {
        user: {
          username: 'john',
          profile: {
            name: 'John Doe',
            password: 'secret',
          },
        },
      };
      const result = JSON.parse(privacyExport(input));
      expect(result.user.username).toMatch(/^username__\d+$/);
      expect(result.user.profile.name).toMatch(/^name__\d+$/);
      expect(result.user.profile.password).toMatch(/^password__\d+$/);
    });

    it('should mask sensitive fields in arrays', () => {
      const input = {
        calendars: [
          { resourceName: 'user1@example.com/cal', name: 'Personal' },
          { resourceName: 'user2@example.com/cal', name: 'Work' },
        ],
      };
      const result = JSON.parse(privacyExport(input));
      expect(result.calendars[0].resourceName).toMatch(/^resourceName__\d+$/);
      expect(result.calendars[0].name).toMatch(/^name__\d+$/);
      expect(result.calendars[1].resourceName).toMatch(/^resourceName__\d+$/);
      expect(result.calendars[1].name).toMatch(/^name__\d+$/);
    });

    it('should mask sensitive fields in deeply nested structures', () => {
      const input = {
        config: {
          sync: {
            caldav: {
              calendars: [
                {
                  resourceName: 'admin@company.com/calendar',
                  events: [
                    { summary: 'Private meeting', location: 'Office 101' },
                    { summary: 'Public event', description: 'Open to all' },
                  ],
                },
              ],
            },
          },
        },
      };
      const result = JSON.parse(privacyExport(input));
      const caldav = result.config.sync.caldav;
      expect(caldav.calendars[0].resourceName).toMatch(/^resourceName__\d+$/);
      expect(caldav.calendars[0].events[0].summary).toMatch(/^summary__\d+$/);
      expect(caldav.calendars[0].events[0].location).toMatch(/^location__\d+$/);
      expect(caldav.calendars[0].events[1].summary).toMatch(/^summary__\d+$/);
      expect(caldav.calendars[0].events[1].description).toMatch(/^description__\d+$/);
    });
  });

  describe('counter increments and uniqueness', () => {
    it('should produce unique masked values with incrementing counters', () => {
      const input = {
        username: 'user1',
        password: 'pass1',
        token: 'token1',
      };
      const result = JSON.parse(privacyExport(input));
      // Extract counter values
      const counters = [
        result.username.split('__')[1],
        result.password.split('__')[1],
        result.token.split('__')[1],
      ].map(Number);

      // All counters should be different (though not necessarily sequential due to recursion)
      const uniqueCounters = new Set(counters);
      expect(uniqueCounters.size).toBe(3);
    });

    it('should mask multiple instances of same field name with different counters', () => {
      const input = {
        tasks: [{ title: 'Task 1' }, { title: 'Task 2' }, { title: 'Task 3' }],
      };
      const result = JSON.parse(privacyExport(input));
      const titles = result.tasks.map((t: any) => t.title);

      // All should be masked
      titles.forEach((title: string) => {
        expect(title).toMatch(/^title__\d+$/);
      });

      // All should have different counters
      const counters = titles.map((t: string) => t.split('__')[1]);
      const uniqueCounters = new Set(counters);
      expect(uniqueCounters.size).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should not mask empty strings', () => {
      const input = { username: '' };
      const result = JSON.parse(privacyExport(input));
      expect(result.username).toBe('');
    });

    it('should preserve non-sensitive fields', () => {
      const input = {
        id: '12345',
        status: 'active',
        count: 42,
        enabled: true,
      };
      const result = JSON.parse(privacyExport(input));
      expect(result.id).toBe('12345');
      expect(result.status).toBe('active');
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
    });

    it('should handle null and undefined values', () => {
      const input = {
        username: null,
        password: undefined,
        token: 'valid',
      };
      const result = JSON.parse(privacyExport(input));
      expect(result.username).toBeNull();
      expect(result.password).toBeUndefined();
      expect(result.token).toMatch(/^token__\d+$/);
    });

    it('should handle mixed sensitive and non-sensitive fields', () => {
      const input = {
        id: 'task-123',
        title: 'Secret task',
        createdAt: 1234567890,
        username: 'john',
        isCompleted: false,
      };
      const result = JSON.parse(privacyExport(input));
      expect(result.id).toBe('task-123');
      expect(result.title).toMatch(/^title__\d+$/);
      expect(result.createdAt).toBe(1234567890);
      expect(result.username).toMatch(/^username__\d+$/);
      expect(result.isCompleted).toBe(false);
    });

    it('should handle empty objects and arrays', () => {
      const input = {
        empty: {},
        emptyArray: [],
        username: 'test',
      };
      const result = JSON.parse(privacyExport(input));
      expect(result.empty).toEqual({});
      expect(result.emptyArray).toEqual([]);
      expect(result.username).toMatch(/^username__\d+$/);
    });
  });

  describe('realistic CalDAV data structure', () => {
    it('should properly anonymize a realistic CalDAV calendar configuration', () => {
      const input = {
        caldavCfg: {
          caldavUrl: 'https://caldav.example.com/dav',
          username: 'john.doe',
          password: 'secretPassword123',
          calendars: [
            {
              id: 'cal-001',
              resourceName: 'john.doe@company.com/personal',
              name: 'Personal Calendar',
              calProviderId: 'provider-abc123',
            },
            {
              id: 'cal-002',
              resourceName: 'john.doe@company.com/work',
              name: 'Work Calendar',
              calProviderId: 'provider-def456',
            },
          ],
          events: [
            {
              id: 'event-001',
              summary: 'Team standup meeting',
              description: 'Daily sync with team leads',
              location: 'Conference Room B',
            },
          ],
        },
      };

      const result = JSON.parse(privacyExport(input));
      const caldav = result.caldavCfg;

      // Verify all sensitive fields are masked
      expect(caldav.caldavUrl).toMatch(/^caldavUrl__\d+$/);
      expect(caldav.username).toMatch(/^username__\d+$/);
      expect(caldav.password).toMatch(/^password__\d+$/);
      expect(caldav.calendars[0].resourceName).toMatch(/^resourceName__\d+$/);
      expect(caldav.calendars[0].name).toMatch(/^name__\d+$/);
      expect(caldav.calendars[0].calProviderId).toMatch(/^calProviderId__\d+$/);
      expect(caldav.calendars[1].resourceName).toMatch(/^resourceName__\d+$/);
      expect(caldav.calendars[1].name).toMatch(/^name__\d+$/);
      expect(caldav.calendars[1].calProviderId).toMatch(/^calProviderId__\d+$/);
      expect(caldav.events[0].summary).toMatch(/^summary__\d+$/);
      expect(caldav.events[0].description).toMatch(/^description__\d+$/);
      expect(caldav.events[0].location).toMatch(/^location__\d+$/);

      // Verify non-sensitive IDs are preserved
      expect(caldav.calendars[0].id).toBe('cal-001');
      expect(caldav.calendars[1].id).toBe('cal-002');
      expect(caldav.events[0].id).toBe('event-001');

      // Verify no email patterns anywhere
      const jsonString = JSON.stringify(result);
      expect(jsonString).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    });
  });
});
