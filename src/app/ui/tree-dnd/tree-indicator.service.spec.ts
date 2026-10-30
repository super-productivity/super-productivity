import { TreeIndicatorService } from './tree-indicator.service';

describe('TreeIndicatorService', () => {
  let service: TreeIndicatorService;
  let container: HTMLElement;

  const append = <T extends HTMLElement>(el: T, parent: HTMLElement): T => {
    parent.appendChild(el);
    return el;
  };

  beforeEach(() => {
    service = new TreeIndicatorService();
    container = document.createElement('div');
    container.style.cssText = 'position: absolute; top: 0; left: 0; width: 200px;';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('starts a row indicator at the row indent', () => {
    const item = append(document.createElement('div'), container);
    item.className = 'item';
    item.style.cssText = 'height: 32px; padding-left: 16px;';

    service.show(item, 'before', container, 16, 16);

    expect(service.indicatorStyle()).toEqual(
      jasmine.objectContaining({ left: '16px', width: '184px' }),
    );
  });

  it('lines the root drop indicator up with the top-level rows (#10472)', () => {
    const rootDrop = append(document.createElement('div'), container);
    rootDrop.style.height = '12px';

    service.show(rootDrop, 'root', container, 16, 16);

    expect(service.indicatorStyle()).toEqual(
      jasmine.objectContaining({ left: '16px', width: '184px' }),
    );
  });
});
