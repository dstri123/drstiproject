import { attachSimpleUI } from "./SectionControls";

function fakeManager() {
  const m = {
    edgeMesh: null,
    enable: jest.fn(() => {
      m.edgeMesh = {};
    }),
    disable: jest.fn(() => {
      m.edgeMesh = null;
    }),
    reset: jest.fn(),
    isolateFloor: jest.fn(),
  };
  return m;
}

describe("attachSimpleUI", () => {
  test("returns a no-op when there is no manager", () => {
    const api = attachSimpleUI({ manager: null });
    expect(typeof api).toBe("function");
    expect(() => api()).not.toThrow();
  });

  test("toggle enables then disables and reports the state", () => {
    const manager = fakeManager();
    const onChange = jest.fn();
    const api = attachSimpleUI({ manager, onChange });

    api.toggle();
    expect(manager.enable).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });

    api.toggle();
    expect(manager.disable).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false });
  });

  test("reset and isolateFloor delegate to the manager", () => {
    const manager = fakeManager();
    const onChange = jest.fn();
    const api = attachSimpleUI({ manager, onChange });
    const pred = () => true;

    api.reset();
    expect(manager.reset).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith({ reset: true });

    api.isolateFloor(pred);
    expect(manager.isolateFloor).toHaveBeenCalledWith(pred);
    expect(onChange).toHaveBeenLastCalledWith({ isolate: true });
  });

  test("works without an onChange callback", () => {
    const manager = fakeManager();
    const api = attachSimpleUI({ manager });
    expect(() => {
      api.toggle();
      api.reset();
      api.isolateFloor();
    }).not.toThrow();
  });
});
