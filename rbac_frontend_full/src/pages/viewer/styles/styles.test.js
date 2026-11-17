import { theme } from "./theme";
import { layoutStyles } from "./layoutStyles";
import { buttonStyles } from "./buttonStyles";

test("layout styles derive from the theme tokens", () => {
  expect(layoutStyles.sidebar.borderRight).toBe(`1px solid ${theme.colors.border}`);
  expect(layoutStyles.sidebarContent.padding).toBe(theme.spacing.lg);
  expect(layoutStyles.viewer.background).toBe(theme.colors.viewerBg);
  expect(layoutStyles.box.borderRadius).toBe(theme.radius.md);
});

test("every button variant extends the base style", () => {
  const { base, ...variants } = buttonStyles;
  const { transition, ...shared } = base;
  expect(transition).toBe("0.2s ease");
  Object.values(variants).forEach((v) => expect(v).toMatchObject(shared));
  expect(buttonStyles.primary.backgroundColor).toBe(theme.colors.primary);
  expect(buttonStyles.danger.backgroundColor).toBe(theme.colors.danger);
});
