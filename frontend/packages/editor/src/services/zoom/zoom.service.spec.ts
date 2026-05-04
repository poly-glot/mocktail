import { TestBed } from '@angular/core/testing';
import { EditorZoomService } from './zoom.service';

describe('EditorZoomService', () => {
  let svc: EditorZoomService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(EditorZoomService);
  });

  it('defaults zoom to 0.9 and autoFit to true', () => {
    expect(svc.zoom()).toBe(0.9);
    expect(svc.autoFitZoom()).toBeTrue();
  });

  it('zoomIn adds 0.1 and turns auto-fit off', () => {
    svc.zoomIn();
    expect(svc.zoom()).toBe(1);
    expect(svc.autoFitZoom()).toBeFalse();
  });

  it('zoomOut subtracts 0.1 and turns auto-fit off', () => {
    svc.zoomOut();
    expect(svc.zoom()).toBe(0.8);
    expect(svc.autoFitZoom()).toBeFalse();
  });

  it('zoomIn caps at 2.0', () => {
    for (let i = 0; i < 20; i++) svc.zoomIn();
    expect(svc.zoom()).toBe(2);
  });

  it('zoomOut floors at 0.25', () => {
    for (let i = 0; i < 20; i++) svc.zoomOut();
    expect(svc.zoom()).toBe(0.25);
  });

  it('toggleAutoFit flips the flag', () => {
    svc.toggleAutoFit();
    expect(svc.autoFitZoom()).toBeFalse();
    svc.toggleAutoFit();
    expect(svc.autoFitZoom()).toBeTrue();
  });

  it('setFromAutoFit updates zoom when different', () => {
    svc.setFromAutoFit(0.5);
    expect(svc.zoom()).toBe(0.5);
  });

  it('setFromAutoFit is a no-op when value matches current', () => {
    svc.setFromAutoFit(0.9);
    expect(svc.zoom()).toBe(0.9);
  });

  it('setFromAutoFit clamps to the allowed range', () => {
    svc.setFromAutoFit(10);
    expect(svc.zoom()).toBe(2);
    svc.setFromAutoFit(0);
    expect(svc.zoom()).toBe(0.25);
  });

  it('zoomPct formats zoom as integer percent', () => {
    expect(svc.zoomPct()).toBe('90%');
    svc.zoomIn();
    expect(svc.zoomPct()).toBe('100%');
  });
});
