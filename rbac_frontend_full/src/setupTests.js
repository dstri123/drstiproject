// Runs before every test file (Create React App picks this file up automatically).
import "@testing-library/jest-dom";

beforeEach(() => {
  localStorage.clear();
});
