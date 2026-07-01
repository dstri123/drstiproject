// src/styles/layoutStyles.js

import { theme } from "./theme";

export const layoutStyles = {
  root: {
    display: "flex",
    height: "calc(100vh - 100px)",
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
  },

  sidebar: {
    width: "320px",
    background: "white",
    borderRight: `1px solid ${theme.colors.border}`,
    display: "flex",
    flexDirection: "column",
  },

  header: {
    padding: "20px",
    borderBottom: "1px solid #e5e7eb",
    background: "white",
  },

  sidebarContent: {
    padding: theme.spacing.lg,
    overflowY: "auto",
    flex: 1,
  },

  viewer: {
    flex: 1,
    background: theme.colors.viewerBg,
  },

  sectionTitle: {
    fontSize: "15px",
    fontWeight: "600",
    marginBottom: "10px",
  },

  box: {
    background: "white",
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.md,
    padding: "12px",
  },

  divider: {
    margin: "20px 0",
    borderColor: theme.colors.border,
  },
};
