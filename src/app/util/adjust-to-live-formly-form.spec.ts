import { FormlyFieldConfig } from '@ngx-formly/core';
import { adjustToLiveFormlyForm } from './adjust-to-live-formly-form';

describe('adjustToLiveFormlyForm', () => {
  describe('null/undefined handling', () => {
    it('should filter out undefined items from input array', () => {
      const items: (FormlyFieldConfig | undefined)[] = [
        { key: 'field1', type: 'input' },
        undefined,
        { key: 'field2', type: 'input' },
      ];

      const result = adjustToLiveFormlyForm(items as FormlyFieldConfig[]);

      expect(result.length).toBe(2);
      expect(result[0].key).toBe('field1');
      expect(result[1].key).toBe('field2');
    });

    it('should filter out null items from input array', () => {
      const items: (FormlyFieldConfig | null)[] = [
        { key: 'field1', type: 'input' },
        null,
        { key: 'field2', type: 'input' },
      ];

      const result = adjustToLiveFormlyForm(items as FormlyFieldConfig[]);

      expect(result.length).toBe(2);
      expect(result[0].key).toBe('field1');
      expect(result[1].key).toBe('field2');
    });

    it('should handle empty array', () => {
      const result = adjustToLiveFormlyForm([]);
      expect(result).toEqual([]);
    });

    it('should handle array with only undefined/null items', () => {
      const items: (FormlyFieldConfig | undefined | null)[] = [
        undefined,
        null,
        undefined,
      ];

      const result = adjustToLiveFormlyForm(items as FormlyFieldConfig[]);
      expect(result).toEqual([]);
    });

    it('should filter undefined from nested fieldGroup', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'parent',
          fieldGroup: [
            { key: 'child1', type: 'input' },
            undefined as unknown as FormlyFieldConfig,
            { key: 'child2', type: 'input' },
          ],
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].fieldGroup?.length).toBe(2);
      expect(result[0].fieldGroup?.[0].key).toBe('child1');
      expect(result[0].fieldGroup?.[1].key).toBe('child2');
    });

    it('should filter undefined from repeat fieldArray.fieldGroup', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'repeatField',
          type: 'repeat',
          fieldArray: {
            fieldGroup: [
              { key: 'item1', type: 'input' },
              undefined as unknown as FormlyFieldConfig,
              { key: 'item2', type: 'checkbox' },
            ],
          },
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      const fieldArray = result[0].fieldArray as FormlyFieldConfig;
      expect(fieldArray.fieldGroup?.length).toBe(2);
      expect(fieldArray.fieldGroup?.[0].key).toBe('item1');
      expect(fieldArray.fieldGroup?.[1].key).toBe('item2');
    });
  });

  describe('type transformations', () => {
    it('should convert checkbox to toggle', () => {
      const items: FormlyFieldConfig[] = [{ key: 'checkField', type: 'checkbox' }];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].type).toBe('toggle');
    });

    it('should add blur update behavior to input fields', () => {
      const items: FormlyFieldConfig[] = [{ key: 'inputField', type: 'input' }];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].modelOptions?.updateOn).toBe('blur');
      expect(result[0].templateOptions?.keydown).toBeDefined();
    });

    it('should add blur update behavior to textarea fields', () => {
      const items: FormlyFieldConfig[] = [{ key: 'textareaField', type: 'textarea' }];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].modelOptions?.updateOn).toBe('blur');
    });

    it('should add blur update behavior to duration fields', () => {
      const items: FormlyFieldConfig[] = [{ key: 'durationField', type: 'duration' }];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].modelOptions?.updateOn).toBe('blur');
    });

    it('should add blur update behavior to icon fields', () => {
      const items: FormlyFieldConfig[] = [{ key: 'iconField', type: 'icon' }];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].modelOptions?.updateOn).toBe('blur');
    });

    it('should add blur update behavior to color fields', () => {
      const items: FormlyFieldConfig[] = [{ key: 'colorField', type: 'color' }];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].modelOptions?.updateOn).toBe('blur');
    });
  });

  describe('fieldGroup processing', () => {
    it('should recursively process nested fieldGroup', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'parent',
          fieldGroup: [{ key: 'child', type: 'checkbox' }],
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].fieldGroup?.[0].type).toBe('toggle');
    });

    it('should handle deeply nested fieldGroups', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'level1',
          fieldGroup: [
            {
              key: 'level2',
              fieldGroup: [{ key: 'level3', type: 'checkbox' }],
            },
          ],
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0].fieldGroup?.[0].fieldGroup?.[0].type).toBe('toggle');
    });
  });

  describe('repeat field processing', () => {
    it('should process repeat with complex fieldArray (has fieldGroup)', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'repeatField',
          type: 'repeat',
          fieldArray: {
            fieldGroup: [{ key: 'innerField', type: 'checkbox' }],
          },
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      const fieldArray = result[0].fieldArray as FormlyFieldConfig;
      expect(fieldArray.fieldGroup?.[0].type).toBe('toggle');
    });

    it('should process repeat with simple fieldArray (has type only)', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'repeatField',
          type: 'repeat',
          fieldArray: {
            type: 'input',
          },
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      const fieldArray = result[0].fieldArray as FormlyFieldConfig;
      expect(fieldArray.modelOptions?.updateOn).toBe('blur');
    });

    it('should handle repeat without fieldArray gracefully', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'repeatField',
          type: 'repeat',
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0]).toEqual(items[0]);
    });
  });

  describe('unchanged fields', () => {
    it('should return field unchanged if no transformation applies', () => {
      const items: FormlyFieldConfig[] = [
        {
          key: 'selectField',
          type: 'select',
          templateOptions: { options: [] },
        },
      ];

      const result = adjustToLiveFormlyForm(items);

      expect(result[0]).toEqual(items[0]);
    });
  });
});
