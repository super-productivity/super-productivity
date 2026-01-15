// Mock for @capacitor/core specifically for WebDAV tests

export const CapacitorHttp = {
  request: jasmine.createSpy('CapacitorHttp.request'),
};

export const HttpResponse = {};

// Mock WebDavHttp plugin
const mockWebDavHttp = {
  request: jasmine.createSpy('WebDavHttp.request'),
};

export const registerPlugin = jasmine
  .createSpy('registerPlugin')
  .and.returnValue(mockWebDavHttp);

// Re-export the mock so tests can access it
export const __mockWebDavHttp = mockWebDavHttp;
