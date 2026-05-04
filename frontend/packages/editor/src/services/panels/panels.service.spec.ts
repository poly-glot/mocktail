import { TestBed } from '@angular/core/testing';
import { EditorPanelsService } from './panels.service';

describe('EditorPanelsService', () => {
  let svc: EditorPanelsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(EditorPanelsService);
  });

  it('defaults both panels to expanded and leftPanel to components', () => {
    expect(svc.collapseLeft()).toBeFalse();
    expect(svc.collapseRight()).toBeFalse();
    expect(svc.leftPanel()).toBe('components');
  });

  it('toggleLeft flips collapseLeft back and forth', () => {
    svc.toggleLeft();
    expect(svc.collapseLeft()).toBeTrue();
    svc.toggleLeft();
    expect(svc.collapseLeft()).toBeFalse();
  });

  it('toggleRight flips collapseRight back and forth', () => {
    svc.toggleRight();
    expect(svc.collapseRight()).toBeTrue();
    svc.toggleRight();
    expect(svc.collapseRight()).toBeFalse();
  });

  it('setLeftPanel switches the active panel', () => {
    svc.setLeftPanel('symbols');
    expect(svc.leftPanel()).toBe('symbols');
    svc.setLeftPanel('components');
    expect(svc.leftPanel()).toBe('components');
  });

  it('setLeftPanel expands a collapsed left rail', () => {
    svc.toggleLeft();
    expect(svc.collapseLeft()).toBeTrue();
    svc.setLeftPanel('symbols');
    expect(svc.collapseLeft()).toBeFalse();
    expect(svc.leftPanel()).toBe('symbols');
  });

  it('setLeftPanel leaves an already-expanded rail expanded', () => {
    svc.setLeftPanel('symbols');
    expect(svc.collapseLeft()).toBeFalse();
  });
});
