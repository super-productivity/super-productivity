import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { CdkDragEnd, CdkDragMove } from '@angular/cdk/drag-drop';

import { TreeDndComponent } from './tree.component';
import { TreeId, TreeNode } from './tree.types';

describe('TreeDndComponent', () => {
  let fixture: ComponentFixture<TreeDndComponent>;
  let component: TreeDndComponent;
  let moved: jasmine.Spy;
  const nodes: TreeNode[] = [{ id: 'a' }, { id: 'b' }];
  const pointer = { x: 50, y: 500 };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreeDndComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(TreeDndComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('nodes', nodes);
    fixture.detectChanges();

    moved = jasmine.createSpy('moved');
    component.moved.subscribe(moved);
    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    // Both rects contain the pointer, as they still do for a root drop zone
    // that is scrolled out of view inside the side nav's scroll section.
    const host = fixture.nativeElement as HTMLElement;
    const treeEl = host.querySelector('.tree') as HTMLElement;
    const rootDropEl = host.querySelector('.root-drop') as HTMLElement;
    spyOn(treeEl, 'getBoundingClientRect').and.returnValue(new DOMRect(0, 0, 200, 1000));
    spyOn(rootDropEl, 'getBoundingClientRect').and.returnValue(
      new DOMRect(0, 490, 200, 20),
    );
  });

  const dragAOver = (elementUnderPointer: Element): void => {
    spyOn(document, 'elementFromPoint').and.returnValue(elementUnderPointer);
    component.onDragStarted('a');
    component.onDragMoved({
      source: { data: 'a' },
      pointerPosition: pointer,
    } as unknown as CdkDragMove<TreeId>);
    component.onDragEnded({
      source: { data: 'a', reset: () => undefined },
    } as unknown as CdkDragEnd<TreeId>);
  };

  it('moves a node to the end when dropped on the visible root drop zone', () => {
    const host = fixture.nativeElement as HTMLElement;
    dragAOver(host.querySelector('.root-drop') as HTMLElement);

    expect(moved).toHaveBeenCalledTimes(1);
    expect(component.nodes().map((node) => node.id)).toEqual(['b', 'a']);
  });

  it('leaves the tree unchanged when the root drop zone is covered by other content', () => {
    const footer = document.createElement('div');
    document.body.appendChild(footer);

    dragAOver(footer);

    expect(moved).not.toHaveBeenCalled();
    expect(component.nodes().map((node) => node.id)).toEqual(['a', 'b']);
    footer.remove();
  });
});
