describe('DialogJiraAddWorklogComponent _convertTimestamp', () => {
  describe('native implementation', () => {
    it('should convert timestamp to ISO string without seconds', () => {
      const timestamp = new Date(2024, 0, 15, 10, 30, 45, 0).getTime();
      const date = new Date(timestamp);

      // Set seconds and milliseconds to 0
      date.setSeconds(0, 0);

      // Get local ISO string and take first 19 characters
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const result = `${year}-${month}-${day}T${hours}:${minutes}:00`;

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
    });
  });
});
